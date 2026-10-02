import { message as localizeMessage, MessageError, translate } from '../i18n/index';
import * as vscode from 'vscode';
import path from 'node:path';
import { open, lstat, readlink } from 'node:fs/promises';
import type { ContentSource, DiffPreview, DiffTarget, GitServiceContract, Repository } from '../protocol/types';
import { safeWorkingPath } from './paths';

const MAX_DOCUMENT = 8 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_PREVIEW_LINES = 4000;
type Side = { source: ContentSource; label: string; path: string } | { workingPath: string; label: string; path: string } | { text: string; label: string; path: string };
type Comparison = { left: Side; right: Side; label: string; path: string };
export class GitDocuments implements vscode.TextDocumentContentProvider {
  private readonly entries = new Map<string, { repo: Repository; source: ContentSource } | { text: string }>();
  private sequence = 0;
  constructor(private readonly git: GitServiceContract) {}
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const entry = this.entries.get(uri.toString());
    if (!entry) throw new MessageError(localizeMessage("documents.thisComparisonHasExpiredOpenItAgainFromAlwayGit"));
    if ('text' in entry) return entry.text;
    const data = await this.git.content(entry.repo, entry.source, MAX_DOCUMENT + 1);
    if (data.length > MAX_DOCUMENT) return translate('en', "documents.alwayGitFileExceedsThe8MBTextPreviewLimit");
    if (data.includes(0)) return translate('en', "documents.alwayGitBinaryFileTextComparisonIsUnavailable");
    return data.toString('utf8');
  }
  release(uri: vscode.Uri): void { this.entries.delete(uri.toString()); }
  private uri(repo: Repository, source: ContentSource | string, label: string, filename: string): vscode.Uri {
    const uri = vscode.Uri.from({ scheme: 'alwaygit-content', path: `/${filename.replace(/\\/g, '/')}`, query: `version=${++this.sequence}&label=${encodeURIComponent(label)}` });
    this.entries.set(uri.toString(), typeof source === 'string' ? { text: source } : { repo, source });
    return uri;
  }
  async openFile(repo: Repository, filename: string): Promise<void> {
    const full = await safeWorkingPath(repo.root, filename);
    await vscode.window.showTextDocument(vscode.Uri.file(full), { viewColumn: vscode.ViewColumn.Active, preview: false, preserveFocus: false });
  }
  async diff(repo: Repository, target: DiffTarget): Promise<void> {
    const comparison = await this.comparison(repo, target);
    const uri = (side: Side) => 'workingPath' in side ? vscode.Uri.file(side.workingPath) : this.uri(repo, 'text' in side ? side.text : side.source, side.label, side.path);
    await vscode.commands.executeCommand('vscode.diff', uri(comparison.left), uri(comparison.right), comparison.label, { viewColumn: vscode.ViewColumn.Active, preview: false, preserveFocus: false });
  }
  async preview(repo: Repository, target: DiffTarget): Promise<DiffPreview> {
    const comparison = await this.comparison(repo, target);
    const read = async (side: Side) => {
      if ('text' in side) return Buffer.from(side.text, 'utf8');
      if ('source' in side) return this.git.content(repo, side.source, MAX_PREVIEW_BYTES + 1);
      const file = await open(side.workingPath, 'r');
      try { const buffer = Buffer.alloc(MAX_PREVIEW_BYTES + 1); let total = 0; while (total < buffer.length) { const { bytesRead } = await file.read(buffer, total, buffer.length - total, total); if (!bytesRead) break; total += bytesRead; } return buffer.subarray(0, total); }
      finally { await file.close(); }
    };
    const [left, right] = await Promise.all([read(comparison.left), read(comparison.right)]);
    const binary = left.includes(0) || right.includes(0);
    let truncated = left.length > MAX_PREVIEW_BYTES || right.length > MAX_PREVIEW_BYTES;
    const text = (bytes: Buffer) => {
      const decoder = new TextDecoder('utf-8');
      // Streaming decode omits an incomplete UTF-8 character at the byte boundary.
      const value = decoder.decode(bytes.subarray(0, MAX_PREVIEW_BYTES), { stream: bytes.length > MAX_PREVIEW_BYTES });
      const lines = value.split('\n'); if (lines.length > MAX_PREVIEW_LINES) truncated = true;
      return lines.slice(0, MAX_PREVIEW_LINES).join('\n');
    };
    const result: DiffPreview = { path: comparison.path, leftLabel: comparison.left.label, rightLabel: comparison.right.label, left: binary ? '' : text(left), right: binary ? '' : text(right) };
    if (binary) result.binary = true;
    if (truncated) result.truncated = true;
    return result;
  }
  private async workingSide(repo: Repository, filename: string): Promise<Side> {
    // Validate the parent without following the leaf: Git stores a link's target text.
    const candidate = await safeWorkingPath(repo.root, filename, false);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) return { text: await readlink(candidate), label: translate('en', "documents.workingTreeSymbolicLink"), path: filename };
    if (!metadata.isFile()) throw new MessageError(localizeMessage("documents.thisPathIsADirectoryOrSubmoduleNotA"));
    return { workingPath: await safeWorkingPath(repo.root, filename), label: translate('en', "documents.workingTree"), path: filename };
  }
  private async comparison(repo: Repository, target: DiffTarget): Promise<Comparison> {
    let left: Side;
    let right: Side;
    let label: string;
    if (target.kind === 'stash-working') {
      const details = await this.git.stashDetails(repo, target.stashOid), untracked = details.sections.untracked;
      const savedUntracked = untracked?.files.some(item => item.path === target.path);
      const savedTracked = [...details.sections.working.files, ...details.sections.index.files].some(item => item.path === target.path || item.previousPath === target.path);
      if (!savedUntracked && !savedTracked) throw new MessageError(localizeMessage("documents.thisFileIsNotPartOfTheSavedStash"));
      // The Stash tree contains the complete tracked working state, including
      // files with Index-only changes; untracked files live in the third parent.
      left = { source: { kind: 'revision', revision: savedUntracked ? untracked!.commit.oid : details.commit.oid, path: target.path }, label: translate('en', "documents.stash"), path: target.path };
      try { right = await this.workingSide(repo, target.path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; right = { source: { kind: 'empty' }, label: translate('en', "documents.workingTree"), path: target.path }; }
      label = translate('en', "documents.stashWorkingTree", { value: (path.basename(target.path)) });
    } else if (target.kind === 'commit') {
      const details = await this.git.details(repo, target.oid, target.parent);
      const file = details.files.find(f => f.path === target.path);
      if (!file) throw new MessageError(localizeMessage("documents.thisFileIsNotPartOfTheSelectedComparison"));
      const before = file.previousPath ?? file.path;
      left = { source: details.parent && file.status !== 'A' ? { kind: 'revision', revision: details.parent, path: before } : { kind: 'empty' }, label: details.parent?.slice(0, 8) ?? translate('en', "documents.empty"), path: before };
      right = { source: file.status === 'D' ? { kind: 'empty' } : { kind: 'revision', revision: details.commit.oid, path: file.path }, label: details.commit.oid.slice(0, 8), path: file.path };
      label = `${path.basename(file.path)} · ${details.parent?.slice(0, 8) ?? 'empty'} ↔ ${details.commit.oid.slice(0, 8)}`;
    } else if(target.kind==='comparison'){
      const comparison=await this.git.compare(repo,target.left,target.right,true),file=comparison.files.find(item=>item.path===target.path);
      if(!file)throw new MessageError(localizeMessage("documents.thisFileIsNotPartOfTheSelectedComparison"));
      const before=file.previousPath??file.path;
      left={source:file.status==='A'?{kind:'empty'}:{kind:'revision',revision:comparison.left.oid,path:before},label:comparison.left.oid.slice(0,8),path:before};
      right={source:file.status==='D'?{kind:'empty'}:{kind:'revision',revision:comparison.right.oid,path:file.path},label:comparison.right.oid.slice(0,8),path:file.path};
      label=`${path.basename(file.path)} · ${comparison.left.oid.slice(0,8)} ↔ ${comparison.right.oid.slice(0,8)}`;
    } else {
      const snapshot = await this.git.snapshot(repo);
      const change = snapshot.changes.find(c => c.path === target.path);
      if (!change) throw new MessageError(localizeMessage("documents.theFileStatusChangedRefreshAndOpenItsComparison"));
      const before = change.originalPath ?? change.path;
      if (target.area === 'staged') {
        if (change.untracked || change.indexStatus === ' ' || change.indexStatus === '?') throw new MessageError(localizeMessage("documents.thisFileHasNoStagedChangesRefreshItsComparison"));
        const indexPath = change.worktreeStatus === 'R' && change.indexStatus !== 'R' ? before : change.path;
        left = { source: snapshot.head && change.indexStatus !== 'A' ? { kind: 'revision', revision: snapshot.head, path: before } : { kind: 'empty' }, label: 'HEAD', path: before };
        right = { source: change.indexStatus === 'D' ? { kind: 'empty' } : { kind: 'index', path: indexPath }, label: translate('en', "documents.index"), path: indexPath };
        label = `${path.basename(change.path)} · HEAD ↔ Index`;
      } else if (target.area === 'conflict') {
        if (!change.conflict) throw new MessageError(localizeMessage("documents.thisFileNoLongerHasAConflictRefreshIts"));
        left = { source: { kind: 'index', path: change.path, stage: 2 }, label: translate('en', "documents.ours"), path: change.path };
        right = { source: { kind: 'index', path: change.path, stage: 3 }, label: translate('en', "documents.theirs"), path: change.path };
        label = translate('en', "documents.oursTheirsEditWorkingFileToResolve", { value: (path.basename(change.path)) });
      } else {
        if (!change.untracked && change.worktreeStatus === ' ') throw new MessageError(localizeMessage("documents.thisFileHasNoUnstagedChangesRefreshItsComparison"));
        const indexPath = change.worktreeStatus === 'R' ? before : change.path;
        left = { source: change.untracked ? { kind: 'empty' } : { kind: 'index', path: indexPath }, label: translate('en', "documents.index"), path: indexPath };
        right = change.worktreeStatus === 'D' ? { source: { kind: 'empty' }, label: translate('en', "documents.workingTree"), path: change.path } : await this.workingSide(repo, change.path);
        label = translate('en', "documents.indexWorkingTree", { value: (path.basename(change.path)) });
      }
    }
    return { left, right, label, path: target.path };
  }
}
