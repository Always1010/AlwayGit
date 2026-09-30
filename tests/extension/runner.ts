import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { DiffPreview, GitServiceContract, Repository, Snapshot, HistoryPage } from '../../src/protocol/types';
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
  const sentinel = await vscode.workspace.openTextDocument({ content: 'Keep this editor', language: 'plaintext' });
  await vscode.window.showTextDocument(sentinel, { preview: false, viewColumn: vscode.ViewColumn.One });
  const dirtyEdit = new vscode.WorkspaceEdit(); dirtyEdit.insert(sentinel.uri, new vscode.Position(0, 0), 'Unsaved '); await vscode.workspace.applyEdit(dirtyEdit);
  const groupCount = vscode.window.tabGroups.all.length;
  await api.workbench.handle({ id: 'save', method: 'saveSession', payload: {
    version: 2,
    language: 'zh-CN',
    layout: { preset: 'editor', sidebar: 240, details: 320, diff: 200, author: 110, date: 130, font: 13, row: 26 },
    repoId: repo.id,
    drafts: { [repo.id]: 'Persisted commit draft' },
    views: { [repo.id]: { checkedRefs: ['refs/heads/main'], search: 'fixture', selectedFile: 'sample.ts', tab: 'changes' } },
  } });
  await assert.rejects(api.workbench.handle({ id: 'bad-session', method: 'saveSession', payload: { drafts: { malicious: ['invalid'] } } }));
  await assert.rejects(api.workbench.handle({ id: 'bad-layout', method: 'saveSession', payload: { version: 2, layout: { preset: 'floating' } } }));
  const snapshot = await api.workbench.handle({ id: 'snapshot', method: 'snapshot', repoId: repo.id }) as Snapshot;
  assert.equal(snapshot.branch, 'main');
  assert.deepEqual(snapshot.changes.map(c => [c.path, c.indexStatus, c.worktreeStatus]), [['sample.ts', 'M', 'M']]);
  const history = await api.workbench.handle({ id: 'history', method: 'history', repoId: repo.id, payload: { limit: 100 } }) as HistoryPage;
  await api.workbench.handle({ id: 'project', method: 'openProject', repoId: repo.id });
  assert.equal(history.commits.length, 1); assert.equal(history.commits[0].subject, 'Initial fixture');
  await vscode.commands.executeCommand('alwaygit.open', repo.id);
  const deadline = Date.now() + 12000;
  while (api.workbench.receivedWebviewRequests < 3 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(api.workbench.receivedWebviewRequests >= 3, 'Actual webview scripts must load through CSP and issue repository/history requests');
  await api.workbench.handle({ id: 'staged', method: 'diff', repoId: repo.id, payload: { kind: 'change', area: 'staged', path: 'sample.ts' } });
  assert.ok(vscode.workspace.textDocuments.some(d => d.uri.scheme === 'alwaygit-content' && d.getText().includes('value = 1')));
  assert.ok(vscode.workspace.textDocuments.some(d => d.uri.scheme === 'alwaygit-content' && d.getText().includes('value = 2')));
  const stagedPreview = await api.workbench.handle({ id: 'staged-preview', method: 'diffPreview', repoId: repo.id, payload: { kind: 'change', area: 'staged', path: 'sample.ts' } }) as DiffPreview;
  assert.equal(stagedPreview.path, 'sample.ts');
  assert.equal(stagedPreview.leftLabel, 'HEAD'); assert.equal(stagedPreview.rightLabel, 'Index');
  assert.match(stagedPreview.left, /value = 1/); assert.match(stagedPreview.right, /value = 2/);
  assert.equal(stagedPreview.binary, undefined); assert.equal(stagedPreview.truncated, undefined);
  await api.workbench.handle({ id: 'unstaged', method: 'diff', repoId: repo.id, payload: { kind: 'change', area: 'unstaged', path: 'sample.ts' } });
  const diffTabs = vscode.window.tabGroups.all.flatMap(group => group.tabs).filter(tab => tab.input instanceof vscode.TabInputTextDiff);
  assert.ok(diffTabs.length >= 2, 'Opening another comparison must retain the previous Diff tab');
  assert.ok(diffTabs.every(tab => !tab.isPreview), 'Native Diff tabs must be pinned');
  assert.ok(vscode.workspace.textDocuments.some(d => d.uri.scheme === 'file' && d.getText().includes('value = 3')));
  const unstagedPreview = await api.workbench.handle({ id: 'unstaged-preview', method: 'diffPreview', repoId: repo.id, payload: { kind: 'change', area: 'unstaged', path: 'sample.ts' } }) as DiffPreview;
  assert.equal(unstagedPreview.leftLabel, 'Index'); assert.equal(unstagedPreview.rightLabel, 'Working Tree');
  assert.match(unstagedPreview.left, /value = 2/); assert.match(unstagedPreview.right, /value = 3/);
  await api.workbench.handle({ id: 'copy', method: 'copyText', payload: { text: 'AlwayGit clipboard fixture' } });
  assert.equal(await vscode.env.clipboard.readText(), 'AlwayGit clipboard fixture');
  await api.workbench.handle({ id: 'open', method: 'openFile', repoId: repo.id, payload: { path: 'sample.ts' } });
  assert.equal(vscode.window.activeTextEditor?.document.uri.scheme, 'file');
  assert.equal(vscode.window.tabGroups.all.length, groupCount, 'Native opens must not create a side editor group');
  assert.ok(vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === sentinel.uri.toString()), 'Existing editor must remain open');
  assert.equal(sentinel.isDirty, true); assert.match(sentinel.getText(), /Unsaved Keep this editor/);
  assert.equal(vscode.window.tabGroups.activeTabGroup.activeTab?.isPreview, false);
  const fileTabsBefore = vscode.window.tabGroups.all.flatMap(group => group.tabs).length;
  await api.workbench.handle({ id: 'open-again', method: 'openFile', repoId: repo.id, payload: { path: 'sample.ts' } });
  assert.equal(vscode.window.tabGroups.all.flatMap(group => group.tabs).length, fileTabsBefore, 'Reopening the working file must reuse its pinned tab');
  await assert.rejects(api.workbench.handle({ id: 'bad', method: 'openFile', repoId: repo.id, payload: { path: '../outside.ts' } }), /outside/);
  await assert.rejects(api.workbench.handle({ id: 'bad-action', method: 'action', repoId: repo.id, payload: { type: 'reset', target: 'HEAD', mode: 'bad' } }));
  console.log('ALWAYGIT_EXTENSION_TESTS_PASSED: activation, discovery, session v2, graph queries, native/preview diffs, clipboard, editing, path boundary, message validation');
}
