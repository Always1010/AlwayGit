import assert from 'node:assert/strict';

/** Pull sources and the keyboard confirmation path share the real action dialog. */
export async function verifyTransfer(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const repository = { id: 'transfer', name: 'Transfer', root: '/transfer', commonDir: '/transfer/.git' };
      const commit = { oid: 'a'.repeat(40), parents: [], author: 'Fixture', email: 'fixture@example.com', timestamp: 0, subject: 'Transfer commit' };
      const settings = { allowDetachedHead: false, pushFollowTags: false, pushTagAfterCreate: false, defaultResetMode: 'mixed', scope: 'workspace' };
      const snapshot = () => ({ repository, branch: fixture.branch, head: commit.oid, upstream: fixture.configured ? 'origin/main' : undefined,
        pullTarget: fixture.configured ? { localBranch: 'main', remote: 'origin', remoteBranch: 'main' } : undefined,
        ahead: 1, behind: 0, changes: [], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: commit.oid, upstream: fixture.configured ? 'origin/main' : undefined },
          ...['origin/main', 'origin/feature/source', 'upstream/release', 'upstream/HEAD'].map(name => ({ name, fullName: `refs/remotes/${name}`, kind: 'remote', oid: commit.oid, ...(name.endsWith('/HEAD') ? { symbolicTarget: 'refs/remotes/upstream/release' } : {}) }))],
        remotes: fixture.remotes, stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 });
      const reply = (request, result) => window.postMessage({ type: 'response', id: request.id, result }, '*');
      const fixture = window.__transfer = { calls: [], configured: true, remotes: ['origin', 'upstream'], branch: 'main', pending: undefined,
        release() { const request = fixture.pending; fixture.pending = undefined; reply(request, { snapshot: snapshot() }); },
      };
      window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage(request) {
        fixture.calls.push(request);
        if (request.method === 'action') { fixture.pending = request; return; }
        let result;
        if (request.method === 'repositories') result = [repository];
        if (request.method === 'snapshot') result = snapshot();
        if (request.method === 'history') result = { commits: [commit], tips: [commit.oid], nextOffset: 1, hasMore: false };
        if (request.method === 'details') result = { commit, body: commit.subject, files: [] };
        if (request.method === 'operationSettings') result = settings;
        setTimeout(() => reply(request, result), 0);
      } });
    });
    await page.goto(url);
    await page.getByRole('option', { name: /^Transfer/ }).dblclick();
    const openPull = () => page.getByTestId('workbench').getByRole('button', { name: /^Pull/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Pull', exact: true });
    const submit = dialog.getByRole('button', { name: 'Pull', exact: true });
    await openPull();
    await dialog.getByText('origin/main → main', { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Remote', { exact: true }).count(), 0, 'Default source is summarized, not an empty field');
    await submit.click();
    await page.waitForFunction(() => !!window.__transfer.pending);
    const first = await page.evaluate(() => window.__transfer.pending.payload);
    assert.deepEqual(first, { type: 'pull', strategy: 'ff-only', remote: 'origin', remoteBranch: 'main', expectedHead: 'a'.repeat(40), expectedBranch: 'main' });
    await page.evaluate(() => window.__transfer.release()); await dialog.waitFor({ state: 'hidden' });
    await openPull();
    await dialog.getByRole('button', { name: 'Change pull source', exact: true }).click();
    await dialog.getByLabel('Remote', { exact: true }).selectOption('upstream');
    const source = dialog.getByLabel('Source branch', { exact: true });
    assert.equal(await source.inputValue(), '', 'Changing remote clears the old source');
    assert.equal(await submit.isDisabled(), true);
    assert.deepEqual(await dialog.locator('datalist option').evaluateAll(options => options.map(option => option.value)), ['release'], 'Symbolic HEAD is excluded');
    await source.fill('--all'); assert.equal(await submit.isDisabled(), true);
    await source.fill('release/new');
    await dialog.getByText('upstream/release/new → main', { exact: true }).waitFor();
    await submit.click(); await page.waitForFunction(() => !!window.__transfer.pending);
    assert.equal(await page.evaluate(() => window.__transfer.pending.payload.remoteBranch), 'release/new');
    assert.equal(await page.evaluate(() => window.__transfer.pending.payload.remote), 'upstream');
    await page.evaluate(() => window.__transfer.release()); await dialog.waitFor({ state: 'hidden' });
    await openPull();
    await dialog.getByText('origin/main → main', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Change pull source', exact: true }).click();
    await source.fill('feature/source');
    await dialog.getByRole('button', { name: 'Use upstream source', exact: true }).click();
    await dialog.getByText('origin/main → main', { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.__transfer.configured = false; });
    const snapshotsBefore = await page.evaluate(() => window.__transfer.calls.filter(call => call.method === 'snapshot').length);
    await page.getByTestId('workbench').getByRole('button', { name: 'Refresh current repository status and history', exact: true }).click();
    await page.waitForFunction(count => window.__transfer.calls.filter(call => call.method === 'snapshot').length > count, snapshotsBefore);
    await openPull();
    await dialog.getByText('No upstream source is configured. Select the source for this Pull.', { exact: true }).waitFor();
    assert.equal(await submit.isDisabled(), true, 'No upstream never implies a guessed branch');
    await dialog.getByLabel('Remote', { exact: true }).selectOption('origin');
    await source.fill('main');
    assert.equal(await submit.isEnabled(), true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
  console.log('ALWAYGIT_TRANSFER_UI_TESTS_PASSED');
}
