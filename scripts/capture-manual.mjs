import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

// Capture real built components with isolated sample RPC state. The UI executes no Git,
// shell or VS Code actions; Git is read only to identify the source revision below.
// Stage every selected scene before copying reviewed images; --write replaces only a complete set.
const root = path.resolve(import.meta.dirname, '..');
const capturedAt = '2026-10-30';
const sourceRevision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
const write = process.argv.includes('--write');
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
const from = process.argv.find((arg) => arg.startsWith('--from='))?.slice(7);
const onlyIds = only?.split(',');
assert.ok(
  process.argv
    .slice(2)
    .every(
      (arg) =>
        arg === '--write' || /^--only=\d{2}(?:,\d{2})*$/.test(arg) || /^--from=\d{2}$/.test(arg),
    ),
  'Use --write, --only=NN[,NN…] or --from=NN',
);
assert.ok(!only || !from, 'Use either --only=NN or --from=NN');
assert.ok(!write || (!only && !from), 'Partial captures cannot replace the maintained set');
const output = path.join(root, 'artifacts/manual-capture');
await mkdir(output, { recursive: true });
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
};
const server = createServer(async (request, response) => {
  const resource = new URL(request.url, 'http://localhost').pathname;
  if (resource === '/favicon.ico') {
    response.writeHead(204);
    response.end();
    return;
  }
  const file = path.resolve(
    root,
    'dist/webview',
    '.' + (resource === '/' ? '/index.html' : resource),
  );
  if (path.relative(path.join(root, 'dist/webview'), file).startsWith('..')) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const bytes = await readFile(file);
    response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream');
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const fixture = await build({
  stdin: {
    resolveDir: root,
    contents: `
  import { createDemoRequest } from './webview/demo';
  const options = window.__captureOptions;
  window.__capturePending = 0;
  const request = createDemoRequest(event => window.postMessage(event, '*'));
  // Features without a general Demo response receive explicit, capture-only sample data.
  // These are protocol responses rendered by production components, never replacement markup.
  const sampleTree = [
    { name: 'docs', path: 'docs', type: 'tree', mode: '040000', oid: 'b'.repeat(40) },
    { name: 'src', path: 'src', type: 'tree', mode: '040000', oid: 'c'.repeat(40) },
    { name: 'webview', path: 'webview', type: 'tree', mode: '040000', oid: 'd'.repeat(40) },
    { name: 'package.json', path: 'package.json', type: 'blob', mode: '100644', oid: 'e'.repeat(40), size: 4850 },
    { name: 'README.md', path: 'README.md', type: 'blob', mode: '100644', oid: 'f'.repeat(40), size: 3210 },
  ];
  // A shared snapshot for the two introductory tree figures. Identity and commit
  // metadata come from AlwayGit-Demo; paths and changes are capture-only samples.
  const snapshotFiles = [
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    'docs/getting-started.md',
    'docs/team-workflow.md',
    'docs/images/workbench.png',
    'media/alwaygit.svg',
    'media/icon.png',
    'scripts/build.mjs',
    'scripts/check.mjs',
    'scripts/package.mjs',
    'src/application/history.ts',
    'src/application/session.ts',
    'src/extension/commands.ts',
    'src/extension/extension.ts',
    'src/git/branches.ts',
    'src/git/history.ts',
    'src/git/service.ts',
    'src/git/status.ts',
    'src/protocol/settings.ts',
    'src/protocol/types.ts',
    'tests/branches.test.ts',
    'tests/history.test.ts',
    'tests/status.test.ts',
    'webview/components/FileList.tsx',
    'webview/components/Toolbar.tsx',
    'webview/graph/layout.ts',
    'webview/graph/paths.ts',
    'webview/App.tsx',
    'webview/Details.tsx',
    'webview/History.tsx',
    'webview/styles.css',
    '.gitignore',
    'package.json',
    'README.md',
  ];
  const snapshotEntries = new Map();
  for (const file of snapshotFiles) {
    const parts = file.split('/');
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/');
      const directory = index < parts.length - 1;
      if (!snapshotEntries.has(path)) {
        snapshotEntries.set(path, {
          name,
          path,
          type: directory ? 'tree' : 'blob',
          mode: directory ? '040000' : '100644',
          oid: (snapshotEntries.size + 1).toString(16).padStart(40, '0'),
          ...(!directory ? { size: 1024 + index * 128 } : {}),
        });
      }
    });
  }
  const snapshotChanges = [
    ['docs/team-workflow.md', 'M'],
    ['scripts/check.mjs', 'M'],
    ['src/application/history.ts', 'M'],
    ['src/git/service.ts', 'A'],
    ['tests/history.test.ts', 'M'],
    ['webview/App.tsx', 'M'],
    ['webview/History.tsx', 'M'],
    ['webview/styles.css', 'M'],
  ].map(([path, status]) => ({
    path,
    status,
    beforeMode: status === 'A' ? '000000' : '100644',
    afterMode: '100644',
    beforeOid: (status === 'A' ? '0' : 'a').repeat(40),
    afterOid: snapshotEntries.get(path).oid,
  }));
  let treeExpansion = { mode: 'expanded', overrides: {} };
  async function captureRequest(method, payload, repoId) {
    if (options.tree) {
      if (method === 'revisionTree' || method === 'revisionTreeIndex') {
        return {
          revision: payload.revision,
          path: payload.path ?? '',
          entries: [...snapshotEntries.values()].filter(entry =>
            method === 'revisionTreeIndex' ||
            entry.path.slice(0, Math.max(0, entry.path.lastIndexOf('/'))) === (payload.path ?? '')
          ),
        };
      }
      if (method === 'revisionTreeCommit') {
        const details = await request('details', { oid: payload.revision }, repoId);
        const snapshot = await request('snapshot', undefined, repoId);
        return { commit: details.commit, body: details.body, repository: snapshot.repository };
      }
      if (method === 'revisionTreeChanges') {
        return {
          revision: payload.revision,
          parent: payload.parent,
          files: snapshotChanges,
        };
      }
      if (method === 'treeExpansionRead') return treeExpansion;
      if (method === 'treeExpansionPatch') {
        if (payload.kind === 'mode') treeExpansion = { mode: payload.mode, overrides: {} };
        else treeExpansion.overrides[payload.path] = payload.expanded;
        return treeExpansion;
      }
      if (method === 'treeExpansionHintRead') return true;
    }
    if (method === 'revisionTree') return { revision: payload.revision, path: payload.path ?? '', entries: !payload.path ? sampleTree : payload.path === 'webview' ? ['App.tsx', 'History.tsx', 'styles.css'].map((name, index) => ({ name, path: 'webview/' + name, type: 'blob', mode: '100644', oid: String(index + 1).repeat(40), size: [23580, 17840, 48210][index] })) : [] };
    if (method === 'lfsStatus' || method === 'lfsTrackPreview') {
      const snapshot = await request('snapshot', undefined, repoId);
      const context = { head: snapshot.head, branch: snapshot.branch };
      if (method === 'lfsTrackPreview') return { ...context, token: '22222222-2222-4222-8222-222222222222', pattern: payload.pattern, operation: payload.operation,
        before: '*.psd filter=lfs diff=lfs merge=lfs -text\\n', after: '*.psd filter=lfs diff=lfs merge=lfs -text\\n*.mp4 filter=lfs diff=lfs merge=lfs -text\\n' };
      return { ...context, available: true, version: 'git-lfs/3.7.0 (sample)', filterConfigured: true, checkedAt: Date.now(), remoteAvailability: 'unknown', truncated: false,
        destinations: { origin: { fetch: 'd'.repeat(64), push: 'd'.repeat(64) } }, statusText: 'Objects to be pushed to origin:\\n\\nObjects to be committed:\\n\\tassets/design.psd (LFS: sample object)\\n',
        files: [
          { path: 'assets/design.psd', oid: 'a1'.repeat(32), size: 12582912, worktree: 'content', localObject: 'available', staged: true, unstaged: false },
          { path: 'media/demo.mp4', oid: 'b2'.repeat(32), size: 52428800, worktree: 'pointer', localObject: 'missing', staged: false, unstaged: false },
        ] };
    }
    return request(method, payload, repoId);
  }
  let committed;
  // Leave the mode unset in ordinary scenes so production defaults remain authoritative.
  const preferences = { appearance: { theme: 'system' }, ...(options.changeListMode ? { changeListMode: options.changeListMode } : {}) };
  let session = { version: 2, repoId: 'demo-alwaygit', language: 'en',
    layout: { preset: 'workbench', sidebar: 248, details: 350, diff: 260, graph: 75, author: 105, date: 120, font: 13, row: 24 },
    drafts: {}, views: { 'demo-alwaygit': { search: '', tab: 'changes', expandedRefGroups: ['local:feature'] } } };
  if (options.tree) {
    session = { commitTree: { repoId: 'demo-alwaygit', revision: '009a73edc42d9918a6bc5e4791033ad7e6f202cc' } };
    window.__ALWAYGIT_COMMIT_TREE__ = session;
  }
  window.__ALWAYGIT_HOST__ = options.host || 'editor';
  window.__ALWAYGIT_PREFERENCES__ = preferences;
  window.acquireVsCodeApi = () => ({ getState: () => session, setState: value => { session = value; }, postMessage: async call => {
    window.__capturePending++;
    try {
      if (call.method === 'action' && options.blockRestore && call.payload.type === 'stash.apply') {
        window.postMessage({ type: 'response', id: call.id, error: { message: 'Restore stopped: local changes overlap the saved state.', code: 'STASH_RESTORE_CONFLICT',
          details: { kind: 'stash-apply', reason: 'restore-conflict', paths: ['webview/App.tsx'], conflictPaths: ['webview/App.tsx'], selector: 'stash@{0}', stashOid: 'a'.repeat(40), stashRetained: true, workingTreeUnchanged: true, output: 'CONFLICT (content): Merge conflict in webview/App.tsx' } } }, '*'); return;
      }
      const beforeCommit = call.method === 'action' && call.payload.type === 'commit' ? await request('snapshot', undefined, call.repoId) : undefined;
      let result = await captureRequest(call.method, call.payload, call.repoId);
      if (beforeCommit && !call.payload.amend) committed = { oid: result.head, paths: call.payload.files?.map(file => file.path) ?? beforeCommit.changes.filter(file => !file.untracked && file.indexStatus !== ' ').map(file => file.path) };
      if (call.method === 'details' && committed?.oid === result.commit.oid) { result.files = committed.paths.map(path => ({ path, status: 'M' })); result.body = ''; }
      if (call.method === 'interfaceSettings') result = preferences;
      if (call.method === 'repositories') result[0].collectionId = 'learning';
      if (call.method === 'repositoryCollections') result = [{ id: 'learning', name: 'learning labs' }];
      if (call.method === 'snapshot' && options.operation) {
        result.operation = { kind: 'merge', conflicts: options.operation === 'conflict' ? 1 : 0, canContinue: options.operation !== 'conflict', canAbort: true, canSkip: false, originalHead: result.head };
        result.changes = [{ path: 'webview/App.tsx', indexStatus: options.operation === 'conflict' ? 'U' : 'M', worktreeStatus: options.operation === 'conflict' ? 'U' : ' ', conflict: options.operation === 'conflict', untracked: false }];
      }
      if (call.method === 'operationReview') result = { kind: 'merge', token: 'sample-review', files: [{ path: 'webview/App.tsx', lines: [] }] };
      if (call.method === 'snapshot' && options.overlappingChanges) result.changes[0].worktreeStatus = 'M';
      if (call.method === 'diffPreview' && call.payload.kind === 'revision') result = { kind: 'text', path: call.payload.path,
        leftLabel: call.payload.revision.slice(0, 8) + ' · ' + call.payload.path, rightLabel: 'Working Tree',
        left: 'export function Workbench() {\\n  return <HistoryPanel />;\\n}\\n', right: 'export function Workbench() {\\n  return (\\n    <WorkbenchLayout>\\n      <HistoryPanel />\\n      <CommitDetails />\\n    </WorkbenchLayout>\\n  );\\n}\\n' };
      if (call.method === 'stashDetails') {
        result.sections.index.files = [{ path: 'webview/App.tsx', status: 'M' }]; result.totalFiles = 2;
      }
      // The linear Rebase Demo rewrites sample ancestry but retains a historical merge title.
      // Give that single-parent sample a matching title in both the plan and its inspector.
      if (options.query === 'interactiveRebase=1') {
        const subject = 'Refine repository history layout';
        if (call.method === 'prepareInteractiveRebase') for (const commit of result.commits) {
          if (commit.subject.startsWith('Merge branch ')) { commit.subject = subject; commit.message = subject; }
        }
        if (call.method === 'inspectDetails' && result.commit.subject.startsWith('Merge branch ')) {
          result.body = result.body.replace(result.commit.subject, subject); result.commit.subject = subject;
        }
      }
      window.postMessage({ type: 'response', id: call.id, result }, '*');
    } catch (error) { window.postMessage({ type: 'response', id: call.id, error: { message: error.message, code: error.code, details: error.details } }, '*'); }
    finally { window.__capturePending--; }
  } });
`,
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
  target: 'chrome128',
});
const fixtureCode = fixture.outputFiles[0].text;
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const dialog = (page) => page.getByRole('dialog');
const history = (page) => page.getByTestId('history');
const rows = (page) => history(page).locator('[data-oid]');
const sidebar = (page) => page.getByTestId('sidebar');
const details = (page) => page.getByTestId('details');
async function menu(page, locator, name) {
  await locator.click({ button: 'right' });
  const item = page.getByTestId('context-menu').getByRole('menuitem', { name, exact: true });
  await item.click();
  await dialog(page).waitFor();
}
async function branch(page, name = 'feature/history-graph') {
  const expand = button(sidebar(page), 'Expand feature');
  if (await expand.isVisible()) await expand.click();
  return button(sidebar(page), `Branch ${name}`);
}
async function settings(page, name) {
  await button(page, 'Settings').click();
  await button(page.getByTestId('interface-settings'), name).click();
}
async function toolbarMenu(page, name) {
  await page.getByTestId('toolbar-more').click();
  await page.getByRole('menuitem', { name, exact: true }).click();
  await dialog(page).waitFor();
}
async function contextAction(page, locator, name) {
  await locator.click({ button: 'right' });
  await page.getByTestId('context-menu').getByRole('menuitem', { name, exact: true }).click();
}
async function file(page, name = 'webview/App.tsx') {
  await details(page).getByRole('button', { name, exact: true }).first().click();
  await page.getByTestId('diff-preview').waitFor();
}
async function commit(page, message, amend = false) {
  await page.locator('.toolbar .commit-trigger').click();
  if (amend) await dialog(page).locator('.commit-amend input').check();
  await dialog(page).getByRole('textbox', { name: 'Commit message', exact: true }).fill(message);
}
const scenes = [
  [
    '01',
    {},
    async (p) => {
      await p.getByTestId('toolbar-more').click();
      await p.getByRole('menuitem', { name: 'Workbench Locations', exact: true }).click();
      await dialog(p).waitFor();
      const checkboxes = await dialog(p).getByRole('checkbox').all();
      assert.equal(checkboxes.length, 4);
      for (const checkbox of checkboxes) await checkbox.check();
    },
  ],
  [
    '02',
    {},
    async (p) => {
      await settings(p, 'Language');
      await dialog(p)
        .getByRole('combobox', { name: 'Language', exact: true })
        .selectOption('zh-CN');
    },
  ],
  [
    '03',
    {},
    async (p) => {
      await file(p);
    },
  ],
  [
    '04',
    {},
    async (p) => {
      await commit(p, 'Add quick start documentation');
      await button(dialog(p), 'Commit').click();
      await dialog(p).waitFor({ state: 'hidden' });
      await rows(p).first().click();
      await file(p);
    },
  ],
  [
    '05',
    {},
    async (p) => {
      await settings(p, 'File list');
    },
  ],
  [
    '06',
    {},
    async (p) => {
      await sidebar(p)
        .getByRole('button', { name: /^AlwayGit-Demo/ })
        .click();
      await branch(p);
    },
  ],
  [
    '07',
    {},
    async (p) => {
      await details(p).getByRole('searchbox').fill('webview');
      await file(p, 'webview/styles.css');
    },
  ],
  [
    '08',
    { overlappingChanges: true },
    async (p) => {
      const f = details(p).getByRole('button', { name: 'webview/App.tsx', exact: true }).first();
      await menu(p, f, 'Commit Selected…');
      await dialog(p).getByRole('textbox').fill('Polish workbench layout');
    },
  ],
  [
    '09',
    {},
    async (p) => {
      const dock = p.getByTestId('bottom-dock');
      await button(dock, 'New embedded terminal').click();
      await dock.locator('.terminal-content:not([hidden]) textarea').waitFor();
      await button(dock, 'New embedded terminal').click();
      await dock.getByRole('tab', { name: 'PowerShell 2', exact: true }).click();
      await button(dock, 'Rename terminal').click();
      await p.getByRole('textbox', { name: 'Rename terminal' }).fill('dev server');
      await button(dialog(p), 'Apply').click();
      await dock.getByRole('tab', { name: 'dev server', exact: true }).waitFor();
    },
  ],
  [
    '10',
    {},
    async (p) => {
      await settings(p, 'Keyboard shortcuts');
    },
  ],
  [
    '11',
    {},
    async (p) => {
      await commit(p, 'Polish repository workbench interactions', true);
      await button(dialog(p), 'Amend Commit').click();
      await dialog(p).waitFor({ state: 'hidden' });
      await rows(p).first().click();
      await file(p);
    },
  ],
  [
    '12',
    {},
    async (p) => {
      await sidebar(p).locator('.tag-status-synced').first().click();
      await dialog(p).waitFor();
    },
  ],
  [
    '13',
    {},
    async (p) => {
      await history(p)
        .getByRole('textbox', { name: 'Search commit history', exact: true })
        .fill('native diff');
      await rows(p).first().click();
      await file(p);
    },
  ],
  [
    '14',
    {},
    async (p) => {
      await rows(p).nth(3).click();
      await rows(p)
        .nth(1)
        .click({ modifiers: ['Control'] });
      await details(p).getByText('Compare Commits', { exact: true }).waitFor();
      await file(p);
    },
  ],
  [
    '15',
    {},
    async (p) => {
      await button(sidebar(p), 'Create Branch…').click();
      await dialog(p).getByLabel('Branch Name', { exact: true }).fill('feature/guide');
    },
  ],
  [
    '16',
    {},
    async (p) => {
      await menu(p, button(sidebar(p), 'Branch origin/develop'), 'Checkout as Local Branch…');
    },
  ],
  [
    '17',
    {},
    async (p) => {
      await menu(p, await branch(p, 'feature/test'), 'Merge…');
    },
  ],
  [
    '18',
    { operation: 'conflict' },
    async (p) => {
      await file(p);
    },
  ],
  [
    '19',
    { operation: 'ready' },
    async (p) => {
      await button(p.getByTestId('operation-notice'), 'Continue').click();
      await dialog(p).waitFor();
    },
  ],
  [
    '20',
    { operation: 'conflict' },
    async (p) => {
      await button(p.getByTestId('operation-notice'), 'Abort Merge…').click();
    },
  ],
  [
    '21',
    {},
    async (p) => {
      await button(p.locator('.toolbar'), 'Stash All Changes…').click();
      await dialog(p).getByLabel('Include untracked files').check();
    },
  ],
  [
    '22',
    {},
    async (p) => {
      await menu(
        p,
        details(p).getByRole('button', { name: 'webview/App.tsx', exact: true }),
        'Stash Selected Files…',
      );
    },
  ],
  [
    '23',
    {},
    async (p) => {
      await sidebar(p).getByRole('button').filter({ hasText: 'stash@{0}' }).click();
      await details(p).getByRole('tab', { name: 'Index 1', exact: true }).click();
      await file(p);
    },
  ],
  [
    '24',
    { blockRestore: true },
    async (p) => {
      await menu(p, sidebar(p).getByRole('button').filter({ hasText: 'stash@{0}' }), 'Pop Stash');
      await button(dialog(p), 'Pop Stash').click();
      await dialog(p).getByText('Confirmed conflicting files', { exact: true }).waitFor();
    },
  ],
  [
    '25',
    {},
    async (p) => {
      await button(sidebar(p), 'Add Remote…').click();
      await dialog(p).getByLabel('Remote Name', { exact: true }).fill('upstream');
      await dialog(p)
        .getByLabel('Repository URL', { exact: true })
        .fill('https://example.com/team/project.git');
    },
  ],
  [
    '26',
    {},
    async (p) => {
      await button(p, 'Pull').click();
    },
  ],
  [
    '27',
    {},
    async (p) => {
      await menu(p, await branch(p, 'feature/test'), 'Push…');
    },
  ],
  [
    '28',
    {},
    async (p) => {
      await menu(p, rows(p).nth(1), 'Create Tag…');
      await dialog(p).getByLabel('Tag Name', { exact: true }).fill('v1.1.0');
    },
  ],
  [
    '29',
    {},
    async (p) => {
      await rows(p).nth(1).click({ button: 'right' });
      await p
        .getByTestId('context-menu')
        .getByRole('menuitem', { name: 'Reapply Historical Commits…', exact: true })
        .waitFor();
    },
  ],
  [
    '30',
    {},
    async (p) => {
      await menu(p, rows(p).nth(1), 'Revert…');
    },
  ],
  [
    '31',
    {},
    async (p) => {
      await menu(p, rows(p).nth(1), 'Reset…');
      await dialog(p).getByLabel('Reset Mode', { exact: true }).selectOption('soft');
    },
  ],
  [
    '32',
    {},
    async (p) => {
      await menu(p, await branch(p, 'feature/test'), 'Rebase…');
    },
  ],
  [
    '33',
    {},
    async (p) => {
      await button(sidebar(p), 'Add Worktree…').click();
      await dialog(p)
        .getByLabel('Worktree Folder', { exact: true })
        .fill('D:\\Examples\\AlwayGit-Demo-guide');
      await dialog(p).getByLabel('New Branch', { exact: true }).fill('feature/guide');
    },
  ],
  [
    '34',
    {},
    async (p) => {
      await button(sidebar(p), 'Add…').click();
      await button(dialog(p), 'Choose Folder…').click();
      await dialog(p).getByText('NotesAnywhere', { exact: true }).waitFor();
    },
  ],
  [
    '35',
    {},
    async (p) => {
      await button(p, 'Pull').click();
      await button(dialog(p), 'Change pull source').click();
      await dialog(p).getByLabel('Source branch', { exact: true }).fill('develop');
    },
  ],
  [
    '36',
    {},
    async (p) => {
      await menu(p, sidebar(p).locator('.tag-row').first(), 'Delete Tag…');
      await dialog(p).getByLabel('Also delete from a remote', { exact: true }).check();
      await dialog(p)
        .getByText(/shared remote/)
        .waitFor();
    },
  ],
  [
    '37',
    {},
    async (p) => {
      await settings(p, 'Git operations');
    },
  ],
  [
    '38',
    {},
    async (p) => {
      await settings(p, 'Diff');
    },
  ],
  [
    '39',
    { host: 'sidebar', viewport: { width: 380, height: 820 } },
    async (p) => {
      await button(p.getByRole('navigation', { name: 'Workbench Regions' }), 'History').click();
      await rows(p).first().waitFor();
    },
  ],
  [
    '40',
    {},
    async (p) => {
      await commit(p, 'Polish workbench layout');
      await button(dialog(p), 'Commit').click();
      await dialog(p).waitFor({ state: 'hidden' });
      await p.getByTestId('action-feedback').waitFor();
      await button(p.getByTestId('action-feedback'), 'Operation details').click();
    },
  ],
  [
    '41',
    {},
    async (p) => {
      await button(history(p), 'Advanced history search').click();
      await history(p)
        .getByLabel('Author name or email (literal)', { exact: true })
        .fill('Alex Chen');
      await history(p)
        .getByLabel('File or directory (literal, repository relative)', { exact: true })
        .fill('webview/');
      await history(p)
        .getByLabel('Committer date from (UTC, inclusive)', { exact: true })
        .fill('2026-09-01');
      await history(p)
        .getByLabel('Added or removed code (one line)', { exact: true })
        .fill('HistoryPanel');
    },
  ],
  [
    '42',
    {},
    async (p) => {
      await contextAction(
        p,
        details(p).getByRole('button', { name: 'webview/App.tsx', exact: true }),
        'Show File History',
      );
      await history(p).getByRole('group', { name: 'File History', exact: true }).waitFor();
      await rows(p).first().click();
      await file(p);
    },
  ],
  [
    '43',
    {},
    async (p) => {
      await rows(p).first().click();
      await button(details(p), 'Full Tree').click();
      const tree = details(p).getByRole('tree');
      await button(tree, 'webview').click();
      await button(tree, 'App.tsx').click();
      await p.getByTestId('diff-preview').waitFor();
    },
  ],
  [
    '44',
    {},
    async (p) => {
      await menu(p, await branch(p, 'feature/test'), 'Compare with Current Branch');
      await dialog(p)
        .getByRole('combobox', { name: 'Comparison mode', exact: true })
        .selectOption('snapshot');
      await dialog(p).locator('.comparison-files .file-item').first().waitFor();
    },
  ],
  [
    '45',
    {},
    async (p) => {
      await toolbarMenu(p, 'Open Reflog');
      await dialog(p)
        .getByLabel('Recovery branch name', { exact: true })
        .fill('recovery/layout-review');
      await dialog(p).locator('.revision-inspector strong').first().waitFor();
    },
  ],
  [
    '46',
    {},
    async (p) => {
      await button(sidebar(p), 'Worktree Overview').click();
      await p.locator('.worktree-overview .overview-row').first().waitFor();
      await p
        .locator('.worktree-overview .overview-row')
        .first()
        .getByText('Ready', { exact: true })
        .waitFor();
    },
  ],
  [
    '47',
    { query: 'interactiveRebase=1' },
    async (p) => {
      await menu(p, button(sidebar(p), 'Branch main'), 'Interactive Rebase');
      const action = dialog(p).getByRole('combobox', { name: 'Rebase action', exact: true });
      await action.first().selectOption('reword');
      await dialog(p)
        .locator('.rebase-plan li')
        .first()
        .locator('textarea')
        .fill('Clarify repository workbench layout');
      await action.nth(1).selectOption('fixup');
      await dialog(p).locator('.revision-inspector strong').first().waitFor();
    },
  ],
  [
    '48',
    {},
    async (p) => {
      await toolbarMenu(p, 'Git LFS');
      await dialog(p).getByLabel('Filename / glob', { exact: true }).fill('*.mp4');
      await dialog(p).getByLabel('Literal filename', { exact: true }).uncheck();
      await button(dialog(p), 'Preview attributes').click();
      await dialog(p).locator('.lfs-attributes').waitFor();
    },
  ],
  [
    '49',
    { changeListMode: 'split', capture: 'details' },
    async (p) => {
      await file(p, 'webview/styles.css');
    },
  ],
  [
    '50',
    { capture: 'diff' },
    async (p) => {
      await rows(p).first().click();
      await file(p);
      const diff = p.getByTestId('diff-preview');
      await diff
        .getByTestId('diff-change-count')
        .getByText('File 1/3 · Change 1/1', { exact: true })
        .waitFor();
      await button(diff, 'Previous change').click();
      await diff.getByTestId('diff-navigation-boundary').waitFor();
    },
  ],
  [
    '51',
    { tree: true },
    async (p) => {
      await p.getByRole('combobox', { name: 'File tree presentation' }).selectOption('horizontal');
      await p.getByRole('checkbox', { name: 'Change markers' }).check();
      await button(p.locator('.commit-tree-secondary-controls'), 'Show changes only').click();
      await p.locator('.tree-graph-node[data-path="src/git/service.ts"]').waitFor();
      await button(p, 'Fit entire tree (0)').click();
      assert.equal(await p.locator('.tree-graph-node[data-status="A"]').count(), 1);
      assert.equal(await p.locator('.tree-graph-node[data-status="M"]').count(), 7);
    },
  ],
  [
    '52',
    { tree: true },
    async (p) => {
      await p.getByRole('combobox', { name: 'File tree presentation' }).selectOption('radial');
      await p.locator('.tree-graph-node[data-path="webview/styles.css"]').waitFor();
      await button(p, 'Fit entire tree (0)').click();
      assert.equal(await p.getByRole('checkbox', { name: 'Change markers' }).isChecked(), false);
      assert.equal(await p.locator('.tree-graph-node[data-status]').count(), 0);
    },
  ],
];

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.ALWAYGIT_BROWSER_EXECUTABLE
      ? { executablePath: process.env.ALWAYGIT_BROWSER_EXECUTABLE }
      : process.platform === 'win32'
        ? { channel: 'msedge' }
        : {}),
  });
  if (onlyIds)
    assert.ok(
      onlyIds.every((id) => scenes.some((scene) => scene[0] === id)),
      'Unknown scene',
    );
  const selected = scenes.filter(
    ([id]) => (!onlyIds || onlyIds.includes(id)) && (!from || id >= from),
  );
  assert.ok(selected.length, 'Unknown scene');
  for (const [id, options, prepare] of selected) {
    const context = await browser.newContext({
      viewport: options.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      locale: 'en-US',
      timezoneId: 'Asia/Shanghai',
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.clock.install({ time: new Date(`${capturedAt}T04:00:00Z`) });
      await page.addInitScript((options) => {
        window.__captureOptions = options;
      }, options);
      await page.addInitScript({ content: fixtureCode });
      await page.goto(url + (options.query ? '?' + options.query : ''));
      if (options.tree) {
        await page
          .locator(
            '.commit-tree-secondary-controls button[aria-label="Expand all directories"]:enabled',
          )
          .waitFor();
      } else {
        await details(page).waitFor({ state: options.host ? 'attached' : 'visible' });
        if (!options.host) await rows(page).first().waitFor();
      }
      await prepare(page);
      await page.waitForFunction(() => window.__capturePending === 0);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      await page.getByText('Loading Diff…', { exact: true }).waitFor({ state: 'hidden' });
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      const viewport = page.viewportSize();
      await page.mouse.move(viewport.width - 4, viewport.height - 4);
      const visibleDialog = dialog(page);
      let clip;
      if (options.capture) {
        clip = await (
          options.capture === 'details' ? details(page) : page.getByTestId('diff-preview')
        ).boundingBox();
        assert.ok(clip, 'Capture region must be visible');
        if (options.capture === 'details') {
          const lastGroup = await details(page).locator('.change-group').last().boundingBox();
          assert.ok(lastGroup, 'Split groups must be visible');
          clip.height = Math.min(clip.height, lastGroup.y + lastGroup.height + 8 - clip.y);
        }
      } else if (await visibleDialog.isVisible()) {
        const box = await visibleDialog.boundingBox();
        const x = Math.max(0, box.x - 16),
          y = Math.max(0, box.y - 16);
        clip = {
          x,
          y,
          width: Math.min(viewport.width - x, box.width + 32),
          height: Math.min(viewport.height - y, box.height + 32),
        };
      }
      await page.screenshot({
        path: path.join(output, `figure-${id}.png`),
        animations: 'disabled',
        clip,
      });
      assert.deepEqual(errors, []);
      console.log(`CAPTURED figure-${id}.png`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `failure-${id}.png`) });
      console.error((await page.locator('body').innerText()).slice(-5000));
      throw new Error(`Capture ${id} failed`, { cause: error });
    } finally {
      await context.close();
    }
  }
  await writeFile(
    path.join(output, 'capture-manifest.json'),
    JSON.stringify({ capturedAt, sourceRevision, scenes: selected.map(([id]) => id) }, null, 2) +
      '\n',
  );
  if (write)
    for (const [id] of scenes)
      await copyFile(
        path.join(output, `figure-${id}.png`),
        path.join(root, `docs/images/user-manual/figure-${id}.png`),
      );
  console.log(
    `${scenes.length} available scenes; ${write ? 'maintained set replaced' : 'preview files in artifacts/manual-capture'}`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
