import { chromium } from 'playwright';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Capture real built components with isolated sample RPC state. No Git, shell or VS Code commands run.
// Stage the complete set before --write replaces any maintained screenshot.
const root = path.resolve(import.meta.dirname, '..');
const write = process.argv.includes('--write');
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7);
const from = process.argv.find(arg => arg.startsWith('--from='))?.slice(7);
assert.ok(process.argv.slice(2).every(arg => arg === '--write' || /^--(?:only|from)=\d{2}$/.test(arg)), 'Use --write, --only=NN or --from=NN');
assert.ok(!write || !only && !from, 'Partial captures cannot replace the maintained set');
const output = path.join(root, 'artifacts/manual-capture');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  const resource = new URL(request.url, 'http://localhost').pathname;
  if (resource === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  const file = path.resolve(root, 'dist/webview', '.' + (resource === '/' ? '/index.html' : resource));
  if (path.relative(path.join(root, 'dist/webview'), file).startsWith('..')) { response.writeHead(403); response.end(); return; }
  try { const bytes = await readFile(file); response.setHeader('Content-Type', mime[path.extname(file)] ?? 'application/octet-stream'); response.end(bytes); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const fixture = await build({ stdin: { resolveDir: root, contents: `
  import { createDemoRequest } from './webview/demo';
  const options = window.__captureOptions;
  window.__capturePending = 0;
  const request = createDemoRequest(event => window.postMessage(event, '*'));
  let committed;
  let session = { version: 2, repoId: 'demo-alwaygit', language: 'en', changeListMode: options.unified ? 'unified' : 'split',
    layout: { preset: 'workbench', sidebar: 248, details: 350, diff: 260, graph: 75, author: 105, date: 120, font: 13, row: 24 },
    drafts: {}, views: { 'demo-alwaygit': { search: '', tab: 'changes', expandedRefGroups: ['local:feature'] } } };
  window.__ALWAYGIT_HOST__ = options.host || 'editor';
  window.__ALWAYGIT_PREFERENCES__ = { appearance: { theme: 'dark' }, changeListMode: options.unified ? 'unified' : 'split' };
  window.acquireVsCodeApi = () => ({ getState: () => session, setState: value => { session = value; }, postMessage: async call => {
    window.__capturePending++;
    try {
      if (call.method === 'action' && options.blockRestore && call.payload.type === 'stash.apply') {
        window.postMessage({ type: 'response', id: call.id, error: { message: 'Restore stopped: local changes overlap the saved state.', code: 'STASH_RESTORE_CONFLICT',
          details: { kind: 'stash-apply', reason: 'restore-conflict', paths: ['webview/App.tsx'], conflictPaths: ['webview/App.tsx'], selector: 'stash@{0}', stashOid: 'a'.repeat(40), stashRetained: true, workingTreeUnchanged: true, output: 'CONFLICT (content): Merge conflict in webview/App.tsx' } } }, '*'); return;
      }
      const beforeCommit = call.method === 'action' && call.payload.type === 'commit' ? await request('snapshot', undefined, call.repoId) : undefined;
      let result = await request(call.method, call.payload, call.repoId);
      if (beforeCommit && !call.payload.amend) committed = { oid: result.head, paths: call.payload.files?.map(file => file.path) ?? beforeCommit.changes.filter(file => !file.untracked && file.indexStatus !== ' ').map(file => file.path) };
      if (call.method === 'details' && committed?.oid === result.commit.oid) { result.files = committed.paths.map(path => ({ path, status: 'M' })); result.body = ''; }
      if (call.method === 'interfaceSettings') result = { appearance: { theme: 'dark' }, changeListMode: options.unified ? 'unified' : 'split' };
      if (call.method === 'repositories') result[0].collectionId = 'learning';
      if (call.method === 'repositoryCollections') result = [{ id: 'learning', name: 'learning labs' }];
      if (call.method === 'snapshot' && options.operation) {
        result.operation = { kind: 'merge', conflicts: options.operation === 'conflict' ? 1 : 0, canContinue: options.operation !== 'conflict', canAbort: true, canSkip: false, originalHead: result.head };
        result.changes = [{ path: 'webview/App.tsx', indexStatus: options.operation === 'conflict' ? 'U' : 'M', worktreeStatus: options.operation === 'conflict' ? 'U' : ' ', conflict: options.operation === 'conflict', untracked: false }];
      }
      if (call.method === 'operationReview') result = { kind: 'merge', token: 'sample-review', files: [{ path: 'webview/App.tsx', lines: [] }] };
      if (call.method === 'snapshot' && options.unified) result.changes[0].worktreeStatus = 'M';
      if (call.method === 'stashDetails') {
        result.sections.index.files = [{ path: 'webview/App.tsx', status: 'M' }]; result.totalFiles = 2;
      }
      window.postMessage({ type: 'response', id: call.id, result }, '*');
    } catch (error) { window.postMessage({ type: 'response', id: call.id, error: { message: error.message, code: error.code, details: error.details } }, '*'); }
    finally { window.__capturePending--; }
  } });
` }, bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome128' });
const fixtureCode = fixture.outputFiles[0].text;
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const dialog = page => page.getByRole('dialog');
const history = page => page.getByTestId('history');
const rows = page => history(page).locator('[data-oid]');
const sidebar = page => page.getByTestId('sidebar');
const details = page => page.getByTestId('details');
async function menu(page, locator, name) {
  await locator.click({ button: 'right' });
  const item = page.getByTestId('context-menu').getByRole('menuitem', { name, exact: true });
  await item.click(); await dialog(page).waitFor();
}
async function branch(page, name = 'feature/history-graph') {
  const expand = button(sidebar(page), 'Expand feature'); if (await expand.isVisible()) await expand.click();
  return button(sidebar(page), `Branch ${name}`);
}
async function settings(page, name) { await button(page, 'Settings').click(); await button(page.getByTestId('interface-settings'), name).click(); }
async function file(page, name = 'webview/App.tsx') { await details(page).getByRole('button', { name, exact: true }).first().click(); await page.getByTestId('diff-preview').waitFor(); }
async function commit(page, message, amend = false) {
  await page.locator('.toolbar .commit-trigger').click();
  if (amend) await dialog(page).locator('.commit-amend input').check();
  await dialog(page).getByRole('textbox', { name: 'Commit message', exact: true }).fill(message);
}
const scenes = [
  ['01', {}, async p => { await button(p, 'Workbench Locations').click(); await dialog(p).waitFor(); const checkboxes = await dialog(p).getByRole('checkbox').all(); assert.equal(checkboxes.length, 4); for (const checkbox of checkboxes) await checkbox.check(); }],
  ['02', {}, async p => { await settings(p, 'Language'); await dialog(p).getByRole('combobox', { name: 'Language', exact: true }).selectOption('zh-CN'); }],
  ['03', {}, async p => { await file(p); }],
  ['04', {}, async p => { await commit(p, 'Add quick start documentation'); await button(dialog(p), 'Commit').click(); await dialog(p).waitFor({ state: 'hidden' }); await rows(p).first().click(); await file(p); }],
  ['05', {}, async p => { await settings(p, 'File list'); }],
  ['06', {}, async p => { await sidebar(p).getByRole('option', { name: /^AlwayGit/ }).click(); await branch(p); }],
  ['07', {}, async p => { await details(p).getByRole('searchbox').fill('webview'); await file(p, 'webview/styles.css'); }],
  ['08', { unified: true }, async p => { const f = details(p).getByRole('button', { name: 'webview/App.tsx', exact: true }).first(); await menu(p, f, 'Commit Selected…'); await dialog(p).getByRole('textbox').fill('Polish workbench layout'); }],
  ['09', {}, async p => { const dock = p.getByTestId('bottom-dock'); await button(dock, 'New embedded terminal').click(); await dock.locator('.terminal-content:not([hidden]) textarea').waitFor(); await button(dock, 'New embedded terminal').click(); await dock.getByRole('tab', { name: 'PowerShell 2', exact: true }).click(); await button(dock, 'Rename terminal').click(); await p.getByRole('textbox', { name: 'Rename terminal' }).fill('dev server'); await button(dialog(p), 'Apply').click(); await dock.getByRole('tab', { name: 'dev server', exact: true }).waitFor(); }],
  ['10', {}, async p => { await settings(p, 'Keyboard shortcuts'); }],
  ['11', {}, async p => { await commit(p, 'Polish repository workbench interactions', true); await button(dialog(p), 'Amend Commit').click(); await dialog(p).waitFor({ state: 'hidden' }); await rows(p).first().click(); await file(p); }],
  ['12', {}, async p => { await sidebar(p).locator('.tag-status-synced').first().click(); await dialog(p).waitFor(); }],
  ['13', {}, async p => { await history(p).getByRole('textbox', { name: 'Search commit history', exact: true }).fill('native diff'); await rows(p).first().click(); await file(p); }],
  ['14', {}, async p => { await rows(p).nth(3).click(); await rows(p).nth(1).click({ modifiers: ['Control'] }); await details(p).getByText('Compare Commits', { exact: true }).waitFor(); await file(p); }],
  ['15', {}, async p => { await button(sidebar(p), 'Create Branch…').click(); await dialog(p).getByLabel('Branch Name', { exact: true }).fill('feature/guide'); }],
  ['16', {}, async p => { await menu(p, button(sidebar(p), 'Branch origin/develop'), 'Checkout as Local Branch…'); }],
  ['17', {}, async p => { await menu(p, await branch(p, 'feature/test'), 'Merge…'); }],
  ['18', { operation: 'conflict' }, async p => { await file(p); }],
  ['19', { operation: 'ready' }, async p => { await button(p.getByTestId('operation-notice'), 'Continue').click(); await dialog(p).waitFor(); }],
  ['20', { operation: 'conflict' }, async p => { await button(p.getByTestId('operation-notice'), 'Abort Merge…').click(); }],
  ['21', {}, async p => { await button(p.locator('.toolbar'), 'Stash All Changes…').click(); await dialog(p).getByLabel('Include untracked files').check(); }],
  ['22', {}, async p => { await menu(p, details(p).getByRole('button', { name: 'webview/App.tsx', exact: true }), 'Stash Selected Files…'); }],
  ['23', {}, async p => { await sidebar(p).getByRole('button').filter({ hasText: 'stash@{0}' }).click(); await details(p).getByRole('tab', { name: 'Index 1', exact: true }).click(); await file(p); }],
  ['24', { blockRestore: true }, async p => { await menu(p, sidebar(p).getByRole('button').filter({ hasText: 'stash@{0}' }), 'Pop Stash'); await button(dialog(p), 'Pop Stash').click(); await dialog(p).getByText('Confirmed conflicting files', { exact: true }).waitFor(); }],
  ['25', {}, async p => { await button(sidebar(p), 'Add Remote…').click(); await dialog(p).getByLabel('Remote Name', { exact: true }).fill('upstream'); await dialog(p).getByLabel('Repository URL', { exact: true }).fill('https://example.com/team/project.git'); }],
  ['26', {}, async p => { await button(p, 'Pull').click(); }],
  ['27', {}, async p => { await menu(p, await branch(p, 'feature/test'), 'Push…'); }],
  ['28', {}, async p => { await menu(p, rows(p).nth(1), 'Create Tag…'); await dialog(p).getByLabel('Tag Name', { exact: true }).fill('v1.1.0'); }],
  ['29', {}, async p => { await rows(p).nth(1).click({ button: 'right' }); await p.getByTestId('context-menu').getByRole('menuitem', { name: 'Reapply Historical Commits…', exact: true }).waitFor(); }],
  ['30', {}, async p => { await menu(p, rows(p).nth(1), 'Revert…'); }],
  ['31', {}, async p => { await menu(p, rows(p).nth(1), 'Reset…'); await dialog(p).getByLabel('Reset Mode', { exact: true }).selectOption('soft'); }],
  ['32', {}, async p => { await menu(p, await branch(p, 'feature/test'), 'Rebase…'); }],
  ['33', {}, async p => { await button(sidebar(p), 'Add Worktree…').click(); await dialog(p).getByLabel('Worktree Folder', { exact: true }).fill('D:\\Projects\\AlwayGit-guide'); await dialog(p).getByLabel('New Branch', { exact: true }).fill('feature/guide'); }],
  ['34', {}, async p => { await button(sidebar(p), 'Add…').click(); await button(dialog(p), 'Choose Folder…').click(); await dialog(p).getByText('NotesAnywhere', { exact: true }).waitFor(); }],
  ['35', {}, async p => { await button(p, 'Pull').click(); await button(dialog(p), 'Change pull source').click(); await dialog(p).getByLabel('Source branch', { exact: true }).fill('develop'); }],
  ['36', {}, async p => { await menu(p, sidebar(p).locator('.tag-row').first(), 'Delete Tag…'); await dialog(p).getByLabel('Also delete from a remote', { exact: true }).check(); await dialog(p).getByText(/shared remote/).waitFor(); }],
  ['37', {}, async p => { await settings(p, 'Git operations'); }],
  ['38', {}, async p => { await settings(p, 'Diff'); }],
  ['39', { host: 'sidebar', viewport: { width: 380, height: 820 } }, async p => { await button(p.getByRole('navigation', { name: 'Workbench Regions' }), 'History').click(); await rows(p).first().waitFor(); }],
  ['40', {}, async p => { await commit(p, 'Polish workbench layout'); await button(dialog(p), 'Commit').click(); await dialog(p).waitFor({ state: 'hidden' }); await p.getByTestId('action-feedback').waitFor(); await button(p.getByTestId('action-feedback'), 'Operation details').click(); }],
];

let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.ALWAYGIT_BROWSER_EXECUTABLE ? { executablePath: process.env.ALWAYGIT_BROWSER_EXECUTABLE } : process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const selected = scenes.filter(([id]) => (!only || only === id) && (!from || id >= from));
  assert.ok(selected.length, 'Unknown scene');
  for (const [id, options, prepare] of selected) {
    const context = await browser.newContext({ viewport: options.viewport ?? { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'Asia/Shanghai', colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.clock.install({ time: new Date('2026-10-06T04:00:00Z') });
      await page.addInitScript(options => { window.__captureOptions = options; }, options);
      await page.addInitScript({ content: fixtureCode });
      await page.goto(url);
      await details(page).waitFor({ state: options.host ? 'attached' : 'visible' });
      if (!options.host) await rows(page).first().waitFor();
      await prepare(page);
      await page.waitForFunction(() => window.__capturePending === 0);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.getByText('Loading Diff…', { exact: true }).waitFor({ state: 'hidden' });
      await page.evaluate(async () => { await document.fonts.ready; });
      await page.mouse.move(1430, 895);
      const visibleDialog = dialog(page);
      let clip;
      if (await visibleDialog.isVisible()) {
        const box = await visibleDialog.boundingBox(), viewport = page.viewportSize();
        const x = Math.max(0, box.x - 16), y = Math.max(0, box.y - 16);
        clip = { x, y, width: Math.min(viewport.width - x, box.width + 32), height: Math.min(viewport.height - y, box.height + 32) };
      }
      await page.screenshot({ path: path.join(output, `figure-${id}.png`), animations: 'disabled', clip });
      assert.deepEqual(errors, []);
      console.log(`CAPTURED figure-${id}.png`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `failure-${id}.png`) });
      console.error((await page.locator('body').innerText()).slice(-5000));
      throw new Error(`Capture ${id} failed`, { cause: error });
    } finally { await context.close(); }
  }
  if (write) for (const [id] of scenes) await copyFile(path.join(output, `figure-${id}.png`), path.join(root, `docs/images/user-manual/figure-${id}.png`));
  console.log(`${scenes.length} available scenes; ${write ? 'maintained set replaced' : 'preview files in artifacts/manual-capture'}`);
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
