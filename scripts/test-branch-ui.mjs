import assert from 'node:assert/strict';

export async function verifyBranchCreation(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    const sidebar = page.getByTestId('sidebar');
    await sidebar.getByRole('option', { name: /^AlwayGit/ }).dblclick();
    const open = () => sidebar.getByRole('button', { name: 'Create Branch…', exact: true }).click();
    await open();
    const dialog = page.getByRole('dialog', { name: 'Create Branch', exact: true });
    const input = dialog.getByLabel('Branch Name', { exact: true });
    const only = dialog.getByRole('button', { name: 'Create Only', exact: true });
    const checkout = dialog.getByRole('button', { name: 'Create and Checkout', exact: true });
    for (const [name, reason] of [
      ['main', 'Local branch main already exists. Choose another branch name.'],
      ['main/nested', 'Branch name conflicts with existing local branch main. Choose another branch name.'],
      ['feature', 'Branch name conflicts with existing local branch feature/history-graph. Choose another branch name.'],
    ]) {
      await input.fill(name);
      await dialog.getByRole('alert').filter({ hasText: reason }).waitFor();
      assert.equal(await only.isDisabled(), true);
      assert.equal(await checkout.isDisabled(), true);
      // Check the form path too: disabled buttons must not be the only guard.
      await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      assert.equal(await input.inputValue(), name);
      assert.equal(await input.evaluate(element => element === document.activeElement), true);
      assert.equal(await page.getByTestId('action-feedback').count(), 0, 'Invalid names must never submit an action');
      assert.equal(await page.getByTestId('current-branch').innerText(), 'main');
    }
    await input.fill('feature/history-graph2');
    assert.equal(await input.getAttribute('aria-invalid'), null);
    assert.equal(await dialog.getByRole('alert').count(), 0);
    assert.equal(await only.isEnabled(), true);
    assert.equal(await checkout.isEnabled(), true);
    await only.click();
    await page.getByTestId('action-feedback').getByText('Created feature/history-graph2; still on main', { exact: true }).waitFor();
    // A remote-only name does not block creating a local branch.
    await open();
    await input.fill('origin/develop');
    assert.equal(await only.isEnabled(), true);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
