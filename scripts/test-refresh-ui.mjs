import assert from 'node:assert/strict';

/** Exercise real React effects with a controlled host, including in-flight Diff updates. */
export async function verifyRefresh(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const repo = { id: 'refresh', root: '/fixture', commonDir: '/fixture/.git', name: 'Refresh fixture' };
      const commit = { oid: 'a'.repeat(40), parents: ['b'.repeat(40), 'c'.repeat(40)], author: 'Fixture', email: 'fixture@example.com', timestamp: 0, subject: 'Historical merge' };
      const content = Array.from({ length: 180 }, (_, i) => `line ${i}`).join('\n');
      const fixture = window.__refreshFixture = {
        calls: [], detailsCleared: false, loadingShown: false, diffDelay: 30, right: content,
        snapshot: { repository: repo, branch: 'main', head: commit.oid, ahead: 0, behind: 0, changes: [{ path: 'a.txt', indexStatus: 'M', worktreeStatus: 'M', untracked: false, conflict: false }, { path: 'b.txt', indexStatus: ' ', worktreeStatus: 'M', untracked: false, conflict: false }], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: commit.oid }], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 0 },
        emit(changes) { window.postMessage({ type: 'changed', repoId: repo.id, changes }, '*'); },
      };
      window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage(request) {
        if (request.method === 'saveSession') return;
        fixture.calls.push(request.method);
        let result;
        if (request.method === 'repositories') result = [repo];
        if (request.method === 'snapshot') result = structuredClone({ ...fixture.snapshot, version: ++fixture.snapshot.version });
        if (request.method === 'history') result = { commits: [commit], tips: [fixture.snapshot.head], nextOffset: 1, hasMore: false };
        if (request.method === 'details') result = { commit, body: 'Historical merge body', parent: request.payload.parent ?? commit.parents[0], files: [{ path: 'a.txt', status: 'M' }] };
        if (request.method === 'diffPreview') result = { path: request.payload.path, leftLabel: request.payload.kind === 'commit' ? request.payload.parent.slice(0, 8) : request.payload.area === 'staged' ? 'HEAD' : 'Index', rightLabel: request.payload.kind === 'commit' ? 'Commit' : request.payload.area === 'staged' ? 'Index' : 'Working Tree', left: content, right: fixture.right };
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), request.method === 'diffPreview' ? fixture.diffDelay : 30);
      } });
    });
    await page.goto(url);
    const details = page.getByTestId('details'), diff = page.getByTestId('diff-preview'), viewport = diff.locator('.diff-viewport');
    await details.getByText('Historical merge body', { exact: true }).waitFor();
    await diff.locator('.diff-line').first().waitFor();
    await page.getByLabel('Compare parent').selectOption('c'.repeat(40));
    await diff.locator('.diff-labels').getByText('cccccccc', { exact: true }).waitFor();
    await viewport.evaluate(element => { element.scrollTop = 600; element.dispatchEvent(new Event('scroll')); });
    await page.evaluate(() => {
      const fixture = window.__refreshFixture;
      fixture.calls.length = 0;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="details"]')?.textContent.includes('Loading details')) fixture.detailsCleared = true;
        if (document.querySelector('[data-testid="diff-preview"]')?.textContent.includes('Loading Diff')) fixture.loadingShown = true;
      }).observe(document.querySelector('[data-testid="workbench"]'), { childList: true, subtree: true });
      fixture.emit({ paths: ['b.txt'] });
    });
    await page.waitForFunction(() => window.__refreshFixture.snapshot.version >= 2);
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => window.__refreshFixture.calls), ['snapshot']);
    assert.equal(await page.getByLabel('Compare parent').inputValue(), 'c'.repeat(40));
    assert.ok(await viewport.evaluate(element => element.scrollTop) >= 590, 'Unrelated changes preserve historical Diff scroll');

    await page.evaluate(() => { const fixture = window.__refreshFixture; fixture.calls.length = 0; fixture.snapshot.head = 'd'.repeat(40); fixture.snapshot.refs[0].oid = fixture.snapshot.head; fixture.emit({ paths: [] }); });
    await page.waitForFunction(() => window.__refreshFixture.calls.includes('history'));
    await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.__refreshFixture.calls), ['snapshot', 'history']);
    assert.equal(await page.getByLabel('Compare parent').inputValue(), 'c'.repeat(40));
    assert.ok(await viewport.evaluate(element => element.scrollTop) >= 590);
    assert.equal(await page.evaluate(() => window.__refreshFixture.detailsCleared || window.__refreshFixture.loadingShown), false);

    await page.getByTestId('history').getByRole('button', { name: /Working Tree/ }).click();
    await diff.locator('.diff-labels').getByText('Working Tree', { exact: true }).waitFor();
    await viewport.evaluate(element => { element.scrollTop = 600; element.dispatchEvent(new Event('scroll')); });
    await page.evaluate(() => { const fixture = window.__refreshFixture; fixture.calls.length = 0; fixture.loadingShown = false; fixture.diffDelay = 600; fixture.right += '\nupdated selected file'; fixture.emit({ paths: ['a.txt'] }); });
    await page.waitForFunction(() => window.__refreshFixture.calls.includes('diffPreview'));
    assert.ok(await diff.locator('.diff-line').count() > 0, 'Keep the previous Diff visible during a background request');
    assert.equal(await diff.getByText('Loading Diff…', { exact: true }).count(), 0);
    await page.waitForTimeout(650);
    assert.deepEqual(await page.evaluate(() => window.__refreshFixture.calls), ['snapshot', 'diffPreview']);
    assert.equal(await page.evaluate(() => window.__refreshFixture.loadingShown), false);
    assert.ok(await viewport.evaluate(element => element.scrollTop) >= 590, 'Updating the same working comparison preserves scroll');
    await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
    await diff.getByText('updated selected file', { exact: true }).waitFor();

    const staged = details.locator('.change-group:has(.change-heading-staged)');
    await staged.getByRole('button', { name: 'a.txt', exact: true }).click();
    await diff.locator('.diff-labels').getByText('HEAD', { exact: true }).waitFor();
    await page.evaluate(() => { const fixture = window.__refreshFixture; fixture.calls.length = 0; fixture.diffDelay = 30; fixture.emit({ paths: ['a.txt'] }); });
    await page.waitForFunction(() => window.__refreshFixture.calls.includes('snapshot'));
    await page.waitForTimeout(150);
    assert.deepEqual(await page.evaluate(() => window.__refreshFixture.calls), ['snapshot']);
    await diff.locator('.diff-labels').getByText('HEAD', { exact: true }).waitFor();
    await page.evaluate(() => { const fixture = window.__refreshFixture; fixture.calls.length = 0; fixture.emit({ paths: [], index: true }); });
    await page.waitForFunction(() => window.__refreshFixture.calls.includes('diffPreview'));
    await page.waitForTimeout(80);
    assert.deepEqual(await page.evaluate(() => window.__refreshFixture.calls), ['snapshot', 'diffPreview']);
    await diff.locator('.diff-labels').getByText('HEAD', { exact: true }).waitFor();
    assert.deepEqual(errors, [], 'Refresh must not throw runtime errors');
    console.log('ALWAYGIT_REFRESH_UI_TESTS_PASSED: historical details/parent/scroll retained, scoped history and working Diff refresh, unchanged dirty status, visible background updates, Staged selection');
  } finally { await page.close(); }
}
