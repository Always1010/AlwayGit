import assert from 'node:assert/strict';

export async function verifyLocateHead(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const repo = { id: 'locate', root: '/fixture', commonDir: '/fixture/.git', name: 'Locate fixture' };
      const commits = Array.from({ length: 150 }, (_, index) => ({ oid: (index + 1).toString(16).padStart(40, '0'), parents: index < 149 ? [(index + 2).toString(16).padStart(40, '0')] : [], author: 'Fixture', email: 'fixture@example.com', timestamp: 0, subject: `Commit ${index}` }));
      const head = commits[40];
      const fixture = window.__locateFixture = { calls: [], cleared: false };
      window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage(request) {
        fixture.calls.push(request.method);
        let result;
        if (request.method === 'repositories') result = [repo];
        if (request.method === 'snapshot') result = { repository: repo, branch: 'main', head: head.oid, upstream: 'origin/main', ahead: 0, behind: 40, changes: [], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: head.oid }, { name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote', oid: commits[0].oid }], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 };
        if (request.method === 'history') result = { commits, head, tips: [commits[0].oid, head.oid], nextOffset: 150, hasMore: false };
        if (request.method === 'details') { const commit = commits.find(commit => commit.oid === request.payload.oid); result = { commit, body: commit.subject, files: [] }; }
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 30);
      } });
    });
    await page.goto(url);
    await page.getByRole('option', { name: 'Locate fixture', exact: true }).dblclick();
    const history = page.getByTestId('history'), viewport = history.locator('.history-viewport');
    await history.locator('[data-oid]').first().waitFor();
    await page.getByTestId('details').getByText('Commit 0', { exact: true }).first().waitFor();
    await page.evaluate(() => {
      window.__locateFixture.calls.length = 0;
      new MutationObserver(() => {
        const history = document.querySelector('[data-testid="history"]');
        if (history.querySelector('[role="table"]').getAttribute('aria-rowcount') !== '152' || history.textContent.includes('Reading history')) window.__locateFixture.cleared = true;
      }).observe(document.querySelector('[data-testid="history"]'), { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-rowcount'] });
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.waitForFunction(() => document.querySelector('.history-viewport').scrollTop > 2000);
      await page.getByRole('button', { name: 'Locate HEAD', exact: true }).click();
      await page.waitForFunction(() => {
        const head = document.querySelector('[data-head-commit="true"][aria-selected="true"]');
        const viewport = document.querySelector('.history-viewport');
        if (!head) return false;
        const row = head.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
        return row.top >= bounds.top && row.bottom <= bounds.bottom;
      });
      await page.getByTestId('details').getByText('Commit 40', { exact: true }).first().waitFor();
      assert.equal(await history.getByRole('table').getAttribute('aria-rowcount'), '152');
      assert.deepEqual(await page.evaluate(() => window.__locateFixture.calls.filter(method => ['snapshot', 'history'].includes(method))), [], 'Locating a loaded HEAD must not request Graph data');
      assert.equal(await page.evaluate(() => window.__locateFixture.cleared), false, 'Graph must not clear or show a history loading state');
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

export async function verifyHistoryRows(page) {
  const history = page.getByTestId('history'), rows = history.locator('[data-oid]');
  const first = rows.nth(0), second = rows.nth(1), third = rows.nth(2);
  const working = history.locator('[data-working-tree]'), head = history.locator('[data-head-commit="true"]').first();
  await working.waitFor();
  await head.waitFor();
  assert.ok(await working.locator('svg[data-working="true"] .git-graph-working-node').count(), 'Working Tree must use a distinct graph node');
  assert.equal(await head.locator('.git-graph-head-ring').count(),0,'HEAD must use the same graph node as other commits');
  assert.equal(await head.locator('.ref-badge.current').count(),0,'Current branch must not use a special green badge');
  assert.equal(await head.getByText('HEAD ·',{exact:false}).count(),0,'Current branch badge must only show its branch name');
  assert.ok(await head.getByText('main',{exact:true}).count(),'Current branch name must remain visible');
  const workingBox=await working.boundingBox(),headBox=await head.boundingBox();
  assert.ok(workingBox&&headBox&&workingBox.y<headBox.y&&Math.abs(workingBox.y+workingBox.height-headBox.y)<2,'Working Tree must sit immediately above HEAD');
  assert.match(await working.innerText(),/Working Tree.*changes.*on main/s);
  await working.click();
  assert.equal(await working.getAttribute('aria-selected'),'true');
  await working.press('ArrowDown');
  await page.waitForFunction(()=>document.activeElement?.getAttribute('data-head-commit')==='true');
  assert.equal(await head.getAttribute('aria-selected'),'true');
  await head.press('ArrowUp');
  await page.waitForFunction(()=>document.activeElement?.hasAttribute('data-working-tree'));
  assert.equal(await working.getAttribute('aria-selected'),'true');
  const historyTable = history.getByRole('table', { name: 'Commit history' });
  const loadedCommitCount = Number(await historyTable.getAttribute('aria-rowcount')) - 2;
  await first.press('Control+a');
  assert.equal(await history.locator('[data-oid][aria-selected="true"]').count(), await rows.count(), 'Ctrl+A marks every rendered real Commit as selected');
  assert.equal(await working.getAttribute('aria-selected'), 'false', 'Ctrl+A excludes Working Tree from Commit selection');
  await history.getByText(new RegExp(`\\b${loadedCommitCount} Commits selected\\b`)).waitFor();
  assert.equal(Number(await historyTable.getAttribute('aria-rowcount')) - 2, loadedCommitCount, 'Ctrl+A must not load another history page');
  assert.equal(await page.evaluate(() => window.getSelection()?.toString()), '', 'History Ctrl+A must not select page text');
  await first.press('Escape');
  assert.equal(await history.locator('[data-oid][aria-selected="true"]').count(), 0, 'Escape clears Commit action selection');
  assert.equal(Number(await historyTable.getAttribute('aria-rowcount')) - 2, loadedCommitCount, 'Escape must not load another history page');
  await first.click();
  const secondOid = await second.getAttribute('data-oid'), thirdOid = await third.getAttribute('data-oid');
  const normalBackground = await second.evaluate(row => getComputedStyle(row).backgroundColor);
  await second.locator('.history-author').hover();
  assert.notEqual(await second.evaluate(row => getComputedStyle(row).backgroundColor), normalBackground, 'Author hover must highlight the complete row');
  const cursors = await second.evaluate(row => [row, row.querySelector('.commit-message-button'), row.querySelector('.history-author'), row.querySelector('.history-date')].map(element => getComputedStyle(element).cursor));
  assert.deepEqual(cursors, ['pointer', 'pointer', 'pointer', 'pointer']);
  await second.locator('.history-author').click();
  assert.equal(await second.getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => window.getSelection().toString()), '');
  await second.press('ArrowDown');
  await page.waitForFunction(oid => document.activeElement?.getAttribute('data-oid') === oid, thirdOid);
  assert.equal(await third.getAttribute('aria-selected'), 'true');
  await third.press('ArrowUp');
  await page.waitForFunction(oid => document.activeElement?.getAttribute('data-oid') === oid, secondOid);
  await second.press('Enter');
  assert.equal(await second.getAttribute('aria-selected'), 'true');
  await second.press('Shift+F10');
  await page.getByTestId('context-menu').getByRole('menuitem', { name: 'Copy Commit ID', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  for (const cell of ['.history-date', '.graph-cell', '.commit-message-button']) {
    await second.locator(cell).dblclick();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    await dialog.getByRole('textbox', { name: 'Branch Name', exact: true }).waitFor();
    await dialog.getByText(`Commit ${secondOid.slice(0,12)}`, { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Create Only', exact: true }).count(),0,'Historical Checkout must create and switch');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await first.locator('.history-author').click();
  await second.locator('.history-author').click({ modifiers: ['Control'] });
  assert.equal(await first.getAttribute('aria-selected'), 'true');
  assert.equal(await second.getAttribute('aria-selected'), 'true');
  const details=page.getByTestId('details');
  await details.locator('.comparison-summary').waitFor();
  assert.ok(await details.locator('.detail-files .file-item').count(),'Selecting exactly two Commits must show their changed files without another action');
  await third.locator('.history-author').click({ modifiers: ['Control'] });
  assert.equal(await history.locator('[data-oid][aria-selected="true"]').count(),3);
  await details.locator('.commit-metadata').waitFor();
  await third.locator('.history-author').click();
  assert.equal(await history.locator('[data-oid][aria-selected="true"]').count(), 1);
  assert.equal(await details.locator('.comparison-summary').count(),0,'Returning to one Commit must leave comparison mode');
  const search=history.getByRole('textbox',{name:'Search commit history'});
  const normalMessageWidth=(await first.locator('.commit-subject').boundingBox()).width;
  const normalGraphWidth=await history.getByRole('separator',{name:'Resize graph column'}).getAttribute('aria-valuenow');
  await search.fill('Polish');
  await history.getByText('Commit Search Results',{exact:true}).waitFor();
  await history.getByText('15 matching Commits',{exact:false}).waitFor();
  assert.equal(await history.locator('.graph-cell,svg.git-graph').count(),0,'Search results must not render incomplete topology');
  assert.equal(await history.getByRole('columnheader').count(),3,'Graph header and column must disappear together');
  assert.equal(await history.getByRole('separator',{name:'Resize graph column'}).count(),0);
  assert.ok((await first.locator('.commit-subject').boundingBox()).width>normalMessageWidth,'Recovered Graph width must be given to messages');
  assert.ok(await first.locator('.search-push-state.local').count(),'Local status remains available without Graph');
  assert.ok(await second.locator('.search-push-state.pushed').count(),'Pushed status remains available without Graph');
  assert.ok(await first.getByText('main',{exact:true}).count(),'Matching Commit keeps its branch badge');
  assert.ok(await working.count(),'Working Tree stays available during search');
  await second.click();
  const resultOid=await second.getAttribute('data-oid');
  await history.getByRole('button',{name:'Locate in full history'}).click();
  await history.getByRole('columnheader',{name:/^Graph/}).waitFor();
  await history.locator(`[data-oid="${resultOid}"][aria-selected="true"]`).waitFor();
  assert.equal(await search.inputValue(),'');
  assert.equal(await history.getByRole('separator',{name:'Resize graph column'}).getAttribute('aria-valuenow'),normalGraphWidth,'Search must preserve stored Graph width');
  await search.fill('no-such-commit-result');
  await history.getByText('No matching commits',{exact:true}).waitFor();
  assert.equal(await rows.count(),0);
  assert.equal(await history.locator('.graph-cell').count(),0);
  assert.equal(await history.getByRole('button',{name:'Locate in full history'}).isEnabled(),false);
  await search.fill('');
  await history.getByRole('columnheader',{name:/^Graph/}).waitFor();
  await first.locator('.graph-cell').waitFor();
  await verifyDetachedHeadPolicy(page);
  console.log('ALWAYGIT_HISTORY_UI_TESTS_PASSED: Working Tree and Commit interactions; search hides Graph and preserves status; full-history location and Graph width restoration; empty search results');
}

async function verifyDetachedHeadPolicy(page) {
  const old = page.getByTestId('history').locator('[data-oid]').nth(1);
  const oid = await old.getAttribute('data-oid');
  const menu = page.getByTestId('context-menu');
  const detached = 'Checkout to Detached HEAD…';
  await old.click({button:'right'});
  assert.equal(await menu.getByRole('menuitem',{name:detached,exact:true}).count(),0);
  await page.keyboard.press('Escape');
  const settings = async () => {
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    const dialog = page.getByRole('dialog',{name:'Settings',exact:true});
    await dialog.getByRole('button',{name:'Git operations',exact:true}).click();
    return dialog;
  };
  let dialog = await settings();
  const checkbox = dialog.getByRole('checkbox',{name:'Allow direct Detached HEAD Checkout',exact:true});
  assert.equal(await checkbox.isChecked(),false);
  await checkbox.check();
  assert.equal(await page.evaluate(()=>localStorage.getItem('alwaygit.demo-allowDetachedHead')),null,'Draft settings must not enable Detached Checkout');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  dialog = await settings();
  assert.equal(await dialog.getByRole('checkbox').isChecked(),false);
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.reload();
  await old.waitFor();
  await old.dblclick();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox',{name:'Branch Name',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await old.click({button:'right'});
  await menu.getByRole('menuitem',{name:detached,exact:true}).click();
  dialog = page.getByRole('dialog',{name:'Checkout to Detached HEAD',exact:true});
  await dialog.getByText(`Checkout ${oid.slice(0,12)}`,{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Checkout to Detached HEAD',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByText('Detached HEAD',{exact:true}).first().waitFor();
  dialog = await settings();
  await dialog.getByRole('checkbox').uncheck();
  await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await old.dblclick();
  dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox',{name:'Branch Name',exact:true}).fill('inspect-history');
  await dialog.getByRole('button',{name:'Create and Checkout',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('[data-testid="current-branch"]')?.textContent==='inspect-history');
  assert.equal(await page.getByText('Detached HEAD',{exact:true}).count(),0);
}
