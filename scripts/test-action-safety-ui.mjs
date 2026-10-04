import assert from 'node:assert/strict';

/** Keep settings saves pending while exercising real dialog cancellation and reuse. */
export async function verifyActionSafety(browser, url) {
  for (const mode of ['normal', 'cancel', 'switch', 'switch-back', 'save-failure']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.addInitScript(() => {
        const repositories = ['A', 'B'].map(name => ({ id: name, name: `Safety ${name}`, root: `/${name}`, commonDir: `/${name}/.git` }));
        const commit = { oid: 'a'.repeat(40), parents: [], author: 'Fixture', email: 'fixture@example.com', timestamp: 0, subject: 'Safety commit' };
        const settings = { allowDetachedHead: false, pushFollowTags: false, pushTagAfterCreate: false, defaultResetMode: 'mixed', scope: 'workspace' };
        const snapshot = id => ({ repository: repositories.find(repo => repo.id === id), branch: 'main', head: commit.oid, ahead: 1, behind: 0, changes: [], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: commit.oid, upstream: 'origin/main' }], remotes: ['origin'], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 });
        const reply = (request, result) => window.postMessage({ type: 'response', id: request.id, result }, '*');
        const fixture = window.__actionSafety = {
          calls: [], pending: undefined, settled: false,
          release(fail) {
            const request = fixture.pending;
            fixture.pending = undefined;
            if (fail) window.postMessage({ type: 'response', id: request.id, error: { message: 'Save failed' } }, '*');
            else reply(request, { ...settings, ...request.payload });
            // Drain promise continuations and React effects without timing-based assertions.
            setTimeout(() => { fixture.settled = true; }, 100);
          },
        };
        window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage(request) {
          fixture.calls.push(request);
          if (request.method === 'saveOperationSettings') { fixture.pending = request; return; }
          let result;
          if (request.method === 'repositories') result = repositories;
          if (request.method === 'snapshot') result = snapshot(request.repoId);
          if (request.method === 'history') result = { commits: [commit], tips: [commit.oid], nextOffset: 1, hasMore: false };
          if (request.method === 'details') result = { commit, body: commit.subject, files: [] };
          if (request.method === 'operationSettings') result = settings;
          if (request.method === 'action') result = snapshot(request.repoId);
          setTimeout(() => reply(request, result), 0);
        } });
      });
      await page.goto(url);
      await page.getByRole('option', { name: /^Safety A/ }).dblclick();
      await page.getByRole('button', { name: /^Push/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Push', exact: true });
      await dialog.getByText('Advanced Options', { exact: true }).click();
      await dialog.getByText('Remember this Tag choice as the Push default', { exact: true }).click();
      await dialog.getByRole('button', { name: 'Push', exact: true }).click();
      await page.waitForFunction(() => !!window.__actionSafety.pending);
      assert.equal(await dialog.getByRole('button', { name: 'Push', exact: true }).isDisabled(), true);
      assert.equal(await dialog.locator('input[type=checkbox]').first().isDisabled(), true);
      // Even direct duplicate form submissions may not enqueue another settings save.
      await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(await page.evaluate(() => window.__actionSafety.calls.filter(call => call.method === 'saveOperationSettings').length), 1);
      if (mode !== 'normal' && mode !== 'save-failure') {
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        if (mode === 'switch' || mode === 'switch-back') {
          await page.getByRole('option', { name: /^Safety B/ }).dblclick();
          if (mode === 'switch-back') await page.getByRole('option', { name: /^Safety A/ }).dblclick();
        }
        // A late save must not dismiss a newly opened dialog either.
        await page.getByRole('button', { name: /^Push/ }).click();
      }
      await page.evaluate(fail => window.__actionSafety.release(fail), mode === 'save-failure');
      await page.waitForFunction(() => window.__actionSafety.settled);
      const actions = await page.evaluate(() => window.__actionSafety.calls.filter(call => call.method === 'action'));
      if (mode === 'normal') {
        assert.equal(actions.length, 1); assert.equal(actions[0].repoId, 'A'); assert.equal(actions[0].payload.type, 'push');
        await dialog.waitFor({ state: 'hidden' });
      } else {
        assert.equal(actions.length, 0, `${mode}: old Push must not run`);
        assert.equal(await dialog.count(), 1, `${mode}: current dialog stays open`);
        assert.equal(await dialog.getByRole('button', { name: 'Push', exact: true }).isEnabled(), true);
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
  console.log('ALWAYGIT_ACTION_SAFETY_UI_TESTS_PASSED: pending save, duplicates, cancellation, repository switch/ABA, normal submit and save failure');
}
