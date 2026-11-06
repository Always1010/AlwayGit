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
    await page.setViewportSize({ width: 1440, height: 1000 });
    const dialog = page.getByRole('dialog'),
      group = (name) => list.getByRole('group', { name, exact: true }),
      groupRows = (name) => group(name).getByRole('option'),
      mainRow = () => list.getByRole('option', { name: /^AlwayGit/ }).first();
    for (const name of ['Work', 'Frequent', 'Archive']) {
      await sidebar.getByRole('button', { name: 'Add…', exact: true }).click();
      await dialog.getByRole('tab', { name: 'Add Group', exact: true }).click();
      await dialog.getByRole('textbox', { name: 'Group name', exact: true }).fill(name);
      await dialog.getByRole('button', { name: 'Create Group', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    }
    await mainRow().locator('.repository-item').click({ button: 'right' });
    assert.equal(
      await menu.getByRole('menuitem', { name: 'Manage Groups…', exact: true }).count(),
      1,
    );
    assert.equal(
      await menu.getByRole('menuitem', { name: 'Move to Repository Group…', exact: true }).count(),
      0,
    );
    await menu.getByRole('menuitem', { name: 'Manage Groups…', exact: true }).click();
    assert.equal(
      await dialog.getByRole('button', { name: 'Apply', exact: true }).isDisabled(),
      true,
    );
    await dialog.getByRole('checkbox', { name: 'Work', exact: true }).check();
    await dialog.getByRole('checkbox', { name: 'Frequent', exact: true }).check();
    await page.screenshot({ path: 'artifacts/repository-groups-manage.png' });
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await groupRows('Work').count(), 1);
    assert.equal(await groupRows('Frequent').count(), 1);

    // Native dragging into a collapsed empty group moves only the source occurrence.
    await group('Archive').locator('.repository-collection-heading').click();
    await groupRows('Work')
      .locator('.repository-drag-handle')
      .dragTo(group('Archive').locator('.repository-collection-header'));
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Work"][role="group"] .repository-collection-count')
          ?.textContent === '0',
    );
    assert.equal(await groupRows('Frequent').count(), 1);
    assert.equal(await group('Archive').locator('.repository-collection-count').textContent(), '1');
    assert.equal(
      await group('Archive')
        .locator('.repository-collection-heading')
        .getAttribute('aria-expanded'),
      'false',
    );
    await group('Archive').locator('.repository-collection-heading').click();
    await groupRows('Archive')
      .locator('.repository-drag-handle')
      .dragTo(group('Frequent').locator('.repository-collection-header'));
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Archive"][role="group"] .repository-collection-count')
          ?.textContent === '0',
    );
    assert.equal(
      await groupRows('Frequent').count(),
      1,
      'An existing target occurrence is not duplicated',
    );

    // Mixed edits preserve the two repositories' different existing memberships.
    await groupRows('Frequent').locator('.repository-item').click();
    await list
      .getByRole('option', { name: /^website/ })
      .locator('.repository-item')
      .click({ modifiers: ['Control'] });
    await groupRows('Frequent').locator('.repository-item').click({ button: 'right' });
    await menu.getByRole('menuitem', { name: 'Manage Groups…', exact: true }).click();
    assert.equal(
      await dialog
        .getByRole('checkbox', { name: 'Frequent', exact: true })
        .evaluate((input) => input.indeterminate),
      true,
    );
    await dialog.getByRole('checkbox', { name: 'Work', exact: true }).check();
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await groupRows('Work').count(), 2);
    assert.equal(await groupRows('Frequent').count(), 1);

    // The root drop target appears only after a repository drag starts.
    await groupRows('Frequent').locator('.repository-item').click();
    const source = groupRows('Frequent').locator('.repository-drag-handle'),
      sourceBox = await source.boundingBox();
    await source.hover();
    await page.mouse.down();
    await page.mouse.move(
      sourceBox.x + sourceBox.width / 2 + 10,
      sourceBox.y + sourceBox.height / 2,
      { steps: 4 },
    );
    const rootDrop = list.locator('.repository-root-drop');
    await rootDrop.waitFor();
    const rootBox = await rootDrop.boundingBox();
    await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2, {
      steps: 8,
    });
    await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2 + 1);
    await list.getByRole('status').filter({ hasText: 'leave all groups' }).waitFor();
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.repository-list > .repository-row[data-repository-group]')
          .length === 1,
    );
    assert.equal(await groupRows('Frequent').count(), 0);
    assert.equal(
      await groupRows('Work').count(),
      1,
      'Root movement clears every membership of the moved repository only',
    );
    await page.screenshot({ path: 'artifacts/repository-groups-moved.png' });
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_SIDEBAR_SELECTION_UI_TESTS_PASSED');
  } finally {
    await page.close();
  }
}
