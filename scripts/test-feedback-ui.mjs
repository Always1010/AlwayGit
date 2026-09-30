import assert from 'node:assert/strict';

/** The response is held explicitly so every action state is observable. */
export async function verifyFeedback(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const repo = { id: 'feedback', root: '/feedback', commonDir: '/feedback/.git', name: 'Feedback fixture' };
      const commit = { oid: 'a'.repeat(40), parents: [], author: 'Fixture', email: 'test@example.com', timestamp: 0, subject: 'Test operations' };
      const fixture = window.__feedbackFixture = {
        pending: undefined, calls: [],
        snapshot: { repository: repo, branch: 'main', head: commit.oid, ahead: 1, behind: 0, pushTarget: { localBranch: 'main', remote: 'origin', remoteBranch: 'release', configured: true }, remotes: ['origin'], changes: [], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: commit.oid }], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 0 },
        complete(error) { window.postMessage({ type: 'response', id: this.pending.id, error: error ? { message: error } : undefined }, '*'); this.pending = undefined; },
      };
      window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage(request) {
        if (request.method === 'saveSession') return;
        fixture.calls.push(request);
        if (request.method === 'action') { fixture.pending = request; return; }
        let result;
        if (request.method === 'repositories') result = [repo];
        if (request.method === 'snapshot') result = structuredClone({ ...fixture.snapshot, version: ++fixture.snapshot.version });
        if (request.method === 'history') result = { commits: [commit], tips: [commit.oid], nextOffset: 1, hasMore: false };
        if (request.method === 'details') result = { commit, body: '', files: [] };
        if (request.method === 'diffPreview') result = { path: request.payload.path, leftLabel: 'Index', rightLabel: 'Working Tree', left: 'before', right: 'after' };
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 10);
      } });
    });
    await page.goto(url);
    const bar = page.getByTestId('action-feedback');
    async function push() {
      await page.locator('.toolbar').getByRole('button', { name: /^Push/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Push', exact: true }).click();
      await bar.getByText('Push in progress…', { exact: true }).waitFor();
      await bar.getByText('main → origin/release', { exact: true }).waitFor();
    }
    await push();
    assert.equal(await bar.getByRole('button', { name: 'Dismiss notification' }).count(), 0);
    await page.evaluate(() => window.__feedbackFixture.complete());
    await bar.getByText('Push completed', { exact: true }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.locator('.toolbar').getByRole('button', { name: 'Refresh', exact: true }).click();
    await bar.getByText('Push completed', { exact: true }).waitFor();
    await bar.getByRole('button', { name: 'Dismiss notification' }).click();
    await bar.waitFor({ state: 'hidden' });
    await push();
    await page.evaluate(() => window.__feedbackFixture.complete('remote: permission denied\nfatal: could not push to origin'));
    await bar.getByText('Push failed', { exact: true }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await bar.getAttribute('role'), 'alert');
    await bar.getByText('remote: permission denied', { exact: true }).waitFor();
    await bar.getByText('Error details', { exact: true }).click();
    assert.match(await bar.locator('pre').innerText(), /fatal: could not push/);
    await bar.getByRole('button', { name: 'Show Log', exact: true }).click();
    await page.waitForFunction(() => window.__feedbackFixture.calls.some(call => call.method === 'showLog'));
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_FEEDBACK_UI_TESTS_PASSED: Push running/success/failure, target, persistent results, error details and log');
  } finally { await page.close(); }
}
