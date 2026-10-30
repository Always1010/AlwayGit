import assert from 'node:assert/strict';

/** Run against the expanded tree fixture, including its saved expansion preferences. */
export async function verifyTreeFocus(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.commit-tree-view-select').selectOption('list');
  const actions = page.locator('.commit-tree-secondary-controls'),
    focus = actions.getByRole('button', { name: 'Only expand changed files', exact: true }),
    expand = actions.getByRole('button', { name: 'Expand all directories', exact: true }),
    collapse = actions.getByRole('button', { name: 'Collapse all directories', exact: true }),
    entry = (name) =>
      page
        .locator('.revision-tree-entry')
        .filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
  await entry('Toolbar.vue').waitFor();
  await focus.click();
  await entry('Toolbar.vue').waitFor({ state: 'detached' });
  assert.equal(await entry('README.md').count(), 0, 'Unchanged sibling files are hidden');
  await entry('Editor.vue').waitFor();
  for (const name of ['docs', 'utils', 'dialogs'])
    assert.equal(
      await entry(name).locator('..').getAttribute('aria-expanded'),
      'false',
      `${name}: unrelated directories are collapsed`,
    );
  assert.equal(await focus.getAttribute('aria-pressed'), 'true');
  await entry('docs').click();
  await entry('guide.md').waitFor();
  assert.equal(
    await entry('Toolbar.vue').count(),
    0,
    'Manual expansion reveals only the chosen directory',
  );
  assert.equal(
    await page.evaluate(
      () => window.__treeCanvas.calls.filter((call) => call.method === 'treeExpansionPatch').length,
    ),
    0,
    'Focusing and manual exploration leave saved folder preferences intact',
  );

  await focus.click();
  await entry('Toolbar.vue').waitFor();
  await focus.click();
  const search = page.locator('.file-path-filter input');
  await search.fill('Toolbar.vue');
  await entry('src/components/Toolbar.vue').waitFor();
  await search.fill('');
  await entry('Editor.vue').waitFor();
  assert.equal(await entry('Toolbar.vue').count(), 0, 'Clearing search restores the focused view');

  for (const mode of ['horizontal', 'radial', 'vertical']) {
    await page.locator('.commit-tree-view-select').selectOption(mode);
    await page.getByRole('treeitem', { name: /^src\/components\/Editor\.vue/ }).waitFor();
    assert.equal(
      await page.getByRole('treeitem', { name: /^src\/components\/Toolbar\.vue/ }).count(),
      0,
      `${mode}: only changed files remain visible`,
    );
    assert.equal(await focus.getAttribute('aria-pressed'), 'true');
  }
  await page.locator('.commit-tree-view-select').selectOption('list');
  await collapse.click();
  await entry('Editor.vue').waitFor({ state: 'detached' });
  assert.equal(
    await focus.getAttribute('aria-pressed'),
    'false',
    'Collapse All exits the temporary focus',
  );
  await focus.click();
  await entry('Editor.vue').waitFor();
  await expand.click();
  await entry('Toolbar.vue').waitFor();
  assert.equal(
    await focus.getAttribute('aria-pressed'),
    'false',
    'Expand All restores complete browsing',
  );
  await focus.click();
  await page.locator('.commit-tree-changes-toggle input').uncheck();
  await entry('Toolbar.vue').waitFor();
  await page.locator('.commit-tree-changes-toggle input').check();
  await focus.waitFor();
  assert.equal(
    await focus.getAttribute('aria-pressed'),
    'false',
    'Disabling markers clears the temporary comparison focus',
  );
}
