import assert from 'node:assert/strict';

export async function verifyHistoryRows(page) {
  const history = page.getByTestId('history'), rows = history.locator('[data-oid]');
  const first = rows.nth(0), second = rows.nth(1), third = rows.nth(2);
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
  console.log('ALWAYGIT_HISTORY_UI_TESTS_PASSED: whole row pointer, author selection, keyboard focus, context and double-click across cells');
}
