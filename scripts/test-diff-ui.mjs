import assert from 'node:assert/strict';

export async function verifyDiffNavigation(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const repo = { id: 'diff', root: '/diff', commonDir: '/diff/.git', name: 'Diff fixture' };
      const commit = { oid: 'a'.repeat(40), parents: [], author: 'Fixture', email: 'test@example.com', timestamp: 0, subject: 'Diff navigation' };
      const lines = Array.from({ length: 130 }, (_, i) => `context line ${i}`);
      lines[81] = 'left long ' + '0123456789'.repeat(120);
      const right = lines.map((line, i) => [26, 27, 28, 40, 41, 42, 80, 81, 82].includes(i) ? i === 81 ? 'right long ' + 'abcdefghij'.repeat(120) : `changed line ${i}` : line);
      const fixture = window.__diffFixture = { calls: [], left: lines.join('\n'), right: right.join('\n'), truncated: false,
        snapshot: { repository: repo, branch: 'main', head: commit.oid, ahead: 0, behind: 0, changes: [{ path: 'diff.txt', indexStatus: ' ', worktreeStatus: 'M', conflict: false, untracked: false }], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: commit.oid }], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 0 },
        emit() { window.postMessage({ type: 'changed', repoId: repo.id, changes: { paths: ['diff.txt'] } }, '*'); },
      };
      window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage(request) {
        if (request.method === 'saveSession') return;
        fixture.calls.push(request.method);
        let result;
        if (request.method === 'repositories') result = [repo];
        if (request.method === 'snapshot') result = structuredClone({ ...fixture.snapshot, version: ++fixture.snapshot.version });
        if (request.method === 'history') result = { commits: [commit], tips: [commit.oid], nextOffset: 1, hasMore: false };
        if (request.method === 'details') result = { commit, body: '', files: ['diff.txt', 'same.txt', 'single.txt', 'large.txt'].map(path => ({ path, status: 'M' })) };
        if (request.method === 'diffPreview') {
          const path = request.payload.path;
          const right = path === 'same.txt' ? fixture.left : path === 'single.txt' || path === 'large.txt' ? fixture.left.split('\n').map((line, i) => i === 80 || path === 'large.txt' && i > 80 && i <= 115 ? `changed line ${i}` : line).join('\n') : fixture.right;
          result = { path, leftLabel: 'Before', rightLabel: 'After', left: fixture.left, right, truncated: fixture.truncated };
        }
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 10);
      } });
    });
    await page.goto(url);
    await page.getByRole('option', { name: 'Diff fixture' }).click();
    const diff = page.getByTestId('diff-preview'), count = diff.getByTestId('diff-change-count'), summary = diff.getByTestId('diff-change-summary'), viewport = diff.locator('.diff-viewport');
    const assertRevealed = async () => {
      await page.waitForFunction(() => {
        const block = document.querySelector('.active-change-start'), viewport = document.querySelector('.diff-viewport');
        if (!block || !viewport) return false;
        const a = block.getBoundingClientRect(), b = viewport.getBoundingClientRect();
        return a.y >= b.y - 1 && a.bottom <= b.bottom + 1;
      });
    };
    await count.getByText('1/3', { exact: true }).waitFor();
    await assertRevealed();
    assert.ok(await viewport.evaluate(element => element.scrollTop > 0), 'The first distant change is revealed automatically');
    assert.equal(await summary.locator('.diff-change-added').innerText(), '+0');
    assert.equal(await summary.locator('.diff-change-modified').innerText(), '~3');
    assert.equal(await summary.locator('.diff-change-removed').innerText(), '−0');
    assert.equal(await count.evaluate(element => getComputedStyle(element).borderTopWidth), '0px', 'Current/total count is flat text, not an input-like badge');
    const resize = page.getByRole('separator', { name: 'Resize Diff panel' });
    await resize.press('End');
    assert.ok((await diff.boundingBox()).height > 450, 'Diff panel maximum follows the available workbench height');
    const expandedHeight = (await diff.boundingBox()).height;
    await diff.getByRole('button', { name: 'Minimize Diff panel' }).click();
    assert.ok((await diff.boundingBox()).height <= 27, 'Minimized Diff keeps only its heading');
    assert.equal(await diff.locator('.diff-viewport').count(), 0);
    await diff.getByRole('button', { name: 'Expand Diff panel' }).click();
    assert.ok(Math.abs((await diff.boundingBox()).height - expandedHeight) < 2, 'Expanded Diff restores its previous height');
    assert.equal(await diff.getByRole('button', { name: 'Previous change' }).isEnabled(), true);
    await diff.getByRole('button', { name: 'Previous change' }).click();
    await count.getByText('3/3', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await count.getByText('1/3', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await count.getByText('2/3', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await count.getByText('3/3', { exact: true }).waitFor();
    assert.equal(await diff.getByRole('button', { name: 'Next change' }).isEnabled(), true);
    const block = diff.locator('.active-change-start');
    const blockBox = await block.boundingBox(), viewportBox = await viewport.boundingBox();
    assert.ok(blockBox.y >= viewportBox.y && blockBox.y < viewportBox.y + viewportBox.height, 'Jump must reveal the current block');
    const borders = await diff.locator('.active-change').evaluateAll(rows => rows.map(row => { const style = getComputedStyle(row, '::after'); return { top: style.borderTopWidth, bottom: style.borderBottomWidth, outline: getComputedStyle(row).outlineStyle }; }));
    assert.equal(borders.filter(border => border.top === '1px').length, 1);
    assert.equal(borders.filter(border => border.bottom === '1px').length, 1);
    assert.ok(borders.every(border => border.outline === 'none'), 'No outline on individual changed lines');
    await viewport.evaluate(element => { element.scrollLeft = 220; element.dispatchEvent(new Event('scroll')); });
    const halves = await diff.locator('.active-change-start').evaluate(row => [...row.children].map(cell => cell.getBoundingClientRect().width));
    assert.ok(halves.every(width => width > 300 && width < 700), 'Both columns retain half viewport width for long lines');
    assert.equal(await count.innerText(), '3/3', 'Horizontal scroll must not change current block');
    assert.ok(await viewport.evaluate(element => element.scrollWidth > element.clientWidth));
    await page.setViewportSize({ width: 960, height: 700 });
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.diff-viewport'), row = document.querySelector('.diff-line');
      return Math.abs(row.getBoundingClientRect().width - viewport.clientWidth) < 1;
    });
    const resizedHalves = await diff.locator('.active-change-start').evaluate(row => [...row.children].map(cell => cell.getBoundingClientRect().width));
    assert.ok(resizedHalves.every(width => width < 400), 'Resize recomputes both comparison columns');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => Math.abs(document.querySelector('.diff-line').getBoundingClientRect().width - document.querySelector('.diff-viewport').clientWidth) < 1);
    await viewport.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    await count.getByText('1/3', { exact: true }).waitFor();
    await page.getByTestId('details').getByRole('button', { name: 'same.txt', exact: true }).click();
    await count.getByText('0/0', { exact: true }).waitFor();
    assert.equal(await diff.getByRole('button', { name: 'Previous change' }).isDisabled(), true);
    assert.equal(await diff.getByRole('button', { name: 'Next change' }).isDisabled(), true);
    assert.equal(await viewport.evaluate(element => element.scrollLeft), 0);
    await diff.getByRole('button', { name: 'Minimize Diff panel' }).click();
    await page.getByTestId('details').getByRole('button', { name: 'single.txt', exact: true }).click();
    await count.getByText('1/1', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Expand Diff panel' }).click();
    await assertRevealed();
    for (const direction of ['Previous change', 'Next change']) {
      assert.equal(await diff.getByRole('button', { name: direction }).isEnabled(), true);
      await viewport.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
      await diff.getByRole('button', { name: direction }).click();
      await assertRevealed();
      assert.equal(await count.innerText(), '1/1', 'Repeated single-change navigation retains the only block');
    }
    const singleScroll = await viewport.evaluate(element => element.scrollTop);
    await diff.getByRole('button', { name: 'Minimize Diff panel' }).click();
    await diff.getByRole('button', { name: 'Expand Diff panel' }).click();
    await assertRevealed();
    assert.ok(Math.abs(await viewport.evaluate(element => element.scrollTop) - singleScroll) < 2, 'Collapse/expand preserves the reading position');
    await page.getByTestId('details').getByRole('button', { name: 'large.txt', exact: true }).click();
    await count.getByText('1/1', { exact: true }).waitFor();
    await assertRevealed();
    const largeStart = await diff.locator('.active-change-start').boundingBox(), largeViewport = await viewport.boundingBox();
    assert.ok(Math.abs(largeStart.y - largeViewport.y) < 2, 'A block taller than the viewport is revealed from its beginning');
    const topRow = await viewport.evaluate(element => element.scrollTop / document.querySelector('.diff-line').getBoundingClientRect().height);
    await page.getByRole('button', { name: 'Interface Settings', exact: true }).click();
    const settings = page.getByTestId('interface-settings'), dialog = page.getByRole('dialog', { name: 'Interface Settings' });
    await settings.getByRole('button', { name: 'Text & density', exact: true }).click();
    await settings.getByLabel('Diff line height', { exact: true }).selectOption('24');
    await page.waitForFunction(() => document.querySelector('.diff-line')?.getBoundingClientRect().height === 24);
    const resizedTopRow = await viewport.evaluate(element => element.scrollTop / 24);
    assert.ok(Math.abs(resizedTopRow - topRow) < .1, `Height preview retains the top reading row (${topRow} → ${resizedTopRow})`);
    await settings.getByLabel('Diff font', { exact: true }).selectOption('18');
    await settings.getByLabel('Diff line height', { exact: true }).selectOption('18');
    await page.waitForFunction(() => document.querySelector('.diff-line')?.getBoundingClientRect().height === 22);
    assert.equal(await diff.locator('.diff-line').first().evaluate(element => getComputedStyle(element).lineHeight), '22px', 'CSS and virtual rows agree on the safe minimum for large text');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.diff-line')?.getBoundingClientRect().height === 18);
    await viewport.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    await diff.getByRole('button', { name: 'Next change' }).click();
    await assertRevealed();
    await page.getByTestId('history').locator('[data-working-tree]').click();
    await count.getByText('1/3', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await count.getByText('3/3', { exact: true }).waitFor();
    const scroll = await viewport.evaluate(element => element.scrollTop);
    await page.evaluate(() => { const fixture = window.__diffFixture, left = fixture.left.split('\n'), right = fixture.right.split('\n'); for (const i of [26, 27, 28]) right[i] = left[i]; fixture.right = right.join('\n'); fixture.emit(); });
    await count.getByText('2/2', { exact: true }).waitFor();
    assert.ok(Math.abs(await viewport.evaluate(element => element.scrollTop) - scroll) < 2, 'Same-file refresh retains scroll');
    await page.evaluate(() => { window.__diffFixture.truncated = true; window.__diffFixture.emit(); });
    await count.getByText('2/2 (preview)', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_DIFF_UI_TESTS_PASSED: initial reveal, cyclic/single-change navigation, tall blocks, collapse/restore, type summary, scrolling, refresh remap and truncation');
  } finally { await page.close(); }
}
