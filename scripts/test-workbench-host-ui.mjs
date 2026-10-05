import assert from 'node:assert/strict';

/** Real render checks for the two constrained VS Code hosting shapes. */
export async function verifyDockedWorkbench(browser, url) {
  for (const viewport of [{ width: 340, height: 760 }, { width: 1100, height: 320 }]) {
    const page = await browser.newPage({ viewport }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(() => { window.__ALWAYGIT_HOST__ = 'docked'; });
      await page.goto(url);
      const root = page.getByTestId('workbench'), nav = page.getByRole('navigation', { name: 'Workbench Regions' });
      await nav.waitFor();
      await page.getByTestId('sidebar').getByRole('option', { name: /^AlwayGit/ }).dblclick();
      const history = page.getByTestId('history');
      await nav.getByRole('button', { name: 'History', exact: true }).click();
      await history.locator('[data-oid]').first().waitFor();
      const selected = history.locator('[data-oid]').nth(1);
      await selected.click();
      const oid = await selected.getAttribute('data-oid');
      await nav.getByRole('button', { name: 'Details / Changes', exact: true }).click();
      await page.getByTestId('details').waitFor();
      assert.equal(await history.isVisible(), false);
      await nav.getByRole('button', { name: 'Diff / Terminal', exact: true }).click();
      await page.getByTestId('bottom-dock').waitFor();
      await nav.getByRole('button', { name: 'History', exact: true }).click();
      assert.equal(await history.locator(`[data-oid="${oid}"]`).getAttribute('aria-selected'), 'true', 'Region switching preserves commit selection');
      assert.equal(await page.getByTestId('sidebar').isVisible(), false);
      const bounds = await root.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight, scrollHeight: element.scrollHeight }));
      assert.ok(bounds.scrollWidth <= bounds.width + 1 && bounds.scrollHeight <= bounds.height + 1, 'Docked workbench fits its host');
      await page.getByRole('button', { name: 'Workbench Opening Mode', exact: true }).waitFor();
      await page.setViewportSize({ width: 1100, height: 780 });
      await nav.waitFor({ state: 'hidden' });
      await page.getByTestId('sidebar').waitFor();
      await history.waitFor();
      await page.getByTestId('details').waitFor();
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
}
