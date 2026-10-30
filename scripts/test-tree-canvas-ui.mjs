import assert from 'node:assert/strict';

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
        getState: () => window.__ALWAYGIT_COMMIT_TREE__,
        setState() {},
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
              right: 'after\n',
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
    assert.deepEqual(errors, [], 'Tree canvas must not produce runtime errors');
  } catch (error) {
    console.error(await page.locator('.commit-tree-preview').innerHTML());
    console.error(errors);
    throw error;
  } finally {
    await page.close();
  }
}
