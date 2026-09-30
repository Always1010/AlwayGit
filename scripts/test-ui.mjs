import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { verifyRefresh } from './test-refresh-ui.mjs';
import { verifyFeedback } from './test-feedback-ui.mjs';
import { verifyFiles } from './test-files-ui.mjs';
import { verifyHistoryRows } from './test-history-ui.mjs';
import { verifyDiffNavigation } from './test-diff-ui.mjs';
import { verifyWorktrees } from './test-worktrees-ui.mjs';
import { verifyAppearance } from './test-appearance-ui.mjs';

const root = path.resolve('dist/webview');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
  const filename = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (path.relative(root, filename).startsWith('..')) { response.writeHead(403); response.end(); return; }
  try { const data = await readFile(filename); response.setHeader('Content-Type', mime[path.extname(filename)] ?? 'application/octet-stream'); response.end(data); }
  catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  browser = await chromium.launch(process.env.ALWAYGIT_BROWSER_EXECUTABLE ? { executablePath: process.env.ALWAYGIT_BROWSER_EXECUTABLE } : process.platform === 'win32' ? { channel: 'msedge' } : {});
  const url = `http://127.0.0.1:${server.address().port}/?demo=1`;
  if (process.argv.includes('--files-only')) {
    await verifyFiles(browser, url);
    console.log('ALWAYGIT_UI_TESTS_PASSED: files-only');
  } else if (process.argv.includes('--appearance-only')) {
    await verifyAppearance(browser, url);
    console.log('ALWAYGIT_UI_TESTS_PASSED: appearance-only');
  } else {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const workbench = page.getByTestId('workbench');
  const sidebar = page.getByTestId('sidebar');
  const history = page.getByTestId('history');
  const details = page.getByTestId('details');
  await Promise.all([workbench.waitFor(), sidebar.waitFor(), history.waitFor(), details.waitFor()]);
  assert.ok((await sidebar.locator('.sidebar-heading').first().boundingBox()).height <= 29, 'Sidebar section headers stay compact');
  assert.ok((await history.locator('.pane-heading').first().boundingBox()).height <= 29, 'Pane headers stay compact');
  await page.getByRole('table', { name: 'Commit history' }).waitFor();
  await history.locator('[data-oid]').first().waitFor();
  assert.ok(await history.locator('[data-oid]').count() < 180, 'History must render a virtualized subset');
  assert.ok(await history.locator('svg[role="img"]').count() > 0, 'History must expose accessible Graph rows');
  await history.locator('.head-row').first().waitFor();
  await verifyHistoryRows(page);
  assert.match(await page.getByTestId('current-branch').innerText(), /main/);
  const projectButton = page.getByTestId('open-project');
  assert.equal(await projectButton.isEnabled(), true);
  assert.match(await projectButton.getAttribute('title'), /AlwayGit/);
  const toolbarBox = await page.locator('.toolbar').boundingBox(), projectBox = await projectButton.boundingBox();
  assert.ok(toolbarBox && projectBox && toolbarBox.x + toolbarBox.width - projectBox.x - projectBox.width < 16, 'Project button belongs at the far right of the action toolbar');
  await projectButton.click();
  await page.getByText('Demo: native VS Code command preview.', { exact: true }).waitFor();
  const historyViewport = history.locator('.history-viewport');
  await historyViewport.evaluate(element => { element.scrollTop = 500; });
  assert.ok(await historyViewport.evaluate(element => element.scrollTop) > 0, 'Fixture must scroll away from HEAD before Locate HEAD');
  await page.getByRole('button', { name: 'Locate HEAD', exact: true }).click();
  await page.waitForFunction(() => (document.querySelector('.history-viewport')?.scrollTop ?? 1) === 0);

  await page.getByRole('button', { name: 'Push (2)', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByText('main → origin/main', { exact: true }).waitFor();
  assert.equal(await dialog.getByLabel('Remote', { exact: true }).count(), 0, 'Configured Push targets should be summarized before showing edit controls');
  await dialog.getByRole('button', { name: 'Change Target…', exact: true }).click();
  assert.equal(await dialog.getByLabel('Remote', { exact: true }).inputValue(), 'origin');
  assert.equal(await dialog.getByLabel('Remote Branch', { exact: true }).inputValue(), 'main');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  const menu = page.getByTestId('context-menu');
  async function openMenu(locator, keyboard = false) {
    if (keyboard) { await locator.focus(); await locator.press('Shift+F10'); }
    else await locator.click({ button: 'right' });
    await menu.waitFor();
    return menu;
  }
  async function assertMenu(locator, labels, keyboard = false) {
    await openMenu(locator, keyboard);
    const actual = await menu.getByRole('menuitem').allTextContents();
    for (const label of labels) assert.ok(actual.some(value => value.trim() === label), `Expected menu item "${label}" in ${JSON.stringify(actual)}`);
    const boxes = await menu.getByRole('menuitem').evaluateAll(items => items.map(item => { const box = item.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width }; }));
    assert.ok(boxes.every((box, index) => index === 0 || box.y > boxes[index - 1].y), 'Context menu items must form a vertical list');
    assert.equal(await menu.locator('hr').count(), 0, 'Context menus must not use separator rules');
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
  }
  async function assertMenuButton(locator, labels) {
    await locator.click();
    await menu.waitFor();
    const actual = await menu.getByRole('menuitem').allTextContents();
    for (const label of labels) assert.ok(actual.some(value => value.trim() === label), `Expected menu item "${label}" in ${JSON.stringify(actual)}`);
    await page.keyboard.press('Escape');
    await menu.waitFor({ state: 'hidden' });
  }

  const repositoriesHeading = sidebar.getByRole('button', { name: 'Repositories', exact: true });
  await repositoriesHeading.click();
  await sidebar.getByRole('button', { name: 'AlwayGit', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await menu.isVisible(), false, 'A section title click must collapse the section without opening its menu');
  await repositoriesHeading.click();
  await assertMenuButton(sidebar.getByRole('button', { name: 'Repositories actions', exact: true }), ['Add Repository…', 'Refresh']);
  await assertMenu(sidebar.getByRole('button', { name: 'AlwayGit', exact: true }), ['Open Workbench', 'Open in New Window', 'Refresh', 'Fetch…', 'Copy Repository Path']);
  const localHeading = sidebar.getByRole('button', { name: 'Local Branches', exact: true });
  await localHeading.click();
  await sidebar.getByRole('button', { name: 'Expand feature', exact: true }).waitFor({ state: 'hidden' });
  await localHeading.click();
  await assertMenuButton(sidebar.getByRole('button', { name: 'Local Branches actions', exact: true }), ['Create Branch…', 'Select All', 'Clear Selection']);
  await sidebar.getByRole('button', { name: 'Expand feature', exact: true }).click();
  await sidebar.getByRole('button', { name: 'Expand login', exact: true }).click();
  await sidebar.getByRole('button', { name: 'Branch feature/login/api', exact: true }).waitFor();
  const featureBranch = sidebar.getByRole('button', { name: 'Branch feature/history-graph', exact: true });
  await assertMenu(featureBranch, ['Checkout…', 'Show in Graph', 'Show Only This Branch', 'Create Branch…', 'Create Tag…', 'Merge…', 'Rebase…', 'Push…', 'Delete Branch…', 'Copy Branch Name'], true);
  assert.equal(await featureBranch.evaluate(element => element === document.activeElement), true, 'Escape must restore focus to the context-menu opener');
  await openMenu(featureBranch);
  await menu.getByRole('menuitem', { name: 'Push…', exact: true }).click();
  await dialog.waitFor();
  await dialog.getByText('feature/history-graph → origin/feature/history-graph', { exact: true }).waitFor();
  await dialog.getByText('This Push will set the selected target as the upstream branch.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await assertMenuButton(sidebar.getByRole('button', { name: 'Remotes actions', exact: true }), ['Fetch…', 'Refresh']);
  await assertMenuButton(sidebar.getByRole('button', { name: 'origin actions', exact: true }), ['Fetch…', 'Refresh']);
  const remoteBranch = sidebar.getByRole('button', { name: 'Branch origin/develop', exact: true });
  await assertMenu(remoteBranch, ['Show in Graph', 'Show Only This Branch', 'Create Tracking Branch…', 'Merge…', 'Rebase…', 'Copy Branch Name']);
  await assertMenuButton(sidebar.getByRole('button', { name: 'Tags actions', exact: true }), ['Create Tag…', 'Refresh']);
  const tag = sidebar.getByRole('button', { name: 'v0.1.0', exact: true });
  await assertMenu(tag, ['Checkout…', 'Show in Graph', 'Show Only This Tag', 'Create Branch…', 'Delete Tag…', 'Copy Tag Name', 'Copy Commit ID']);
  await assertMenuButton(sidebar.getByRole('button', { name: 'Stashes actions', exact: true }), ['Stash Changes…', 'Refresh']);
  const stash = sidebar.getByRole('button').filter({ hasText: 'stash@{0}' });
  await assertMenu(stash, ['View Changes', 'Apply Stash', 'Pop Stash', 'Drop Stash…']);
  await assertMenuButton(sidebar.getByRole('button', { name: 'Worktrees actions', exact: true }), ['Add Worktree…', 'Refresh']);
  const secondaryWorktree = sidebar.getByRole('button').filter({ hasText: 'AlwayGit-graph' });
  await assertMenu(secondaryWorktree, ['Open Worktree', 'Open in New Window', 'Refresh', 'Remove Worktree…', 'Copy Worktree Path']);

  await featureBranch.dispatchEvent('contextmenu', { button: 2, clientX: 1438, clientY: 898, bubbles: true });
  await menu.waitFor();
  const edge = await menu.boundingBox();
  assert.ok(edge && edge.x >= 0 && edge.y >= 0 && edge.x + edge.width <= 1440 && edge.y + edge.height <= 900, 'Context menu must stay inside the viewport');
  await menu.getByRole('menuitem').first().focus();
  await page.keyboard.press('ArrowDown');
  assert.notEqual(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Checkout…', 'ArrowDown must move menu focus');
  await page.keyboard.press('Escape');

  await openMenu(featureBranch);
  await menu.getByRole('menuitem', { name: 'Create Tag…', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Target Commit', { exact: true }).inputValue(), 'refs/heads/feature/history-graph');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await openMenu(remoteBranch);
  await menu.getByRole('menuitem', { name: 'Create Tracking Branch…', exact: true }).click();
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Start Point', { exact: true }).inputValue(), 'refs/remotes/origin/develop');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await openMenu(stash);
  await menu.getByRole('menuitem', { name: 'Pop Stash', exact: true }).click();
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Stash', { exact: true }).inputValue(), 'stash@{0}');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await openMenu(secondaryWorktree);
  await menu.getByRole('menuitem', { name: 'Remove Worktree…', exact: true }).click();
  await dialog.waitFor();
  assert.match(await dialog.getByLabel('Worktree', { exact: true }).inputValue(), /AlwayGit-graph/);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

  const sidebarSeparator = page.getByRole('separator', { name: 'Resize repository sidebar' });
  const originalSidebar = Number(await sidebarSeparator.getAttribute('aria-valuenow'));
  await sidebarSeparator.focus(); await sidebarSeparator.press('ArrowRight');
  assert.ok(Number(await sidebarSeparator.getAttribute('aria-valuenow')) > originalSidebar, 'Keyboard resizing must update the sidebar width');
  await page.getByRole('button', { name: 'Restore Layout', exact: true }).click();
  assert.equal(Number(await sidebarSeparator.getAttribute('aria-valuenow')), 210);

  await sidebar.getByRole('button', { name: 'Clear Selection', exact: true }).click();
  await history.getByText('No branches selected', { exact: true }).waitFor();
  const featureGroup = sidebar.getByLabel('Show branch group feature', { exact: true });
  await featureGroup.check();
  await history.getByText(/^3 refs/).waitFor();
  await featureGroup.uncheck();
  await history.getByText('No branches selected', { exact: true }).waitFor();
  await sidebar.getByLabel('Show branch main', { exact: true }).check();
  await sidebar.getByLabel('Show branch feature/history-graph', { exact: true }).check();
  await history.getByText(/^2 refs/).waitFor();
  await history.locator('[data-oid]').first().waitFor();
  const visibleOids = await history.locator('[data-oid]').evaluateAll(rows => rows.map(row => row.getAttribute('data-oid')));
  assert.equal(new Set(visibleOids).size, visibleOids.length, 'Multi-branch history must not duplicate shared commits');

  const search = history.getByRole('textbox', { name: 'Search commit history' });
  await search.fill('native diff');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-oid]')].length > 0 && [...document.querySelectorAll('[data-oid]')].every(row => row.textContent?.includes('native diff')));
  await history.getByRole('button', { name: /Working Tree/ }).click();
  const draft = page.getByRole('textbox', { name: 'Commit message' });
  await draft.fill('Persistent bilingual draft');
  await page.getByRole('button', { name: 'Interface Settings', exact: true }).click();
  await page.getByTestId('interface-settings').getByLabel('Language').selectOption('zh-CN');
  await page.getByRole('dialog').locator('.modal-footer .primary').click();
  await page.getByText('当前分支', { exact: true }).waitFor();
  assert.equal(await search.inputValue(), 'native diff');
  assert.equal(await draft.inputValue(), 'Persistent bilingual draft');
  assert.equal(await sidebar.getByLabel('Show branch main', { exact: true }).isChecked(), true);
  assert.equal(await sidebar.getByLabel('Show branch feature/history-graph', { exact: true }).isChecked(), true);

  await page.reload();
  await workbench.waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Commit message' }).inputValue(), 'Persistent bilingual draft');
  assert.equal(await page.getByRole('textbox', { name: 'Search commit history' }).inputValue(), 'native diff');
  assert.equal(await page.getByLabel('Show branch feature/history-graph', { exact: true }).isChecked(), true);
  await page.getByRole('button', { name: '界面设置', exact: true }).click();
  assert.equal(await page.getByTestId('interface-settings').getByLabel('Language').inputValue(), 'zh-CN');
  await page.getByTestId('interface-settings').getByLabel('Language').selectOption('en');
  await page.getByRole('dialog').locator('.modal-footer .primary').click();

  await history.getByRole('button', { name: /Working Tree/ }).click();
  const file = details.getByRole('button', { name: 'webview/styles.css', exact: true });
  await file.click();
  await page.getByTestId('diff-preview').locator('.diff-labels').getByText('Index', { exact: true }).waitFor();
  await page.getByTestId('diff-preview').locator('.diff-labels').getByText('Working Tree', { exact: true }).waitFor();
  await page.getByTestId('diff-preview').getByRole('button', { name: 'Open Diff', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Demo: native VS Code command preview.' }).waitFor();

  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/workbench-history.png', fullPage: true });
  await page.setViewportSize({ width: 960, height: 700 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'Outer workbench must not overflow horizontally');
  await page.screenshot({ path: 'artifacts/workbench-compact.png', fullPage: true });
  await page.evaluate(() => document.body.classList.add('vscode-light'));
  await page.waitForTimeout(150);
  assert.equal(await projectButton.evaluate(button => getComputedStyle(button).backgroundColor), 'rgb(255, 255, 255)', 'Light buttons must follow the VS Code body theme');
  await page.screenshot({ path: 'artifacts/workbench-light.png', fullPage: true });
  await page.evaluate(() => { document.body.classList.remove('vscode-light'); document.body.classList.add('vscode-high-contrast'); });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'artifacts/workbench-high-contrast.png', fullPage: true });
  await page.evaluate(() => { document.body.classList.remove('vscode-high-contrast'); document.body.classList.add('vscode-high-contrast-light'); });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'artifacts/workbench-high-contrast-light.png', fullPage: true });
  await page.evaluate(() => document.body.classList.remove('vscode-high-contrast-light'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.toolbar .button').first().evaluate(button => getComputedStyle(button).transitionDuration), '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.setViewportSize({ width: 700, height: 650 });
  for (const [label, key, maximum] of [['Resize graph column', 'ArrowRight', 180], ['Resize author column', 'ArrowLeft', 220], ['Resize date column', 'ArrowLeft', 220]]) {
    const handle = page.getByRole('separator', { name: label });
    await handle.focus();
    for (let index = 0; index < 24; index++) await handle.press(key);
    assert.equal(Number(await handle.getAttribute('aria-valuenow')), maximum);
  }
  await historyViewport.evaluate(element => { element.scrollLeft = element.scrollWidth; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await page.waitForFunction(() => {
    const body = document.querySelector('.history-viewport');
    const header = document.querySelector('.history-header-scroll');
    return !!body && !!header && body.scrollLeft > 0 && header.scrollLeft === body.scrollLeft;
  });

  assert.deepEqual(errors, [], 'UI must not throw runtime errors');
  await verifyRefresh(browser, url);
  await verifyFeedback(browser, url);
  await verifyFiles(browser, url);
  await verifyDiffNavigation(browser, url);
  await verifyWorktrees(browser, url);
  console.log('ALWAYGIT_UI_TESTS_PASSED: four-pane layout, complete context menus, focus/viewport keyboard behavior, targeted dialogs, resizing and header scroll sync, Locate HEAD, multi-ref filtering, language/session, Diff preview, compact themes');
  }
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
