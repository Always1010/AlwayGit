import * as vscode from 'vscode';
import path from 'node:path';
import type { ContentSource, DiffTarget, GitServiceContract, Repository } from '../protocol/types';
import { safeWorkingPath } from './paths';

const MAX_DOCUMENT = 8 * 1024 * 1024;
export class GitDocuments implements vscode.TextDocumentContentProvider {
  private readonly entries = new Map<string, { repo: Repository; source: ContentSource }>();
  private sequence = 0;
  constructor(private readonly git: GitServiceContract) {}
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const entry = this.entries.get(uri.toString());
    if (!entry) throw new Error('This comparison has expired. Open it again from AlwayGit.');
    const data = await this.git.content(entry.repo, entry.source);
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
    let left: vscode.Uri;
    let right: vscode.Uri;
    let label: string;
    if (target.kind === 'commit') {
      const details = await this.git.details(repo, target.oid, target.parent);
      const file = details.files.find(f => f.path === target.path);
      if (!file) throw new Error('This file is not part of the selected comparison.');
      const before = file.previousPath ?? file.path;
      left = this.uri(repo, details.parent && file.status !== 'A' ? { kind: 'revision', revision: details.parent, path: before } : { kind: 'empty' }, 'parent', before);
      right = this.uri(repo, file.status === 'D' ? { kind: 'empty' } : { kind: 'revision', revision: details.commit.oid, path: file.path }, details.commit.oid.slice(0, 8), file.path);
      label = `${path.basename(file.path)} · ${details.parent?.slice(0, 8) ?? 'empty'} ↔ ${details.commit.oid.slice(0, 8)}`;
    } else {
      const snapshot = await this.git.snapshot(repo);
      const change = snapshot.changes.find(c => c.path === target.path);
      if (!change) throw new Error('The file status changed. Refresh and open its comparison again.');
      const before = change.originalPath ?? change.path;
      if (target.area === 'staged') {
        left = this.uri(repo, snapshot.head && change.indexStatus !== 'A' ? { kind: 'revision', revision: snapshot.head, path: before } : { kind: 'empty' }, 'HEAD', before);
        right = this.uri(repo, change.indexStatus === 'D' ? { kind: 'empty' } : { kind: 'index', path: change.path }, 'Index', change.path);
        label = `${path.basename(change.path)} · HEAD ↔ Index`;
      } else if (target.area === 'conflict') {
        left = this.uri(repo, { kind: 'index', path: change.path, stage: 2 }, 'Ours', change.path);
        right = this.uri(repo, { kind: 'index', path: change.path, stage: 3 }, 'Theirs', change.path);
        label = `${path.basename(change.path)} · Ours ↔ Theirs (edit working file to resolve)`;
      } else {
        left = this.uri(repo, change.untracked ? { kind: 'empty' } : { kind: 'index', path: change.path }, 'Index', change.path);
        right = change.worktreeStatus === 'D' ? this.uri(repo, { kind: 'empty' }, 'Deleted', change.path) : vscode.Uri.file(await safeWorkingPath(repo.root, change.path));
        label = `${path.basename(change.path)} · Index ↔ Working Tree`;
      }
    }
    await vscode.commands.executeCommand('vscode.diff', left, right, label, { viewColumn: vscode.ViewColumn.Beside, preview: true });
  }
}
