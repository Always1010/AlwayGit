import { message as localizeMessage, MessageError, translate } from '../i18n/index';
import * as vscode from 'vscode';
import path from 'node:path';
import { open, lstat, readlink } from 'node:fs/promises';
import type { ContentSource, DiffImage, DiffPreview, DiffTarget, GitServiceContract, Repository } from '../protocol/types';
import { safeWorkingPath } from './paths';

const MAX_DOCUMENT = 8 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_PREVIEW_LINES = 4000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 24_000_000;
const MAX_IMAGE_DIMENSION = 16_384;
type Side = { source: ContentSource; label: string; path: string } | { workingPath: string; label: string; path: string } | { text: string; label: string; path: string };
type Comparison = { left: Side; right: Side; label: string; path: string };

type ImageHeader = Pick<DiffImage, 'mimeType' | 'width' | 'height'>;
function imageHeader(bytes: Buffer): ImageHeader | undefined {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { mimeType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 10 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue; }
      if (offset + 4 > bytes.length) break;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { mimeType: 'image/jpeg', width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8X') return { mimeType: 'image/webp', width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
    if (format === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { mimeType: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (format === 'VP8L' && bytes[20] === 0x2f) return { mimeType: 'image/webp', width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8), height: 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)) };
  }
}

function isBinary(bytes: Buffer, truncated: boolean): boolean {
  if (bytes.includes(0)) return true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated }); return false; }
  catch { return true; }
}
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
    const prefix = await this.readWorking(full, MAX_PREVIEW_BYTES + 1);
    if (imageHeader(prefix) || isBinary(prefix.subarray(0, MAX_PREVIEW_BYTES), prefix.length > MAX_PREVIEW_BYTES)) throw new MessageError(localizeMessage("documents.imagesAndBinaryFilesCanOnlyBeViewedInTheAlwayGitDiffPreview"));
    await vscode.window.showTextDocument(vscode.Uri.file(full), { viewColumn: vscode.ViewColumn.Active, preview: false, preserveFocus: false });
  }
  async diff(repo: Repository, target: DiffTarget): Promise<void> {
    const comparison = await this.comparison(repo, target);
    const preview = await this.previewComparison(repo, comparison);
    if (preview.kind !== 'text') throw new MessageError(localizeMessage("documents.imagesAndBinaryFilesCanOnlyBeViewedInTheAlwayGitDiffPreview"));
    const uri = (side: Side) => 'workingPath' in side ? vscode.Uri.file(side.workingPath) : this.uri(repo, 'text' in side ? side.text : side.source, side.label, side.path);
    await vscode.commands.executeCommand('vscode.diff', uri(comparison.left), uri(comparison.right), comparison.label, { viewColumn: vscode.ViewColumn.Active, preview: false, preserveFocus: false });
  }
  async preview(repo: Repository, target: DiffTarget): Promise<DiffPreview> {
    const comparison = await this.comparison(repo, target);
    return this.previewComparison(repo, comparison);
  }
  private async readWorking(filename: string, maxBytes: number): Promise<Buffer> {
    const file = await open(filename, 'r');
    try { const buffer = Buffer.alloc(maxBytes); let total = 0; while (total < buffer.length) { const { bytesRead } = await file.read(buffer, total, buffer.length - total, total); if (!bytesRead) break; total += bytesRead; } return buffer.subarray(0, total); }
    finally { await file.close(); }
  }
  private async readSide(repo: Repository, side: Side, maxBytes: number): Promise<Buffer> {
    if ('text' in side) return Buffer.from(side.text, 'utf8');
    if ('source' in side) return this.git.content(repo, side.source, maxBytes);
    return this.readWorking(side.workingPath, maxBytes);
  }
  private async previewComparison(repo: Repository, comparison: Comparison): Promise<DiffPreview> {
    const read = (side: Side, maxBytes = MAX_PREVIEW_BYTES + 1) => this.readSide(repo, side, maxBytes);
    const [left, right] = await Promise.all([read(comparison.left), read(comparison.right)]);
    const initialHeaders = [left, right].map(bytes => bytes.length ? imageHeader(bytes) : undefined);
    const nonempty = [left, right].map((bytes, index) => bytes.length ? initialHeaders[index] : true);
    if (nonempty.every(Boolean) && initialHeaders.some(Boolean)) {
      const [fullLeft, fullRight] = await Promise.all([left.length > MAX_PREVIEW_BYTES ? read(comparison.left, MAX_IMAGE_BYTES + 1) : left, right.length > MAX_PREVIEW_BYTES ? read(comparison.right, MAX_IMAGE_BYTES + 1) : right]);
      if (fullLeft.length > MAX_IMAGE_BYTES || fullRight.length > MAX_IMAGE_BYTES) return { kind: 'binary', reason: 'image-too-large', path: comparison.path, leftLabel: comparison.left.label, rightLabel: comparison.right.label };
      const side = (bytes: Buffer): DiffImage | undefined => {
        if (!bytes.length) return;
        const header = imageHeader(bytes);
        if (!header) return;
        return { ...header, data: bytes.toString('base64'), byteLength: bytes.length };
      };
      const leftImage = side(fullLeft), rightImage = side(fullRight);
      if ((!leftImage && fullLeft.length) || (!rightImage && fullRight.length)) return { kind: 'binary', reason: 'unsupported', path: comparison.path, leftLabel: comparison.left.label, rightLabel: comparison.right.label };
      if ([leftImage, rightImage].some(image => image && (!image.width || !image.height || image.width > MAX_IMAGE_DIMENSION || image.height > MAX_IMAGE_DIMENSION || image.width * image.height > MAX_IMAGE_PIXELS))) return { kind: 'binary', reason: 'image-dimensions-too-large', path: comparison.path, leftLabel: comparison.left.label, rightLabel: comparison.right.label };
      return { kind: 'image', path: comparison.path, leftLabel: comparison.left.label, rightLabel: comparison.right.label, left: leftImage, right: rightImage };
    }
    const binary = isBinary(left.subarray(0, MAX_PREVIEW_BYTES), left.length > MAX_PREVIEW_BYTES) || isBinary(right.subarray(0, MAX_PREVIEW_BYTES), right.length > MAX_PREVIEW_BYTES);
    let truncated = left.length > MAX_PREVIEW_BYTES || right.length > MAX_PREVIEW_BYTES;
    const text = (bytes: Buffer) => {
      const decoder = new TextDecoder('utf-8');
      // Streaming decode omits an incomplete UTF-8 character at the byte boundary.
      const value = decoder.decode(bytes.subarray(0, MAX_PREVIEW_BYTES), { stream: bytes.length > MAX_PREVIEW_BYTES });
      const lines = value.split('\n'); if (lines.length > MAX_PREVIEW_LINES) truncated = true;
      return lines.slice(0, MAX_PREVIEW_LINES).join('\n');
    };
    if (binary) return { kind: 'binary', reason: 'unsupported', path: comparison.path, leftLabel: comparison.left.label, rightLabel: comparison.right.label };
    const result: DiffPreview = { kind: 'text', path: comparison.path, leftLabel: comparison.left.label, rightLabel: comparison.right.label, left: text(left), right: text(right) };
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
