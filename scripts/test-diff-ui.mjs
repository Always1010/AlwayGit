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
      const right = lines.map((line, i) => [6, 7, 8, 40, 41, 42, 80, 81, 82].includes(i) ? i === 81 ? 'right long ' + 'abcdefghij'.repeat(120) : `changed line ${i}` : line);
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
        if (request.method === 'details') result = { commit, body: '', files: [{ path: 'diff.txt', status: 'M' }, { path: 'same.txt', status: 'M' }] };
        if (request.method === 'diffPreview') result = { path: request.payload.path, leftLabel: 'Before', rightLabel: 'After', left: fixture.left, right: request.payload.path === 'same.txt' ? fixture.left : fixture.right, truncated: fixture.truncated };
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 10);
      } });
    });
    await page.goto(url);
    const diff = page.getByTestId('diff-preview'), count = diff.getByTestId('diff-change-count'), viewport = diff.locator('.diff-viewport');
    await count.getByText('1/3', { exact: true }).waitFor();
    assert.equal(await diff.getByRole('button', { name: 'Previous change' }).isDisabled(), true);
    await diff.getByRole('button', { name: 'Next change' }).click();
    await count.getByText('2/3', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await count.getByText('3/3', { exact: true }).waitFor();
    assert.equal(await diff.getByRole('button', { name: 'Next change' }).isDisabled(), true);
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
    await viewport.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
    await count.getByText('1/3', { exact: true }).waitFor();
    await page.getByTestId('details').getByRole('button', { name: 'same.txt', exact: true }).click();
    await count.getByText('0/0', { exact: true }).waitFor();
    assert.equal(await viewport.evaluate(element => element.scrollLeft), 0);
    await page.getByTestId('history').getByRole('button', { name: /Working Tree/ }).click();
    await count.getByText('1/3', { exact: true }).waitFor();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await diff.getByRole('button', { name: 'Next change' }).click();
    await count.getByText('3/3', { exact: true }).waitFor();
    const scroll = await viewport.evaluate(element => element.scrollTop);
    await page.evaluate(() => { const fixture = window.__diffFixture, left = fixture.left.split('\n'), right = fixture.right.split('\n'); for (const i of [6, 7, 8]) right[i] = left[i]; fixture.right = right.join('\n'); fixture.emit(); });
    await count.getByText('2/2', { exact: true }).waitFor();
    assert.ok(Math.abs(await viewport.evaluate(element => element.scrollTop) - scroll) < 2, 'Same-file refresh retains scroll');
    await page.evaluate(() => { window.__diffFixture.truncated = true; window.__diffFixture.emit(); });
    await count.getByText('2/2 (preview)', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_DIFF_UI_TESTS_PASSED: block outline, count/arrows, jump visibility, manual scroll, long lines, reset, refresh remap and truncation');
  } finally { await page.close(); }
}
