import assert from 'node:assert/strict';
import { verifyTreeFocus } from './test-tree-focus-ui.mjs';

export async function verifyTreeCanvas(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }),
    errors = [];
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const revision = 'a'.repeat(40),
        baseRevision = 'b'.repeat(40),
        repoId = 'tree-canvas';
      window.__ALWAYGIT_COMMIT_TREE__ = { commitTree: { repoId, revision, baseRevision } };
      const entries = [
        ['README.md', 'blob'],
        ['src', 'tree'],
        ['src/components', 'tree'],
        ['src/components/Editor.vue', 'blob'],
        ['src/components/Toolbar.vue', 'blob'],
        ['src/components/dialogs', 'tree'],
        ['src/components/dialogs/Dialog.vue', 'blob'],
        ['src/utils', 'tree'],
        ['src/utils/helpers.ts', 'blob'],
        ['docs', 'tree'],
        ['docs/guide.md', 'blob'],
      ].map(([path, type]) => ({
        path,
        name: path.split('/').at(-1),
        type,
        mode: type === 'tree' ? '040000' : '100644',
        oid: revision,
      }));
      const fixture = (window.__treeCanvas = {
        calls: [],
        preferences: { mode: 'expanded', overrides: {} },
      });
      window.acquireVsCodeApi = () => ({
        getState: () =>
          JSON.parse(sessionStorage.getItem('tree-page-state') || 'null') ??
          window.__ALWAYGIT_COMMIT_TREE__,
        setState(value) {
          sessionStorage.setItem('tree-page-state', JSON.stringify(value));
        },
        postMessage(request) {
          fixture.calls.push(structuredClone(request));
          let result;
          if (request.method === 'saveInterfaceSettings') {
            sessionStorage.setItem('tree-defaults', JSON.stringify(request.payload));
            result = request.payload;
            queueMicrotask(() =>
              window.dispatchEvent(
                new MessageEvent('message', {
                  data: { type: 'interfaceSettingsChanged', settings: request.payload },
                }),
              ),
            );
          }
          if (['revisionTree', 'revisionTreeIndex'].includes(request.method))
            result = { revision, path: '', entries };
          if (request.method === 'revisionTreeCommit')
            result = {
              commit: {
                oid: revision,
                parents: [baseRevision],
                author: 'Fixture',
                timestamp: 1700000000,
                subject: 'Tree canvas fixture',
              },
              body: 'Tree canvas fixture',
              repository: { name: 'Tree canvas', root: '/tree-canvas' },
            };
          if (request.method === 'revisionTreeCompare')
            result = {
              revision,
              baseRevision,
              files: [{ path: 'src/components/Editor.vue', status: 'M' }],
            };
          if (request.method === 'treeExpansionRead') result = fixture.preferences;
          if (request.method === 'treeExpansionPatch') {
            if (request.payload.kind === 'mode')
              fixture.preferences = { mode: request.payload.mode, overrides: {} };
            else fixture.preferences.overrides[request.payload.path] = request.payload.expanded;
            result = fixture.preferences;
          }
          if (request.method === 'treeExpansionHintRead') result = true;
          if (request.method === 'isolatedDiffPreview')
            result = {
              kind: 'text',
              path: request.payload.path,
              leftLabel: 'Base',
              rightLabel: 'Commit',
              left: 'before\n',
              right:
                request.payload.kind === 'snapshot'
                  ? '  const description = "' +
                    '中文内容 alpha beta gamma '.repeat(24) +
                    '";\nnext line\n' +
                    'oversizedIdentifier'.repeat(80)
                  : 'after\n' +
                    Array.from({ length: 180 }, (_, index) => `line ${index}`).join('\n'),
            };
          queueMicrotask(() =>
            window.dispatchEvent(
              new MessageEvent('message', { data: { type: 'response', id: request.id, result } }),
            ),
          );
        },
      });
    });
    await page.goto(url);
    await page
      .locator(
        '.commit-tree-secondary-controls button[aria-label="Expand all directories"]:enabled',
      )
      .waitFor();
    await page
      .locator('.revision-tree-entry')
      .filter({ hasText: /^README\.md$/ })
      .click();
    await page.locator('.snapshot-content').waitFor();
    await page.waitForFunction(
      () => document.querySelector('.snapshot-line code')?.getBoundingClientRect().height > 36,
    );
    assert.deepEqual(
      await page.locator('.snapshot-line .line-number').allTextContents(),
      ['1', '2', '3'],
      'Snapshot previews keep original line numbers after wrapping',
    );
    const wrapped = await page.locator('.snapshot-line').first().boundingBox(),
      next = await page.locator('.snapshot-line').nth(1).boundingBox();
    assert.ok(
      Math.abs(wrapped.y + wrapped.height - next.y) < 1,
      'Wrapped snapshot lines reserve their full height',
    );
    assert.ok(
      await page
        .locator('.snapshot-text .diff-horizontal-scroll')
        .evaluate((bar) => bar.scrollWidth > bar.clientWidth),
      'Long snapshot identifiers remain horizontally reachable',
    );
    await page.locator('.snapshot-text .diff-horizontal-scroll').evaluate((bar) => {
      bar.scrollLeft = 160;
    });
    await page.waitForFunction(
      () => JSON.parse(sessionStorage.getItem('tree-page-state')).view.preview?.left > 0,
    );
    const grip = page.getByRole('separator', { name: 'Resize file tree and preview' });
    const tree = () =>
      page.locator('.commit-tree-body > .commit-tree-rows, .commit-tree-body > .commit-tree-graph');
    const size = async (axis) => (await tree().boundingBox())[axis === 'x' ? 'width' : 'height'];
    const drag = async (axis, delta) => {
      const box = await grip.boundingBox(),
        x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (axis === 'x' ? delta : 0), y + (axis === 'y' ? delta : 0), {
        steps: 12,
      });
      await page.mouse.up();
      await page.waitForFunction(() => {
        const grip = document.querySelector('.commit-tree-preview-divider'),
          pane = grip.previousElementSibling,
          axis = grip.getAttribute('aria-orientation') === 'vertical' ? 'width' : 'height';
        return (
          Math.abs(
            pane.getBoundingClientRect()[axis] - Number(grip.getAttribute('aria-valuenow')),
          ) < 1
        );
      });
    };
    const initial = await size('x');
    await drag('x', 180);
    assert.ok(
      Math.abs((await size('x')) - initial - 180) < 2,
      'Pointer capture resizes the actual list pane',
    );
    const remembered = await size('x');
    await page.locator('.snapshot-preview button[aria-label="Close file preview"]').click();
    await page
      .locator('.commit-tree-secondary-controls button[aria-label="Show or hide file preview"]')
      .click();
    assert.ok(Math.abs((await size('x')) - remembered) < 1, 'Reopening preview restores its split');
    await page.waitForFunction(
      () => document.querySelector('.snapshot-text .diff-horizontal-scroll')?.scrollLeft > 0,
    );

    for (const mode of ['horizontal', 'radial', 'vertical']) {
      await page.locator('.commit-tree-view-select').selectOption(mode);
      const camera = page.locator('.tree-graph-stage svg > g');
      await camera.waitFor();
      await page.locator('.tree-graph-stage').press('+');
      const scale = (await camera.getAttribute('transform')).match(/scale\(([^)]+)\)/)[1];
      await drag('x', -55);
      assert.equal(
        (await camera.getAttribute('transform')).match(/scale\(([^)]+)\)/)[1],
        scale,
        `${mode}: resizing preserves the user's zoom`,
      );
    }
    await grip.focus();
    await grip.press('Home');
    assert.ok(Math.abs((await size('x')) - 220) < 1, 'Keyboard resizing respects the tree minimum');
    await grip.press('End');
    assert.ok(
      (await page.locator('.commit-tree-preview').boundingBox()).width >= 219,
      'The preview retains a usable minimum',
    );
    await page.setViewportSize({ width: 600, height: 900 });
    await page.waitForFunction(
      () =>
        document.querySelector('.commit-tree-preview-divider')?.getAttribute('aria-orientation') ===
        'horizontal',
    );
    const initialHeight = await size('y');
    await drag('y', 65);
    assert.ok(
      Math.abs((await size('y')) - initialHeight - 65) < 2,
      'Narrow windows resize the stacked panes vertically',
    );
    const body = await page.locator('.commit-tree-body').boundingBox(),
      preview = await page.locator('.commit-tree-preview').boundingBox();
    assert.ok(
      preview.y + preview.height <= body.y + body.height + 1,
      'Stacked preview stays within the available height',
    );
    await verifyTreeFocus(page);
    const focus = page.locator(
      '.commit-tree-secondary-controls button[aria-label="Show changes only"]',
    );
    await focus.click();
    await page
      .locator('.revision-tree-entry')
      .filter({ hasText: /^Editor\.vue$/ })
      .click();
    await page.locator('.diff-preview').waitFor();
    await page.locator('.diff-viewport').evaluate((pane) => {
      pane.scrollTop = 620;
    });
    await page.waitForFunction(
      () => JSON.parse(sessionStorage.getItem('tree-page-state')).view.preview?.top >= 600,
    );
    await page.locator('.commit-tree-view-select').selectOption('vertical');
    await page.locator('.tree-graph-stage').press('+');
    await page.getByRole('button', { name: 'Scroll', exact: true }).click();
    const stage = await page.locator('.tree-graph-stage').boundingBox();
    await page.mouse.move(stage.x + 20, stage.y + 40);
    await page.mouse.down();
    await page.mouse.move(stage.x + 92, stage.y + 88, { steps: 5 });
    await page.mouse.up();
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('tree-page-state')));
    assert.equal(saved.view.viewMode, 'vertical');
    assert.equal(saved.view.changesOnly, true);
    assert.equal(saved.view.selected, 'src/components/Editor.vue');
    await page.reload();
    await page.locator('.tree-graph-stage svg > g').waitFor();
    await page.waitForFunction((camera) => {
      const view = JSON.parse(sessionStorage.getItem('tree-page-state')).view;
      return view.cameras?.vertical && Math.abs(view.cameras.vertical.scale - camera.scale) < 1e-8;
    }, saved.view.cameras.vertical);
    const restored = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('tree-page-state')),
    );
    for (const field of [
      'viewMode',
      'changesOnly',
      'showChanges',
      'selected',
      'previewOpen',
      'previewSplit',
      'expansion',
      'wheelMode',
    ])
      assert.deepEqual(
        restored.view[field],
        saved.view[field],
        `${field}: page recreation restores the complete snapshot`,
      );
    for (const field of ['centerX', 'centerY', 'scale'])
      assert.ok(
        Math.abs(restored.view.cameras.vertical[field] - saved.view.cameras.vertical[field]) < 0.01,
        `${field}: restoration must not be overwritten by initial fit`,
      );
    assert.equal(await focus.getAttribute('aria-pressed'), 'true');
    await page.locator('.diff-preview').waitFor();
    await page.waitForFunction(() => document.querySelector('.diff-viewport')?.scrollTop >= 600);
    await page.locator('.file-path-filter input').fill('Toolbar.vue');
    await page.reload();
    await page.locator('.file-path-filter input:enabled').waitFor();
    assert.equal(await page.locator('.file-path-filter input').inputValue(), 'Toolbar.vue');
    await page.getByRole('treeitem', { name: /^src\/components\/Toolbar\.vue/ }).waitFor();
    await page.locator('.file-path-filter input').fill('');
    await page.getByRole('treeitem', { name: /^src\/components\/Editor\.vue/ }).waitFor();
    assert.equal(
      await page.getByRole('treeitem', { name: /^src\/components\/Toolbar\.vue/ }).count(),
      0,
    );
    await page
      .locator('.commit-tree-secondary-controls button[aria-label="Commit file tree"]')
      .click();
    const defaultsDialog = page.getByRole('dialog', { name: 'Commit file tree' });
    await defaultsDialog.getByLabel('New file-tree pages').selectOption('defaults');
    await defaultsDialog.getByLabel('File tree presentation').selectOption('radial');
    await defaultsDialog.getByLabel('Default wheel behavior').selectOption('zoom');
    await page.reload();
    await defaultsDialog.waitFor();
    assert.equal(
      await defaultsDialog.getByLabel('File tree presentation').inputValue(),
      'radial',
      'Unapplied tree settings survive page reconstruction',
    );
    assert.equal(await defaultsDialog.getByLabel('New file-tree pages').inputValue(), 'defaults');
    assert.equal(
      await page.evaluate(() => sessionStorage.getItem('tree-defaults')),
      null,
      'Reconstruction must not apply draft settings',
    );
    await defaultsDialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await defaultsDialog.waitFor({ state: 'detached' });
    assert.equal(
      await page.locator('.commit-tree-view-select').inputValue(),
      'vertical',
      'New defaults must not replace an existing page snapshot',
    );
    const configured = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('tree-defaults')),
    );
    assert.equal(configured.treeDefaults.viewMode, 'radial');
    assert.equal(configured.treeDefaults.opening, 'defaults');
    await page
      .locator('.commit-tree-secondary-controls button[aria-label="Commit file tree"]')
      .click();
    await defaultsDialog.getByRole('button', { name: 'Reset file-tree defaults' }).click();
    await defaultsDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(sessionStorage.getItem('tree-defaults'))),
      configured,
      'Cancelling a reset leaves saved defaults unchanged',
    );
    await page
      .locator('.commit-tree-secondary-controls button[aria-label="Commit file tree"]')
      .click();
    await page.screenshot({ path: 'artifacts/tree-defaults-settings.png' });
    await page.setViewportSize({ width: 420, height: 760 });
    await defaultsDialog.waitFor();
    assert.ok(
      await defaultsDialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth + 1),
      'File-tree settings remain usable in narrow windows',
    );
    await page.screenshot({ path: 'artifacts/tree-defaults-settings-narrow.png' });
    await defaultsDialog.getByRole('button', { name: 'Cancel', exact: true }).click();

    const regular = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
      await regular.goto(url);
      await regular.getByRole('button', { name: 'Settings', exact: true }).click();
      const settings = regular.getByRole('dialog', { name: 'Settings', exact: true });
      await settings
        .locator('.settings-nav')
        .getByRole('button', { name: 'Commit file tree', exact: true })
        .click();
      await settings.getByLabel('New file-tree pages').selectOption('defaults');
      await settings.getByLabel('File tree presentation').selectOption('horizontal');
      await settings.getByRole('button', { name: 'Apply', exact: true }).click();
      await settings.waitFor({ state: 'detached' });
      const preferences = await regular.evaluate(() =>
        JSON.parse(localStorage.getItem('alwaygit.demo-interfaceSettings')),
      );
      assert.equal(preferences.treeDefaults.viewMode, 'horizontal');
      await regular.reload();
      await regular.getByRole('button', { name: 'Settings', exact: true }).click();
      await settings
        .locator('.settings-nav')
        .getByRole('button', { name: 'Commit file tree', exact: true })
        .click();
      await regular.waitForFunction(() => {
        const editor = document.querySelector('.tree-defaults-editor');
        return [...(editor?.querySelectorAll('select') ?? [])].some(
          (select) => select.value === 'horizontal',
        );
      });
      assert.equal(await settings.getByLabel('File tree presentation').inputValue(), 'horizontal');
      await settings.getByRole('button', { name: 'Reset file-tree defaults' }).click();
      await settings.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.deepEqual(
        await regular.evaluate(() =>
          JSON.parse(localStorage.getItem('alwaygit.demo-interfaceSettings')),
        ),
        preferences,
      );
    } finally {
      await regular.close();
    }
    assert.deepEqual(errors, [], 'Tree canvas must not produce runtime errors');
  } catch (error) {
    console.error(await page.locator('.commit-tree-preview').innerHTML());
    console.error(errors);
    throw error;
  } finally {
    await page.close();
  }
}
