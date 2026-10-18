import assert from 'node:assert/strict';

/** Real pointer capture is essential: snapping must not unmount the active grip. */
export async function verifyPanelResize(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  try {
    await page.goto(url);
    await page.getByTestId('sidebar').getByRole('option', { name: /^AlwayGit/ }).dblclick();
    await page.getByTestId('history').waitFor();
    const restore = async () => {
      await page.getByTestId('toolbar-more').click();
      await page.getByRole('menuitem', { name: 'Restore Layout', exact: true }).click();
    };
    for (const { side, min, direction, panel } of [
      { side: 'left', min: 40, direction: 1, panel: 'sidebar' },
      { side: 'right', min: 64, direction: -1, panel: 'details' },
    ]) {
      await restore();
      const divider = page.locator(`.panel-divider-${side}`), grip = divider.getByRole('separator');
      const toggle = divider.locator('.panel-toggle'), content = page.getByTestId(panel);
      const folded = async value => { await page.locator(`.panel-divider-${side}[data-collapsed=${value}]`).waitFor({ state: 'attached' }); };
      const width = async () => Number(await grip.getAttribute('aria-valuenow'));
      const waitWidth = async expected => page.waitForFunction(({ panel, expected }) => Math.abs(document.querySelector(`[data-testid=${panel}]`).getBoundingClientRect().width - expected) < 1, { panel, expected });
      const original = await width();
      const start = await grip.boundingBox(), x = start.x + start.width / 2, y = start.y + 90;
      assert.equal(start.width, 6, `${side}: the expanded divider has a six-pixel drag area`);
      const moveToWidth = async value => { await page.mouse.move(x + (value - original) * direction, y, { steps: 5 }); };
      await page.mouse.move(x, y); await page.mouse.down();
      await moveToWidth(min + 8); await waitWidth(min + 8);
      assert.equal(await width(), min + 8, `${side}: shrinking remains under the pointer below the old minimum`);
      await moveToWidth(min - 1); await folded(true);
      await moveToWidth(min + 8); await folded(true); // 16 px hysteresis prevents boundary flicker.
      await moveToWidth(original + 30); await folded(false);
      await moveToWidth(original + 60);
      await page.mouse.up(); await waitWidth(original + 60);
      assert.equal(await width(), original + 60, `${side}: the same captured gesture reopens and keeps resizing`);
      assert.ok(Math.abs((await content.boundingBox()).width - await width()) <= 1);

      // A completed fold remembers the width at gesture start, rather than the last narrow frame.
      const remembered = await width(), next = await grip.boundingBox();
      await page.mouse.move(next.x + next.width / 2, y); await page.mouse.down();
      await page.mouse.move(next.x + next.width / 2 + (min - 1 - remembered) * direction, y, { steps: 6 });
      await folded(true); await page.mouse.up(); await waitWidth(0); await toggle.click(); await folded(false); await waitWidth(remembered);
      assert.equal(await width(), remembered, `${side}: button expansion restores the width before the fold gesture`);

      await toggle.click(); await folded(true); await waitWidth(0);
      // Sample an in-flight button animation, then grab its moving edge and take over.
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
      await toggle.evaluate(element => element.click());
      await page.clock.runFor(32);
      const openingWidth = await content.evaluate(element => element.getBoundingClientRect().width);
      assert.ok(openingWidth > 0 && openingWidth < remembered, `${side}: opening has intermediate animation frames`);
      const moving = await grip.boundingBox();
      await page.mouse.move(moving.x + moving.width / 2, y); await page.mouse.down();
      const frozen = await content.evaluate(element => element.getBoundingClientRect().width);
      await page.mouse.move(moving.x + moving.width / 2 + 8 * direction, y);
      await waitWidth(Math.max(min, Math.round(frozen + 8))); await page.mouse.up(); await page.clock.resume();
      await toggle.click(); await folded(true); await waitWidth(0);
      const edge = await grip.boundingBox(), edgeX = edge.x + edge.width / 2;
      assert.equal(edge.width, 6, `${side}: a collapsed panel retains a six-pixel hittable edge`);
      assert.equal(await grip.evaluate(element => getComputedStyle(element, '::after').width), '1px', 'The visible divider stays one pixel wide');
      await page.mouse.move(edgeX, y);
      assert.equal(await grip.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'Hover highlights only the one-pixel line, keeping the drag area transparent');
      await page.mouse.down();
      await page.mouse.move(edgeX + 30 * direction, y); await folded(true);
      await page.mouse.move(edgeX + (min + 20) * direction, y, { steps: 8 });
      await folded(false); await page.mouse.up(); await waitWidth(min + 20);
      assert.equal(await width(), min + 20, `${side}: dragging from the edge opens in the correct direction`);

      const beforeCancel = await width(), cancelStart = await grip.boundingBox();
      await page.mouse.move(cancelStart.x + cancelStart.width / 2, y); await page.mouse.down();
      await page.mouse.move(cancelStart.x + cancelStart.width / 2 + (min - 1 - beforeCancel) * direction, y);
      await folded(true); await page.keyboard.press('Escape'); await page.mouse.up(); await folded(false); await waitWidth(beforeCancel);
      assert.equal(await width(), beforeCancel, `${side}: Escape cancels the entire gesture`);
      await grip.focus(); await grip.press('Home');
      assert.equal(await width(), min, `${side}: keyboard minimum remains available`);
      await grip.press('End');
      assert.ok(await width() > (side === 'left' ? 360 : 480), `${side}: width can exceed the former fixed cap`);
      assert.ok((await page.getByTestId('history').boundingBox()).width >= 279, 'History retains usable width');
    }

    // Saved wide layouts fit a smaller viewport without changing the remembered dimensions.
    await page.setViewportSize({ width: 950, height: 900 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    const sidebarGrip = page.locator('.panel-divider-left').getByRole('separator');
    await sidebarGrip.press('End');
    assert.ok(Math.abs((await page.getByTestId('sidebar').boundingBox()).width - Number(await sidebarGrip.getAttribute('aria-valuenow'))) <= 1, 'Narrow layout uses the actual pointer width');
    await page.setViewportSize({ width: 720, height: 900 });
    assert.equal(await page.locator('.panel-divider-right').getByRole('separator').isVisible(), false, 'Stacked details do not expose a horizontal grip');
    await page.setViewportSize({ width: 500, height: 900 });
    await page.locator('[data-compact=true]').waitFor();
    assert.equal(await page.locator('.panel-divider-left').isVisible(), false, 'Compact navigation keeps dividers hidden');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' }); await restore();
    await page.locator('.panel-divider-left .panel-toggle').click();
    assert.equal(await page.getByTestId('sidebar').evaluate(element => element.getBoundingClientRect().width), 0, 'Reduced motion closes without an animation');
    await page.locator('.panel-divider-left .panel-toggle').click();
    assert.equal(await page.getByTestId('sidebar').evaluate(element => element.getBoundingClientRect().width), 210, 'Reduced motion restores the remembered width immediately');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}
