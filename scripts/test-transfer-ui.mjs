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
        release() { const request = fixture.pending; fixture.pending = undefined; if(request.payload.type==='remote.add')fixture.remotes.push(request.payload.name); reply(request, { snapshot: snapshot() }); },
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
    const pullOpener = page.getByTestId('workbench').getByRole('button', { name: /^Pull/ });
    const pushOpener = page.getByTestId('workbench').getByRole('button', { name: /^Push/ });
    const refresh = async () => {
      const before = await page.evaluate(() => window.__transfer.calls.filter(call => call.method === 'snapshot').length);
      await page.getByTestId('workbench').getByRole('button', { name: 'Refresh current repository status and history', exact: true }).click();
      await page.waitForFunction(count => window.__transfer.calls.filter(call => call.method === 'snapshot').length > count, before);
    };
    const dialog = page.getByRole('dialog', { name: 'Pull', exact: true });
    const submit = dialog.getByRole('button', { name: 'Pull', exact: true });
    await openPull();
    await dialog.getByText('origin/main → main', { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Remote', { exact: true }).count(), 0, 'Default source is summarized, not an empty field');
    assert.equal(await submit.evaluate(element=>element===document.activeElement), true, 'Pull initially focuses confirmation');
    await page.keyboard.press('Tab');
    assert.equal(await dialog.getByRole('button', { name:'Close', exact:true }).evaluate(element=>element===document.activeElement), true, 'Tab wraps within the dialog');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await submit.evaluate(element=>element===document.activeElement), true);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !!window.__transfer.pending);
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__transfer.calls.filter(call=>call.method==='action').length), 1, 'Repeated Enter never duplicates Pull');
    const first = await page.evaluate(() => window.__transfer.pending.payload);
    assert.deepEqual(first, { type: 'pull', strategy: 'ff-only', remote: 'origin', remoteBranch: 'main', expectedHead: 'a'.repeat(40), expectedBranch: 'main' });
    await page.evaluate(() => window.__transfer.release()); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await pullOpener.evaluate(element=>element===document.activeElement), true, 'Completion restores focus to the opener');
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
    assert.equal(await pullOpener.evaluate(element=>element===document.activeElement), true, 'Escape restores focus to the opener');
    await page.evaluate(() => { window.__transfer.configured = false; });
    await refresh();
    await openPull();
    await dialog.getByText('No upstream source is configured. Select the source for this Pull.', { exact: true }).waitFor();
    assert.equal(await submit.isDisabled(), true, 'No upstream never implies a guessed branch');
    assert.equal(await dialog.getByLabel('Remote', { exact:true }).evaluate(element=>element===document.activeElement), true, 'Missing remote receives initial focus');
    await dialog.getByLabel('Remote', { exact: true }).selectOption('origin');
    await source.fill('main');
    assert.equal(await submit.isEnabled(), true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await pushOpener.click();
    const pushDialog = page.getByRole('dialog', { name:'Push', exact:true });
    const pushSubmit = pushDialog.getByRole('button', { name:'Push', exact:true });
    assert.equal(await pushDialog.locator('button[type=submit]').isDisabled(), true);
    assert.equal(await pushDialog.getByLabel('Remote', { exact:true }).evaluate(element=>element===document.activeElement), true, 'Push with unknown target focuses Remote');
    await page.keyboard.press('Escape'); await pushDialog.waitFor({ state:'hidden' });
    await page.evaluate(() => { window.__transfer.configured=true; }); await refresh();
    await pushOpener.click();
    assert.equal(await pushSubmit.evaluate(element=>element===document.activeElement), true, 'Push initially focuses confirmation');
    const beforePush = await page.evaluate(() => window.__transfer.calls.filter(call=>call.method==='action').length);
    await page.keyboard.press('Enter'); await page.waitForFunction(() => !!window.__transfer.pending);
    assert.equal(await pushDialog.locator('button[type=submit]').isDisabled(), true);
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__transfer.calls.filter(call=>call.method==='action').length), beforePush+1, 'Repeated Enter never duplicates Push');
    await page.evaluate(() => window.__transfer.release()); await pushDialog.waitFor({ state:'hidden' });
    assert.equal(await pushOpener.evaluate(element=>element===document.activeElement), true);
    await page.evaluate(() => { window.__transfer.configured=false;window.__transfer.remotes=['origin']; }); await refresh();
    await openPull();
    assert.equal(await source.evaluate(element=>element===document.activeElement), true, 'With one remote, the missing source branch receives initial focus');
    await page.keyboard.press('Enter'); assert.equal(await submit.isDisabled(), true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state:'hidden' });
    await page.evaluate(() => { window.__transfer.remotes=[]; }); await refresh();
    for (const type of ['Push','Pull']) {
      await (type==='Push'?pushOpener:pullOpener).click();
      const current = page.getByRole('dialog', { name:type, exact:true });
      const addRemote = current.getByRole('button', { name:'Add Remote…', exact:true });
      assert.equal(await addRemote.evaluate(element=>element===document.activeElement), true, type+': missing remote focuses Add Remote');
      await page.keyboard.press('Escape'); await current.waitFor({ state:'hidden' });
    }
    await openPull(); await page.keyboard.press('Enter');
    const addDialog = page.getByRole('dialog', { name:'Add Remote', exact:true });
    await addDialog.getByLabel('Repository URL', { exact:true }).fill('https://example.com/acme/repo.git');
    await addDialog.getByRole('button', { name:'Add Remote', exact:true }).click();
    await page.waitForFunction(() => !!window.__transfer.pending);
    await page.evaluate(() => window.__transfer.release()); await dialog.waitFor();
    assert.equal(await source.evaluate(element=>element===document.activeElement), true, 'Adding a remote returns to Pull and focuses the missing branch');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state:'hidden' });
    await page.evaluate(() => { window.__transfer.branch=''; }); await refresh();
    await openPull();
    await dialog.getByRole('alert').getByText('Switch to a local branch before pulling.', { exact:true }).waitFor();
    assert.equal(await submit.isDisabled(), true);
    assert.equal(await dialog.getByRole('button', { name:'Cancel', exact:true }).evaluate(element=>element===document.activeElement), true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state:'hidden' });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
  console.log('ALWAYGIT_TRANSFER_UI_TESTS_PASSED');
}
