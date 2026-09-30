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
    await page.evaluate(() => {
      const fixture = window.__feedbackFixture;
      fixture.snapshot.operation = { kind: 'cherry-pick', conflicts: 2, canContinue: false, canAbort: true, canSkip: true };
      fixture.snapshot.changes = ['src/features/auth/login.ts', 'webview/Details.tsx'].map(path => ({ path, indexStatus: 'U', worktreeStatus: 'U', conflict: true, untracked: false }));
      window.postMessage({ type: 'changed', repoId: 'feedback' }, '*');
    });
    const operation = page.getByTestId('operation-notice');
    await operation.getByText('Cherry-pick paused', { exact: true }).waitFor();
    await operation.getByText('2 conflicts', { exact: true }).waitFor();
    assert.equal(await operation.getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true);
    await operation.getByText('Resolve and Stage conflicting files before Continue.', { exact: true }).waitFor();
    await operation.getByRole('button', { name: 'View Conflicts', exact: true }).click();
    await page.waitForFunction(() => window.__feedbackFixture.calls.some(call => call.method === 'diffPreview' && call.payload.area === 'conflict' && call.payload.path === 'src/features/auth/login.ts'));
    await page.getByTestId('details').locator('.change-group').first().getByText('src/features/auth', { exact: true }).waitFor();
    await operation.getByRole('button', { name: 'Abort…', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.screenshot({ path: 'artifacts/workbench-conflicts.png' });
    await page.evaluate(() => {
      const fixture = window.__feedbackFixture;
      fixture.snapshot.operation = { kind: 'cherry-pick', conflicts: 0, canContinue: true, canAbort: true, canSkip: true };
      fixture.snapshot.changes = fixture.snapshot.changes.map(file => ({ ...file, indexStatus: 'M', worktreeStatus: ' ', conflict: false }));
      window.postMessage({ type: 'changed', repoId: 'feedback' }, '*');
    });
    await operation.getByText('Ready to Continue', { exact: true }).waitFor();
    assert.equal(await operation.getByRole('button', { name: 'Continue', exact: true }).isEnabled(), true);
    await operation.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => window.__feedbackFixture.pending?.payload.type === 'operation.continue');
    await page.evaluate(() => { window.__feedbackFixture.snapshot.operation = { conflicts: 0, canContinue: false, canSkip: false, canAbort: false }; window.__feedbackFixture.complete(); });
    await operation.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_FEEDBACK_UI_TESTS_PASSED: Push states and target, persistent results, error/log, conflicts navigation, disabled reason, resolved Continue');
  } finally { await page.close(); }
}
