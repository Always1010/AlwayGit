import * as vscode from 'vscode';
import path from 'node:path';
import { open } from 'node:fs/promises';
import type { ContentSource, DiffPreview, DiffTarget, GitServiceContract, Repository } from '../protocol/types';
import { safeWorkingPath } from './paths';

const MAX_DOCUMENT = 8 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_PREVIEW_LINES = 4000;
type Side = { source: ContentSource; label: string; path: string } | { workingPath: string; label: string; path: string };
type Comparison = { left: Side; right: Side; label: string; path: string };
export class GitDocuments implements vscode.TextDocumentContentProvider {
  private readonly entries = new Map<string, { repo: Repository; source: ContentSource }>();
  private sequence = 0;
  constructor(private readonly git: GitServiceContract) {}
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const entry = this.entries.get(uri.toString());
    if (!entry) throw new Error('This comparison has expired. Open it again from AlwayGit.');
    const data = await this.git.content(entry.repo, entry.source, MAX_DOCUMENT + 1);
    if (data.length > MAX_DOCUMENT) return '[AlwayGit: file exceeds the 8 MB text preview limit.]';
    if (data.includes(0)) return '[AlwayGit: binary file. Text comparison is unavailable.]';
    return data.toString('utf8');
  }
  release(uri: vscode.Uri): void { this.entries.delete(uri.toString()); }
  private uri(repo: Repository, source: ContentSource, label: string, filename: string): vscode.Uri {
    const uri = vscode.Uri.from({ scheme: 'alwaygit-content', path: `/${filename.replace(/\\/g, '/')}`, query: `version=${++this.sequence}&label=${encodeURIComponent(label)}` });
    this.entries.set(uri.toString(), { repo, source });
    return uri;
  }
  async openFile(repo: Repository, filename: string): Promise<void> {
    const full = await safeWorkingPath(repo.root, filename);
    await vscode.window.showTextDocument(vscode.Uri.file(full), { viewColumn: vscode.ViewColumn.Beside, preview: false });
  }
  async diff(repo: Repository, target: DiffTarget): Promise<void> {
    const comparison = await this.comparison(repo, target);
    const uri = (side: Side) => 'workingPath' in side ? vscode.Uri.file(side.workingPath) : this.uri(repo, side.source, side.label, side.path);
    await vscode.commands.executeCommand('vscode.diff', uri(comparison.left), uri(comparison.right), comparison.label, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }
  async preview(repo: Repository, target: DiffTarget): Promise<DiffPreview> {
    const comparison = await this.comparison(repo, target);
    const read = async (side: Side) => {
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
  private async comparison(repo: Repository, target: DiffTarget): Promise<Comparison> {
    let left: Side;
    let right: Side;
    let label: string;
    if (target.kind === 'commit') {
      const details = await this.git.details(repo, target.oid, target.parent);
      const file = details.files.find(f => f.path === target.path);
      if (!file) throw new Error('This file is not part of the selected comparison.');
      const before = file.previousPath ?? file.path;
      left = { source: details.parent && file.status !== 'A' ? { kind: 'revision', revision: details.parent, path: before } : { kind: 'empty' }, label: details.parent?.slice(0, 8) ?? 'Empty', path: before };
      right = { source: file.status === 'D' ? { kind: 'empty' } : { kind: 'revision', revision: details.commit.oid, path: file.path }, label: details.commit.oid.slice(0, 8), path: file.path };
      label = `${path.basename(file.path)} · ${details.parent?.slice(0, 8) ?? 'empty'} ↔ ${details.commit.oid.slice(0, 8)}`;
    } else {
      const snapshot = await this.git.snapshot(repo);
      const change = snapshot.changes.find(c => c.path === target.path);
      if (!change) throw new Error('The file status changed. Refresh and open its comparison again.');
      const before = change.originalPath ?? change.path;
      if (target.area === 'staged') {
        if (change.untracked || change.indexStatus === ' ' || change.indexStatus === '?') throw new Error('This file has no Staged Changes. Refresh its comparison.');
        const indexPath = change.worktreeStatus === 'R' && change.indexStatus !== 'R' ? before : change.path;
        left = { source: snapshot.head && change.indexStatus !== 'A' ? { kind: 'revision', revision: snapshot.head, path: before } : { kind: 'empty' }, label: 'HEAD', path: before };
        right = { source: change.indexStatus === 'D' ? { kind: 'empty' } : { kind: 'index', path: indexPath }, label: 'Index', path: indexPath };
        label = `${path.basename(change.path)} · HEAD ↔ Index`;
      } else if (target.area === 'conflict') {
        if (!change.conflict) throw new Error('This file no longer has a conflict. Refresh its comparison.');
        left = { source: { kind: 'index', path: change.path, stage: 2 }, label: 'Ours', path: change.path };
        right = { source: { kind: 'index', path: change.path, stage: 3 }, label: 'Theirs', path: change.path };
        label = `${path.basename(change.path)} · Ours ↔ Theirs (edit working file to resolve)`;
      } else {
        if (!change.untracked && change.worktreeStatus === ' ') throw new Error('This file has no Unstaged Changes. Refresh its comparison.');
        const indexPath = change.worktreeStatus === 'R' ? before : change.path;
        left = { source: change.untracked ? { kind: 'empty' } : { kind: 'index', path: indexPath }, label: 'Index', path: indexPath };
        right = change.worktreeStatus === 'D' ? { source: { kind: 'empty' }, label: 'Working Tree', path: change.path } : { workingPath: await safeWorkingPath(repo.root, change.path), label: 'Working Tree', path: change.path };
        label = `${path.basename(change.path)} · Index ↔ Working Tree`;
      }
    }
    return { left, right, label, path: target.path };
  }
}
