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
                  : 'after\n',
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
    assert.deepEqual(errors, [], 'Tree canvas must not produce runtime errors');
  } catch (error) {
    console.error(await page.locator('.commit-tree-preview').innerHTML());
    console.error(errors);
    throw error;
  } finally {
    await page.close();
  }
}
