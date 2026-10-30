import assert from 'node:assert/strict';

export async function verifySidebarSelection(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url);
    const sidebar = page.getByTestId('sidebar'),
      list = sidebar.locator('.repository-list');
    const repositories = list.locator('.repository-row'),
      current = repositories.nth(0),
      other = repositories.nth(1);
    const currentButton = current.locator('.repository-item'),
      otherButton = other.locator('.repository-item');
    const count = () => sidebar.locator('[aria-selected="true"]').count();
    const outlined = (row) =>
      row.evaluate((element) => getComputedStyle(element).outlineStyle !== 'none');
    const blank = async () => {
      const box = await list.boundingBox();
      await list.click({ position: { x: box.width - 2, y: 1 } });
    };
    await currentButton.dblclick();
    await page.getByTestId('history').waitFor();
    await otherButton.click();
    assert.equal(await other.getAttribute('aria-selected'), 'true');
    assert.equal(
      await currentButton.getAttribute('aria-current'),
      'true',
      'Single click does not switch repository',
    );
    assert.equal(await otherButton.getAttribute('aria-current'), null);
    assert.equal(await outlined(other), true);
    await page.screenshot({ path: 'artifacts/sidebar-selection-selected.png' });
    await blank();
    assert.equal(await count(), 0, 'Empty list space clears operation selection');
    assert.equal(await otherButton.evaluate((element) => element === document.activeElement), true);
    assert.equal(await outlined(other), true, 'Empty space retains only the real focus outline');
    await page.screenshot({ path: 'artifacts/sidebar-selection-focus.png' });
    await page.getByTestId('details').locator('.pane-heading').first().click();
    assert.equal(await outlined(other), false, 'Non-focusable content outside releases row focus');
    assert.equal(await currentButton.getAttribute('aria-current'), 'true');
    await page.screenshot({ path: 'artifacts/sidebar-selection-cleared.png' });

    // Focus alone never contributes an operation target.
    await otherButton.focus();
    assert.equal(await count(), 0);
    await otherButton.press('Enter');
    await page.waitForFunction(() =>
      document
        .querySelector('.repository-item[aria-current="true"]')
        ?.textContent.includes('website'),
    );
    await currentButton.dblclick();
    await page.waitForFunction(() =>
      document
        .querySelector('.repository-item[aria-current="true"]')
        ?.textContent.includes('AlwayGit'),
    );
    await currentButton.click();
    await otherButton.click({ modifiers: ['Control'] });
    assert.equal(await count(), 2);
    await otherButton.click({ button: 'right' });
    const menu = page.getByRole('menu');
    await menu.getByRole('menuitem', { name: 'Copy 2 Repository Paths', exact: true }).waitFor();
    assert.equal(await count(), 2, 'Menu focus keeps the captured bulk targets');
    await page.keyboard.press('Escape');
    assert.equal(await count(), 2, 'First Escape only closes the menu');
    assert.equal(await otherButton.evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await count(), 0);
    assert.equal(await outlined(other), true);

    await currentButton.click();
    await otherButton.click({ modifiers: ['Control'] });
    await otherButton.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Remove from AlwayGit…', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await count(), 2, 'Confirmation focus keeps operation selection');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await count(), 2);
    await otherButton.click({ button: 'right' });
    await blank();
    assert.equal(await menu.count(), 0);
    assert.equal(await count(), 0, 'Dismissing a menu onto empty space also clears selection');

    const branch = sidebar.getByRole('button', { name: 'Branch main', exact: true });
    const graphChecks = () =>
      sidebar
        .locator('.branch-check input')
        .evaluateAll((inputs) => inputs.map((input) => input.checked));
    const checks = await graphChecks();
    await branch.click();
    assert.equal(await sidebar.locator('.ref-row.action-selected').count(), 1);
    await blank();
    assert.equal(await count(), 0);
    assert.deepEqual(
      await graphChecks(),
      checks,
      'Clearing branch selection never changes Graph filters',
    );
    await currentButton.click();
    await branch.focus();
    assert.equal(
      await count(),
      0,
      'Keyboard focus entering another scope clears old operation targets',
    );
    await currentButton.click();
    await current.locator('.repository-drag-handle').focus();
    assert.equal(await count(), 1, 'Reorder controls retain their operation context');
    await page.getByTestId('workbench').focus();
    assert.equal(await count(), 0);
    await page.setViewportSize({ width: 1440, height: 420 });
    await otherButton.click({ button: 'right' });
    await menu.waitFor();
    await sidebar.evaluate((element) => {
      element.scrollTop += 50;
    });
    await menu.waitFor({ state: 'hidden' });
    assert.equal(
      await count(),
      1,
      'Scrolling moves the menu source and closes its menu without discarding selection',
    );
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_SIDEBAR_SELECTION_UI_TESTS_PASSED');
  } finally {
    await page.close();
  }
}
