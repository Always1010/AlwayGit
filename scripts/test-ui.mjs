import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { verifyRefresh } from './test-refresh-ui.mjs';
import { verifyFeedback } from './test-feedback-ui.mjs';
import { verifyFiles } from './test-files-ui.mjs';
import { verifyHistoryRows, verifyLocateHead, verifyHistoryNavigation } from './test-history-ui.mjs';
import { verifyDiffNavigation } from './test-diff-ui.mjs';
import { verifyWorktrees } from './test-worktrees-ui.mjs';
import { verifyAppearance } from './test-appearance-ui.mjs';
import { verifyRemoteTracking } from './test-remote-tracking-ui.mjs';
import { verifyStash } from './test-stash-ui.mjs';
import { verifyBranchCreation } from './test-branch-ui.mjs';
import { verifyCherryPick } from './test-cherry-pick-ui.mjs';
import { verifyHelp } from './test-help-ui.mjs';
import { verifyShortcuts } from './test-shortcuts-ui.mjs';

// Full and targeted runs share one registry, so a new suite cannot be omitted from full runs.
const suites = new Map([
  ['workbench', verifyWorkbench],
  ['history', verifyHistory],
  ['refresh', verifyRefresh],
  ['feedback', verifyFeedback],
  ['files', verifyFiles],
  ['diff', verifyDiffNavigation],
  ['worktrees', verifyWorktrees],
  ['remote-tracking', verifyRemoteTracking],
  ['stash', verifyStash],
  ['branch', verifyBranchCreation],
  ['cherry-pick', verifyCherryPick],
  ['appearance', verifyAppearance],
  ['help', verifyHelp],
  ['shortcuts', verifyShortcuts],
]);
const args = process.argv.slice(2);
if (args.length > 1) throw new Error('Choose one UI suite flag per run.');
const flag = args[0];
const selected = flag?.match(/^--(.+)-only$/)?.[1];
if (flag && !suites.has(selected)) {
  throw new Error('Unknown UI suite flag: ' + flag + '. Available: ' +
    [...suites.keys()].map(name => '--' + name + '-only').join(', '));
}
const scheduled = selected ? [[selected, suites.get(selected)]] : [...suites];

const root = path.resolve('dist/webview');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
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
  browser = await chromium.launch(process.env.ALWAYGIT_BROWSER_EXECUTABLE
    ? { executablePath: process.env.ALWAYGIT_BROWSER_EXECUTABLE }
    : process.platform === 'win32' ? { channel: 'msedge' } : {});
  const url = `http://127.0.0.1:${server.address().port}/?demo=1`;
  for (const [name, verify] of scheduled) {
    console.log('ALWAYGIT_UI_TESTS_RUNNING: ' + name);
    try {
      await verify(browser, url);
    } catch (error) {
      throw new Error('UI suite failed: ' + name, { cause: error });
    }
  }
  console.log('ALWAYGIT_UI_TESTS_PASSED: ' + (selected ? selected + '-only' : [...suites.keys()].join(', ')));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}

async function verifyHistory(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(url);
    await page.getByTestId('sidebar').getByRole('option', { name: /^AlwayGit/ }).dblclick();
    await verifyHistoryRows(page);
  } finally {
    await page.close();
  }
  await verifyLocateHead(browser, url);
  await verifyHistoryNavigation(browser, url);
}

async function verifyWorkbench(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const workbench = page.getByTestId('workbench');
    const sidebar = page.getByTestId('sidebar');
    const history = page.getByTestId('history');
    const details = page.getByTestId('details');
    await Promise.all([workbench.waitFor(), sidebar.waitFor()]);
    const branchBadge = page.getByTestId('current-branch');
    assert.equal(await branchBadge.innerText(), '—', 'A fresh Workbench does not select a repository at the entry point');
    assert.match(await branchBadge.locator('..').getAttribute('title'), /No repository selected/);
    const repositoryOption=sidebar.getByRole('option', { name: /^AlwayGit/ });
    await repositoryOption.dblclick();
    await Promise.all([history.waitFor(), details.waitFor()]);
    assert.ok((await sidebar.locator('.sidebar-heading').first().boundingBox()).height <= 29, 'Sidebar section headers stay compact');
    assert.ok((await history.locator('.pane-heading').first().boundingBox()).height <= 29, 'Pane headers stay compact');
    await page.getByRole('table', { name: 'Commit history' }).waitFor();
    await history.locator('[data-oid]').first().waitFor();
    assert.ok(await history.locator('[data-oid]').count() < 180, 'History must render a virtualized subset');
    assert.ok(await history.locator('svg[role="img"]').count() > 0, 'History must expose accessible Graph rows');
    await history.locator('[data-head-commit="true"]').first().waitFor();
    assert.match(await page.getByTestId('current-branch').innerText(), /main/);
    const projectButton = page.getByTestId('open-project');
    assert.equal(await projectButton.isEnabled(), true);
    assert.match(await projectButton.getAttribute('title'), /AlwayGit/);
    assert.equal((await projectButton.innerText()).trim(), '', 'Repository folder command stays icon-only');
    assert.equal(await projectButton.locator('.codicon-folder').count(), 0, 'Repository folder command removes the old double-folder glyphs');
    assert.equal(await projectButton.locator('svg.repository-folder-outline').count(), 1, 'Repository folder command uses the selected hollow folder outline');
    assert.equal(await projectButton.locator('.repository-folder-fold').count(), 1, 'Repository folder outline keeps the folded shoulder detail');
    assert.equal(await projectButton.locator('.codicon-vscode').count(), 1, 'Repository folder command keeps the blue VS Code mark at the lower right');
    assert.equal(await page.locator('.branch-bar').count(), 0, 'Branch state is merged into the action toolbar');
    assert.equal(await page.locator('.statusbar').count(), 0, 'The redundant persistent status bar is removed');
    const toolbarBox = await page.locator('.toolbar').boundingBox(), projectBox = await projectButton.boundingBox();
    assert.ok(toolbarBox && projectBox && toolbarBox.x + toolbarBox.width - projectBox.x - projectBox.width < 16, 'Project button belongs at the far right of the action toolbar');
    await projectButton.click();
    const notice = page.locator('.banner.notice');
    await notice.getByText('Demo: native VS Code command preview.', { exact: true }).waitFor();
    await notice.getByRole('button', { name: 'Dismiss notification', exact: true }).click();
    assert.equal(await notice.count(), 0, 'Transient notices can be dismissed from the top of the workbench');
    const historyViewport = history.locator('.history-viewport');
    await historyViewport.evaluate(element => { element.scrollTop = 500; });
    assert.ok(await historyViewport.evaluate(element => element.scrollTop) > 0, 'Fixture must scroll away from HEAD before Locate HEAD');
    await page.getByRole('button', { name: 'Locate HEAD', exact: true }).click();
    await page.waitForFunction(() => (document.querySelector('.history-viewport')?.scrollTop ?? 1) === 0);

    await page.getByRole('button', { name: /^Push/ }).click();
    let dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByText('main → origin/main', { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Remote', { exact: true }).count(), 0, 'Configured Push targets should be summarized before showing edit controls');
    await dialog.getByRole('button', { name: 'Change Target…', exact: true }).click();
    assert.equal(await dialog.getByLabel('Remote', { exact: true }).inputValue(), 'origin');
    assert.equal(await dialog.getByLabel('Remote Branch', { exact: true }).inputValue(), 'main');
    assert.equal(await dialog.getByText('Force-with-lease', { exact: true }).isVisible(), false, 'Force-with-lease stays inside collapsed Advanced Options');
    await dialog.getByText('Advanced Options', { exact: true }).click();
    await dialog.getByText('Force-with-lease', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    const noRemotePage=await browser.newPage({viewport:{width:1440,height:900}});
    try {
      await noRemotePage.goto(`${url}&noRemote=1`);
      await noRemotePage.evaluate(()=>localStorage.clear());
      await noRemotePage.reload();
      const noRemoteSidebar=noRemotePage.getByTestId('sidebar');
      await noRemoteSidebar.getByRole('option',{name:/^AlwayGit/}).dblclick();
      await noRemoteSidebar.getByText('No remote repository connected.',{exact:true}).waitFor();
      await noRemoteSidebar.locator('.remote-empty').getByRole('button',{name:'Add Remote…',exact:true}).waitFor();
      await noRemotePage.getByRole('button',{name:/^Push/}).click();
      let noRemoteDialog=noRemotePage.getByRole('dialog',{name:'Push',exact:true});
      await noRemoteDialog.getByText('No remote repository is connected yet.',{exact:true}).waitFor();
      await noRemoteDialog.getByText('Your commits are saved locally. Add a remote address before sending them with Push.',{exact:true}).waitFor();
      assert.equal(await noRemoteDialog.getByLabel('Remote',{exact:true}).count(),0,'Push does not show an impossible empty selector');
      assert.equal(await noRemoteDialog.getByText('Force-with-lease',{exact:true}).count(),0,'Advanced Push options stay hidden until prerequisites exist');
      await noRemoteDialog.getByRole('button',{name:'Add Remote…',exact:true}).click();
      noRemoteDialog=noRemotePage.getByRole('dialog',{name:'Add Remote',exact:true});
      assert.equal(await noRemoteDialog.getByLabel('Remote Name',{exact:true}).inputValue(),'origin');
      await noRemoteDialog.getByLabel('Repository URL',{exact:true}).fill('https://example.com/acme/repo.git');
      await noRemoteDialog.getByRole('button',{name:'Add Remote',exact:true}).click();
      noRemoteDialog=noRemotePage.getByRole('dialog',{name:'Push',exact:true});
      await noRemoteDialog.getByText('main → origin/main',{exact:true}).waitFor();
      await noRemoteDialog.getByRole('button',{name:'Cancel',exact:true}).click();
    } finally { await noRemotePage.close(); }

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
    async function assertIconActions(scope, labels) {
      for (const label of labels) {
        const action = scope.getByRole('button', { name: label, exact: true });
        await action.waitFor();
        assert.equal((await action.innerText()).trim(), '', `${label} must remain icon-only`);
        assert.equal(await action.locator('.codicon').count(), 1, `${label} must expose one recognizable icon`);
        assert.ok((await action.getAttribute('title'))?.startsWith(label), `${label} must expose a hover hint`);
      }
    }

    const repositoriesHeading = sidebar.getByRole('button', { name: 'Repositories', exact: true });
    await repositoriesHeading.click();
    await sidebar.getByRole('button', { name: /^AlwayGit/ }).waitFor({ state: 'hidden' });
    assert.equal(await menu.isVisible(), false, 'A section title click must collapse the section without opening its menu');
    await repositoriesHeading.click();
    await assertIconActions(repositoriesHeading.locator('..'), ['Add…', 'Refresh repository list and status badges']);
    assert.equal(await sidebar.locator('.codicon-ellipsis').count(), 0, 'Sidebar retains the original actions without repository ellipsis controls');
    await assertMenu(repositoriesHeading, ['Add…', 'Refresh']);
    await assertMenu(sidebar.getByRole('option', { name: /^AlwayGit/ }), ['Switch to Repository', 'Open in New AlwayGit Tab', 'Open Repository in New Project Window', 'Fetch…', 'Refresh Status', 'Copy Repository Path', 'Move to Repository Group…', 'Remove from AlwayGit…']);
    const localHeading = sidebar.getByRole('button', { name: 'Local Branches', exact: true });
    await localHeading.click();
    const localTree=sidebar.locator('.branch-tree[data-ref-kind="local"]');
    await localTree.getByRole('button', { name: 'Expand feature', exact: true }).waitFor({ state: 'hidden' });
    await localHeading.click();
    await assertIconActions(localHeading.locator('..'), ['Create Branch…']);
    const graphPresets=sidebar.getByRole('group',{name:'Graph branch display presets',exact:true});
    await assertIconActions(graphPresets, ['Show All Local Branches in Graph', 'Show Current Branch Only in Graph']);
    assert.equal(await sidebar.getByRole('button',{name:'Show None in Graph',exact:true}).count(),0,'Graph presets must not expose a Show None shortcut');
    await openMenu(localHeading);
    assert.deepEqual((await menu.getByRole('menuitem').allTextContents()).map(value=>value.trim()),['Create Branch…','Show All Local Branches in Graph','Show Current Branch Only in Graph']);
    await page.keyboard.press('Escape');
    await localHeading.locator('..').getByRole('button', { name: 'Create Branch…', exact: true }).click();
    const createBranchDialog = page.getByRole('dialog', { name: 'Create Branch', exact: true });
    await createBranchDialog.waitFor();
    await createBranchDialog.getByText('Current branch main · current version', { exact: true }).waitFor();
    const branchName=createBranchDialog.getByLabel('Branch Name',{exact:true});
    await branchName.fill('bad name');
    await createBranchDialog.getByText('Branch names cannot contain spaces. Try feature/ux-flow.',{exact:true}).waitFor();
    assert.equal(await branchName.inputValue(),'bad name','Invalid branch input must be preserved');
    assert.equal(await branchName.evaluate(element=>element===document.activeElement),true,'Invalid branch input keeps focus');
    await branchName.fill('trial/ux-flow');
    await createBranchDialog.getByRole('button',{name:'Create Only',exact:true}).click();
    await page.getByTestId('action-feedback').getByText('Created trial/ux-flow; still on main',{exact:true}).waitFor();
    assert.match(await page.getByTestId('current-branch').innerText(),/main/);
    await localTree.getByRole('button', { name: 'Expand feature', exact: true }).click();
    await sidebar.getByRole('button', { name: 'Expand login', exact: true }).click();
    await sidebar.getByRole('button', { name: 'Branch feature/login/api', exact: true }).waitFor();
    const currentBranch = sidebar.getByRole('button', { name: 'Branch main', exact: true });
    assert.equal(await currentBranch.getAttribute('aria-current'), 'true', 'The current local branch exposes aria-current');
    assert.equal(await currentBranch.locator('.branch-icon').count(), 1, 'The current local branch uses the shared icon column');
    assert.equal(await currentBranch.locator('.current-indicator').count(), 0, 'Branch icons do not reserve a separate current-marker column');
    assert.equal(await currentBranch.innerText(), 'main', 'The current branch does not repeat its state as a text badge');
    const featureBranch = sidebar.getByRole('button', { name: 'Branch feature/history-graph', exact: true });
    await assertMenu(featureBranch, ['Checkout…', 'Add to Graph Scope', 'Show Only This Branch History', 'Create Branch…', 'Create Tag…', 'Merge…', 'Rebase…', 'Push…', 'Delete Branch…', 'Copy Branch Name'], true);
    assert.equal(await sidebar.locator('.repository-list [aria-selected="true"]').count(),0,'Selecting a branch action scope clears Repository action selection');
    assert.equal(await featureBranch.evaluate(element => element === document.activeElement), true, 'Escape must restore focus to the context-menu opener');
    const localGraphSelection = await localTree.locator('input[type="checkbox"]').evaluateAll(inputs => inputs.map(input => input.checked));
    await featureBranch.press('Control+a');
    assert.equal(await localTree.locator('.ref-row.action-selected').count(), await localTree.locator('.ref-row').count(), 'Ctrl+A selects every local branch for actions');
    assert.deepEqual(await localTree.locator('input[type="checkbox"]').evaluateAll(inputs => inputs.map(input => input.checked)), localGraphSelection, 'Local branch Ctrl+A must not change Graph checkbox selection');
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '', 'Local branch Ctrl+A must not select page text');
    await featureBranch.press('Escape');
    assert.equal(await localTree.locator('.ref-row.action-selected').count(), 0, 'Escape clears local branch action selection');
    await openMenu(featureBranch);
    await menu.getByRole('menuitem', { name: 'Push…', exact: true }).click();
    await dialog.waitFor();
    await dialog.getByText('feature/history-graph → origin/feature/history-graph', { exact: true }).waitFor();
    await dialog.getByText('This Push will set the selected target as the upstream branch.', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const loginBranch=sidebar.getByRole('button',{name:'Branch feature/login/api',exact:true}),testBranch=sidebar.getByRole('button',{name:'Branch feature/test',exact:true});
    await loginBranch.click();
    await testBranch.click({modifiers:['Control']});
    assert.equal(await sidebar.locator('.ref-row.action-selected').count(),2,'Ctrl+click selects multiple branches independently from Graph checkboxes');
    await openMenu(loginBranch);
    assert.deepEqual((await menu.getByRole('menuitem').allTextContents()).map(value=>value.trim()),['Show Selected in Graph','Show Only Selected','Hide Selected from Graph','Delete 2 Local Branches…','Copy Branch Names']);
    await menu.getByRole('menuitem',{name:'Delete 2 Local Branches…',exact:true}).click();
    dialog=page.getByRole('dialog');
    await dialog.getByText('feature/login/api',{exact:true}).waitFor();
    await dialog.getByText('feature/test',{exact:true}).waitFor();
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    const featureFolder=localTree.getByRole('button',{name:'Collapse feature',exact:true}).locator('..');
    await featureFolder.click({button:'right'});
    await menu.waitFor();
    assert.ok((await menu.getByRole('menuitem').allTextContents()).some(value=>value.trim()==='Copy Branch Names'),'Branch folders use the custom branch menu');
    await page.keyboard.press('Escape');
    await assertIconActions(sidebar.getByRole('button', { name: 'Remotes', exact: true }).locator('..'), ['Add Remote…']);
    await assertIconActions(sidebar.getByRole('button', { name: 'origin', exact: true }).locator('..'), ['Fetch…']);
    const remoteBranch = sidebar.getByRole('button', { name: 'Branch origin/develop', exact: true });
    await assertMenu(remoteBranch, ['Add to Graph Scope', 'Show Only This Branch History', 'Checkout as Local Branch…', 'Merge…', 'Rebase…', 'Delete Branch from origin…', 'Copy Branch Name']);
    const remoteTree = sidebar.locator('.branch-tree[data-ref-kind="remote"]');
    const remoteGraphSelection = await remoteTree.locator('input[type="checkbox"]').evaluateAll(inputs => inputs.map(input => input.checked));
    await remoteBranch.press('Control+a');
    assert.equal(await remoteTree.locator('.ref-row.action-selected').count(), await remoteTree.locator('.ref-row').count(), 'Ctrl+A selects only branches in the focused Remote tree');
    await repositoryOption.click();
    assert.equal(await remoteTree.locator('.ref-row.action-selected').count(),0,'Selecting a Repository action scope clears Remote branch action selection');
    assert.equal(await repositoryOption.getAttribute('aria-selected'),'true','The Repository becomes the only sidebar action-selection scope');
    await remoteBranch.press('Control+a');
    assert.equal(await sidebar.locator('.repository-list [aria-selected="true"]').count(),0,'Returning to the Remote action scope clears Repository action selection');
    assert.equal(await localTree.locator('.ref-row.action-selected').count(), 0, 'Remote Ctrl+A must not select local branches');
    assert.deepEqual(await remoteTree.locator('input[type="checkbox"]').evaluateAll(inputs => inputs.map(input => input.checked)), remoteGraphSelection, 'Remote branch Ctrl+A must not change Graph checkbox selection');
    assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '', 'Remote branch Ctrl+A must not select page text');
    await remoteBranch.press('Escape');
    assert.equal(await remoteTree.locator('.ref-row.action-selected').count(), 0, 'Escape clears Remote branch action selection');
    const remoteMain=sidebar.getByRole('button',{name:'Branch origin/main',exact:true});
    await remoteBranch.click();await remoteMain.click({modifiers:['Control']});await openMenu(remoteBranch);
    assert.ok((await menu.getByRole('menuitem').allTextContents()).some(value=>value.trim()==='Delete 2 Branches from origin…'),'Remote multi-selection exposes an explicit remote deletion action');
    await menu.getByRole('menuitem',{name:'Delete 2 Branches from origin…',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByText('Delete from origin',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await assertIconActions(sidebar.getByRole('button', { name: 'Tags', exact: true }).locator('..'), ['Create Tag…']);
    const tag = sidebar.getByRole('button', { name: 'v0.1.0', exact: true });
    await assertMenu(tag, ['Show Only This Tag History', 'Locate Tag Commit in Graph', 'Push Tag…', 'Delete Tag…', 'Copy Tag Name', 'Copy Commit ID']);
    await assertIconActions(sidebar.getByRole('button', { name: 'Stashes', exact: true }).locator('..'), ['Stash All Changes…']);
    const stash = sidebar.getByRole('button').filter({ hasText: 'stash@{0}' });
    await assertMenu(stash, ['View Changes', 'Apply Stash', 'Pop Stash', 'Drop Stash…']);
    await assertIconActions(sidebar.getByRole('button', { name: 'Worktrees', exact: true }).locator('..'), ['Add Worktree…']);
    const secondaryWorktree = sidebar.locator('.worktree-list [data-worktree-path]').last();
    await assertMenu(secondaryWorktree, ['Open Worktree', 'Open Worktree in New Project Window', 'Refresh', 'Remove Worktree…', 'Copy Worktree Path']);

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
    await menu.getByRole('menuitem', { name: 'Checkout as Local Branch…', exact: true }).click();
    await dialog.waitFor();
    assert.equal(await dialog.getByLabel('Local branch for origin/develop', { exact: true }).inputValue(), 'develop');
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
    await sidebarSeparator.press('Home');
    assert.equal(Number(await sidebarSeparator.getAttribute('aria-valuenow')), 160, 'Sidebar supports its documented minimum width');
    const sidebarBox = await sidebar.boundingBox();
    const actionBoxes = await sidebar.locator('.sidebar-actions').evaluateAll(groups => groups.flatMap(group => [...group.querySelectorAll('button')].map(button => { const box = button.getBoundingClientRect(); return { left: box.left, right: box.right }; })));
    assert.ok(sidebarBox && actionBoxes.every(box => box.left >= sidebarBox.x - .5 && box.right <= sidebarBox.x + sidebarBox.width + .5), 'Direct sidebar actions must stay visible at the minimum width');
    await page.getByRole('button', { name: 'Restore Layout', exact: true }).click();
    assert.equal(Number(await sidebarSeparator.getAttribute('aria-valuenow')), 210);

    const showAllBranches=graphPresets.getByRole('button',{name:'Show All Local Branches in Graph',exact:true}),showCurrentBranch=graphPresets.getByRole('button',{name:'Show Current Branch Only in Graph',exact:true});
    await showAllBranches.click();
    assert.equal(await showAllBranches.getAttribute('aria-pressed'),'true','Show All exposes its active preset state');
    await showCurrentBranch.click();
    assert.equal(await showCurrentBranch.getAttribute('aria-pressed'),'true','Current Only exposes its active preset state');
    assert.equal(await showAllBranches.getAttribute('aria-pressed'),'false','The Graph presets are visually exclusive');
    await sidebar.getByLabel('Show branch main', { exact: true }).uncheck();
    await history.getByText('No branches selected', { exact: true }).waitFor();
    assert.equal(await history.locator('[data-head-commit="true"]').count(),0,'Filtering out the current branch must not reinsert a HEAD anchor');
    assert.equal(await history.locator('[data-oid]').count(),0,'No commit rows remain when no branches are selected');
    assert.equal(await history.locator('[data-working-tree]').count(),1,'Working Tree remains as the only history item');
    assert.equal(await history.getByText('Outside current filter',{exact:true}).count(),0,'The removed HEAD anchor label must not remain');
    const featureGroup = localTree.getByLabel('Show branch group feature', { exact: true });
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

    const search = history.getByRole('textbox', { name: /^(?:Search commit history|搜索提交历史)$/ });
    await search.fill('native diff');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-oid]')].length > 0 && [...document.querySelectorAll('[data-oid]')].every(row => row.textContent?.includes('native diff')));
    await history.locator('[data-working-tree]').click();
    const draft = page.getByRole('textbox', { name: /^(?:Commit message|提交消息)$/ });
    await page.locator('.toolbar .commit-trigger').click();
    await draft.fill('Persistent bilingual draft');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByTestId('interface-settings').getByRole('button',{name:'Language',exact:true}).click();
    await page.getByTestId('interface-settings').getByRole('combobox',{name:'Language'}).selectOption('zh-CN');
    await page.getByRole('dialog').locator('.modal-footer .primary').click();
    await page.waitForFunction(()=>document.querySelector('[data-testid="current-branch"]')?.parentElement?.getAttribute('title')?.includes('当前分支：main'));
    assert.equal(await search.inputValue(), 'native diff');
    await page.locator('.toolbar .commit-trigger').click();
    assert.equal(await draft.inputValue(), 'Persistent bilingual draft');
    await page.keyboard.press('Escape');
    assert.equal(await sidebar.getByLabel(/^(?:Show branch|显示分支) main$/).isChecked(), true);
    assert.equal(await sidebar.getByLabel(/^(?:Show branch|显示分支) feature\/history-graph$/).isChecked(), true);

    await page.reload();
    await workbench.waitFor();
    await page.locator('.toolbar .commit-trigger').click();
    assert.equal(await page.getByRole('textbox', { name: /^(?:Commit message|提交消息)$/ }).inputValue(), 'Persistent bilingual draft');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('textbox', { name: /^(?:Search commit history|搜索提交历史)$/ }).inputValue(), 'native diff');
    assert.equal(await page.getByLabel(/^(?:Show branch|显示分支) feature\/history-graph$/).isChecked(), true);
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await page.getByTestId('interface-settings').getByRole('button',{name:'语言',exact:true}).click();
    const languageSelect=page.getByTestId('interface-settings').getByRole('combobox',{name:/^(?:Language|语言)$/});
    assert.equal(await languageSelect.inputValue(), 'zh-CN');
    await languageSelect.selectOption('en');
    await page.getByRole('dialog').locator('.modal-footer .primary').click();

    await history.locator('[data-working-tree]').click();
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
    assert.ok(['rgb(255, 255, 255)','rgba(0, 0, 0, 0)'].includes(await projectButton.evaluate(button => getComputedStyle(button).backgroundColor)), 'Light buttons must use the light surface or inherit it transparently');
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

    // Search results intentionally hide Graph; restore full history for column resizing.
    await page.getByRole('textbox', { name: /^(?:Search commit history|搜索提交历史)$/ }).fill('');
    await history.locator('[data-oid]').first().waitFor();
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
  } finally {
    await page.close();
  }
}
