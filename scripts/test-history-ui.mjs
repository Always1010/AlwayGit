import assert from 'node:assert/strict';

export async function verifyHistoryRows(page) {
  const history = page.getByTestId('history'), rows = history.locator('[data-oid]');
  const first = rows.nth(0), second = rows.nth(1), third = rows.nth(2);
  const working = history.locator('[data-working-tree]'), head = history.locator('[data-head-commit="true"]').first();
  await working.waitFor();
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
    await dialog.getByText(`Checkout ${secondOid}`, { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await first.locator('.history-author').click();
  await second.locator('.history-author').click({ modifiers: ['Control'] });
  assert.equal(await first.getAttribute('aria-selected'), 'true');
  assert.equal(await second.getAttribute('aria-selected'), 'true');
  await first.locator('.history-author').click();
  assert.equal(await history.locator('[data-oid][aria-selected="true"]').count(), 1);
  console.log('ALWAYGIT_HISTORY_UI_TESTS_PASSED: Working Tree affordance and adjacency; plain HEAD node and branch badge; commit row interactions');
}
