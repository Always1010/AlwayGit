import assert from 'node:assert/strict';

export async function verifyCherryPick(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const oid = value => value.toString(16).padStart(40, '0');
      const repo = { id: 'cherry', root: '/fixture', commonDir: '/fixture/.git', name: 'Cherry fixture' };
      const commits = [
        { oid: oid(1), parents: [oid(2)], subject: 'Current HEAD' },
        { oid: oid(2), parents: [], subject: 'Historical commit' },
        { oid: oid(3), parents: [oid(2)], subject: 'Topic commit' },
      ].map(commit => ({ ...commit, author: 'Fixture', email: 'fixture@example.com', timestamp: 0 }));
      const snapshot = { repository: repo, branch: 'main', head: oid(1), ahead: 0, behind: 0, changes: [], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: oid(1) }], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 };
      const fixture = window.__cherryFixture = { actions: [], checks: [], pending: [], fail: false };
      fixture.flush = () => { for (const response of fixture.pending.splice(0)) window.postMessage(response, '*'); };
      fixture.changeBranch = branch => { snapshot.branch = branch; snapshot.version++; window.postMessage({ type: 'changed', repoId: repo.id, snapshot }, '*'); };
      window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage(request) {
        let result;
        if (request.method === 'repositories') result = [repo];
        if (request.method === 'snapshot') result = snapshot;
        if (request.method === 'history') result = { commits, tips: [oid(1), oid(3)], nextOffset: 3, hasMore: false };
        if (request.method === 'details') { const commit = commits.find(commit => commit.oid === request.payload.oid); result = { commit, body: commit?.subject, files: [] }; }
        if (request.method === 'cherryPickCheck') {
          fixture.checks.push(request.payload);
          fixture.pending.push({ type: 'response', id: request.id, ...(fixture.fail ? { error: { message: 'Fixture ancestry failure', code: 'GIT_ERROR' } } : { result: { head: snapshot.head, branch: snapshot.branch, included: request.payload.commits.filter(oid => oid === commits[1].oid) } }) });
          return;
        }
        if (request.method === 'action') fixture.actions.push(request.payload);
        queueMicrotask(() => window.postMessage({ type: 'response', id: request.id, result }, '*'));
      } });
    });
    await page.goto(url);
    await page.getByRole('option', { name: 'Cherry fixture', exact: true }).dblclick();
    const rows = page.getByTestId('history').locator('[data-oid]'), menu = page.getByTestId('context-menu');
    const cherry = () => menu.getByRole('menuitem', { name: 'Cherry-pick to main', exact: true });
    const reapply = () => menu.getByRole('menuitem', { name: 'Reapply Historical Commits…', exact: true });
    const flush = () => page.evaluate(() => window.__cherryFixture.flush());
    const open = async index => { await rows.nth(index).click(); await rows.nth(index).click({ button: 'right' }); await menu.waitFor(); };
    await open(0);
    assert.equal(await cherry().isDisabled(), true);
    assert.equal(await cherry().getAttribute('title'), 'This commit is the current branch HEAD.');
    assert.equal(await reapply().count(), 0);
    await page.keyboard.press('Escape');

    await open(1);
    await page.waitForFunction(() => window.__cherryFixture.checks.length === 1);
    assert.equal(await cherry().isDisabled(), true);
    assert.match(await cherry().getAttribute('title'), /Checking/);
    await flush();
    await reapply().waitFor();
    assert.equal(await cherry().isDisabled(), true);
    await reapply().click();
    const dialog = page.getByRole('dialog'), submit = dialog.getByRole('button', { name: 'Reapply Historical Commits…', exact: true });
    const confirmation = dialog.getByRole('checkbox');
    assert.equal(await submit.isDisabled(), true);
    await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(await page.evaluate(() => window.__cherryFixture.actions.length), 0);
    await confirmation.check();
    assert.equal(await submit.isEnabled(), true);
    await dialog.getByLabel('Commit IDs', { exact: true }).fill('2'.repeat(40));
    assert.equal(await confirmation.isChecked(), false);
    assert.equal(await submit.isDisabled(), true);
    await dialog.getByLabel('Commit IDs', { exact: true }).fill('2'.padStart(40, '0'));
    await confirmation.check();
    await page.evaluate(() => window.__cherryFixture.changeBranch('other'));
    await page.getByTestId('current-branch').getByText('other', { exact: true }).waitFor();
    await submit.click();
    await dialog.waitFor({ state: 'hidden' });
    const actions = await page.evaluate(() => window.__cherryFixture.actions);
    assert.deepEqual(actions[0], { type: 'cherry-pick', commits: ['2'.padStart(40, '0')], mainline: undefined, expectedHead: '1'.padStart(40, '0'), expectedBranch: 'main', allowIncluded: true });
    await page.evaluate(() => window.__cherryFixture.changeBranch('main'));
    await page.getByTestId('current-branch').getByText('main', { exact: true }).waitFor();

    await open(1);
    await page.waitForFunction(() => window.__cherryFixture.pending.length > 0);
    await page.keyboard.press('Escape');
    await open(2);
    await page.waitForFunction(() => window.__cherryFixture.checks.at(-1)?.commits[0] === '3'.padStart(40, '0'));
    assert.equal(await cherry().isDisabled(), true);
    await flush();
    await page.waitForFunction(() => !document.querySelector('[role="menuitem"][title*="Checking"]'));
    assert.equal(await cherry().isEnabled(), true, 'A cancelled historical check must not disable an unrelated selection');
    assert.equal(await reapply().count(), 0);
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__cherryFixture.fail = true; });
    await open(1);
    await page.waitForFunction(() => window.__cherryFixture.pending.length > 0);
    await flush();
    await page.waitForFunction(() => document.querySelector('[role="menuitem"][title*="Could not check"]'));
    assert.equal(await cherry().isDisabled(), true);
    assert.equal(await reapply().count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}
