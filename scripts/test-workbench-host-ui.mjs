import assert from 'node:assert/strict';

/** Validate the requested dialog in all hosting shapes, without launching VS Code. */
export async function verifyWorkbenchLocations(browser, url) {
  for (const language of ['en', 'zh-CN']) {
    const names = language === 'en'
      ? { title: 'Workbench Locations', editor: 'Editor Tab', sidebar: 'Primary Sidebar', auxiliary: 'Secondary Sidebar', panel: 'Panel', default: 'Default Open Workbench Location', cancel: 'Cancel', apply: 'Apply', close: 'Close' }
      : { title: '工作台显示位置', editor: '编辑器标签页', sidebar: '主侧边栏', auxiliary: '第二侧边栏', panel: '底部面板', default: '默认打开位置', cancel: '取消', apply: '应用', close: '关闭' };
    for (const { host, viewport } of [
      { host: 'editor', viewport: { width: 1100, height: 760 } },
      { host: 'sidebar', viewport: { width: 340, height: 760 } },
      { host: 'auxiliary', viewport: { width: 340, height: 760 } },
      { host: 'panel', viewport: { width: 1100, height: 320 } },
    ]) {
      const page = await browser.newPage({ viewport }), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.addInitScript(({ host, language }) => {
          window.__ALWAYGIT_HOST__ = host;
          localStorage.setItem('alwaygit.demo-interfaceSettings', JSON.stringify({ language }));
          localStorage.setItem('alwaygit.demo-workbenchLocations', JSON.stringify({ enabled: ['editor', 'sidebar', 'auxiliary', 'panel'], default: 'panel' }));
        }, { host, language });
        await page.goto(url);
        const open = () => page.getByRole('button', { name: names.title, exact: true }).click();
        await open();
        const dialog = page.getByRole('dialog', { name: names.title });
        await dialog.waitFor();
        assert.ok((await dialog.textContent()).includes(language === 'en' ? 'workflow and preferences' : '根据你的使用习惯和偏好'));
        assert.equal(await dialog.getByRole('checkbox').count(), 4);
        assert.equal(await dialog.getByRole('combobox').count(), 1);
        assert.equal(await dialog.getByRole('button').count(), 3, 'Only close, Cancel and Apply belong to the dialog');
        assert.equal(await dialog.getByRole('combobox').inputValue(), 'panel');
        await dialog.getByRole('checkbox', { name: names.panel, exact: true }).uncheck();
        assert.equal(await dialog.getByRole('combobox').inputValue(), 'editor');
        assert.equal(await dialog.locator('option').count(), 3);
        await dialog.getByRole('button', { name: names.cancel, exact: true }).click();
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('alwaygit.demo-workbenchLocations'))), { enabled: ['editor', 'sidebar', 'auxiliary', 'panel'], default: 'panel' });
        await open(); await dialog.waitFor();
        for (const name of [names.editor, names.sidebar, names.auxiliary, names.panel]) await dialog.getByRole('checkbox', { name, exact: true }).uncheck();
        assert.equal(await dialog.getByRole('button', { name: names.apply, exact: true }).isDisabled(), true);
        await dialog.getByRole('alert').waitFor();
        await dialog.getByRole('checkbox', { name: names.panel, exact: true }).check();
        await dialog.getByRole('checkbox', { name: names.sidebar, exact: true }).check();
        await dialog.getByRole('combobox').selectOption('sidebar');
        const bounds = await dialog.evaluate(element => {
          const r = element.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
        });
        assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= bounds.width && bounds.bottom <= bounds.height && bounds.scrollWidth <= bounds.clientWidth + 1, 'Dialog fits its host');
        await dialog.getByRole('button', { name: names.apply, exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('alwaygit.demo-workbenchLocations'))), { enabled: ['sidebar', 'panel'], default: 'sidebar' });
        await page.waitForFunction(() => localStorage.getItem('alwaygit.demo-openedLocation') === 'sidebar');
        await open(); await dialog.waitFor();
        assert.equal(await dialog.getByRole('checkbox', { name: names.editor, exact: true }).isChecked(), false);
        await dialog.getByRole('checkbox', { name: names.editor, exact: true }).check();
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('alwaygit.demo-workbenchLocations'))), { enabled: ['sidebar', 'panel'], default: 'sidebar' });
        await open(); await dialog.waitFor();
        await dialog.getByRole('checkbox', { name: names.editor, exact: true }).check();
        await dialog.getByRole('button', { name: names.close, exact: true }).click();
        assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('alwaygit.demo-workbenchLocations'))), { enabled: ['sidebar', 'panel'], default: 'sidebar' });
        // A native title gear can be pressed while another webview dialog is open.
        await page.locator('.settings-trigger').click();
        await page.getByRole('dialog').waitFor();
        await page.evaluate(language => window.postMessage({ type: 'showWorkbenchLocations', locations: { enabled: ['editor'], default: 'editor' }, language }, '*'), language);
        await dialog.waitFor();
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
        assert.equal(await page.getByRole('dialog').count(), 1, 'Escape closes the location dialog before the existing settings dialog');
        await page.getByRole('dialog').getByRole('button', { name: names.close, exact: true }).click();
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
    // Exercise the separately bundled launch-page listener and save failure/retry.
    const page = await browser.newPage({ viewport: { width: 340, height: 520 } }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(url);
      await page.setContent('<div id="locations-root"></div>');
      await page.evaluate(language => {
        window.launcherWrites = []; window.launcherClosed = []; window.failSave = true;
        window.acquireVsCodeApi = () => ({ postMessage(request) {
          if (request.method === 'workbenchLocationsReady') window.postMessage({ type: 'showWorkbenchLocations', locations: { enabled: ['editor'], default: 'editor' }, language }, '*');
          if (request.method === 'workbenchLocationsClosed') window.launcherClosed.push(document.querySelector('[role=dialog]') === null);
          if (request.method === 'saveWorkbenchLocations') {
            window.launcherWrites.push(request.payload);
            window.postMessage({ type: 'response', id: request.id, ...(window.failSave ? { error: { message: 'write failed' } } : { result: request.payload }) }, '*');
          } else window.postMessage({ type: 'response', id: request.id, result: null }, '*');
        } });
      }, language);
      const origin = new URL(url).origin;
      await page.addStyleTag({ url: origin + '/launcher/launcher.css' });
      await page.addScriptTag({ url: origin + '/launcher/launcher.js' });
      const dialog = page.getByRole('dialog', { name: names.title });
      await dialog.getByRole('checkbox', { name: names.panel, exact: true }).check();
      await dialog.getByRole('combobox').selectOption('panel');
      assert.equal(await page.evaluate(() => window.launcherWrites.length), 0);
      await dialog.getByRole('button', { name: names.apply, exact: true }).click();
      await dialog.getByRole('alert').filter({ hasText: 'write failed' }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.launcherClosed), []);
      assert.equal(await dialog.getByRole('checkbox', { name: names.panel, exact: true }).isChecked(), true);
      assert.equal(await dialog.getByRole('combobox').inputValue(), 'panel');
      await page.evaluate(() => { window.failSave = false; });
      await dialog.getByRole('button', { name: names.apply, exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.deepEqual(await page.evaluate(() => window.launcherWrites), [ { enabled: ['editor', 'panel'], default: 'panel' }, { enabled: ['editor', 'panel'], default: 'panel' } ]);
      assert.deepEqual(await page.evaluate(() => window.launcherClosed), [true], 'Close is sent only after the dialog unmounts');
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
}

/** Real render checks for the two constrained VS Code hosting shapes. */
export async function verifyDockedWorkbench(browser, url) {
  for (const { host, viewport } of [{ host: 'sidebar', viewport: { width: 340, height: 760 } }, { host: 'panel', viewport: { width: 1100, height: 320 } }]) {
    const page = await browser.newPage({ viewport }), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(host => { window.__ALWAYGIT_HOST__ = host; }, host);
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
      await page.getByRole('button', { name: 'Workbench Locations', exact: true }).waitFor();
      await page.setViewportSize({ width: 1100, height: 780 });
      await nav.waitFor({ state: 'hidden' });
      await page.getByTestId('sidebar').waitFor();
      await history.waitFor();
      await page.getByTestId('details').waitFor();
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
}
