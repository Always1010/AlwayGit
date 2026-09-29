import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { GitServiceContract, Repository, Snapshot, HistoryPage } from '../../src/protocol/types';
import type { Workbench } from '../../src/extension/workbench';
import type { RepositoryManager } from '../../src/repositories/manager';
import type { GitDocuments } from '../../src/editor/documents';

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<{ git: GitServiceContract; manager: RepositoryManager; documents: GitDocuments; workbench: Workbench }>('alwaygit-dev.alwaygit');
  assert.ok(extension, 'Development extension must be registered');
  const api = await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('alwaygit.open')); assert.ok(commands.includes('alwaygit.refresh'));
  const repos = await api.workbench.handle({ id: 'repos', method: 'repositories' }) as Repository[];
  assert.equal(repos.length, 1);
  const repo = repos[0];
  await api.workbench.handle({ id: 'save', method: 'saveSession', payload: { repoId: repo.id, drafts: { [repo.id]: 'Persisted commit draft' }, views: {} } });
  await assert.rejects(api.workbench.handle({ id: 'bad-session', method: 'saveSession', payload: { drafts: { malicious: ['invalid'] } } }));
  const snapshot = await api.workbench.handle({ id: 'snapshot', method: 'snapshot', repoId: repo.id }) as Snapshot;
  assert.equal(snapshot.branch, 'main');
  assert.deepEqual(snapshot.changes.map(c => [c.path, c.indexStatus, c.worktreeStatus]), [['sample.ts', 'M', 'M']]);
  const history = await api.workbench.handle({ id: 'history', method: 'history', repoId: repo.id, payload: { limit: 100 } }) as HistoryPage;
  assert.equal(history.commits.length, 1); assert.equal(history.commits[0].subject, 'Initial fixture');
  await vscode.commands.executeCommand('alwaygit.open', repo.id);
  const deadline = Date.now() + 12000;
  while (api.workbench.receivedWebviewRequests < 3 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(api.workbench.receivedWebviewRequests >= 3, 'Actual webview scripts must load through CSP and issue repository/history requests');
  await api.workbench.handle({ id: 'staged', method: 'diff', repoId: repo.id, payload: { kind: 'change', area: 'staged', path: 'sample.ts' } });
  assert.ok(vscode.workspace.textDocuments.some(d => d.uri.scheme === 'alwaygit-content' && d.getText().includes('value = 1')));
  assert.ok(vscode.workspace.textDocuments.some(d => d.uri.scheme === 'alwaygit-content' && d.getText().includes('value = 2')));
  await api.workbench.handle({ id: 'unstaged', method: 'diff', repoId: repo.id, payload: { kind: 'change', area: 'unstaged', path: 'sample.ts' } });
  assert.ok(vscode.workspace.textDocuments.some(d => d.uri.scheme === 'file' && d.getText().includes('value = 3')));
  await api.workbench.handle({ id: 'open', method: 'openFile', repoId: repo.id, payload: { path: 'sample.ts' } });
  assert.equal(vscode.window.activeTextEditor?.document.uri.scheme, 'file');
  await assert.rejects(api.workbench.handle({ id: 'bad', method: 'openFile', repoId: repo.id, payload: { path: '../outside.ts' } }), /outside/);
  await assert.rejects(api.workbench.handle({ id: 'bad-action', method: 'action', repoId: repo.id, payload: { type: 'reset', target: 'HEAD', mode: 'bad' } }));
  console.log('ALWAYGIT_EXTENSION_TESTS_PASSED: activation, discovery, graph queries, staged/unstaged native diff, editing, path boundary, message validation');
}
