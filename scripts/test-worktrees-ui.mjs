import assert from 'node:assert/strict';

/** Old sessions contain separate Worktree IDs; grouping must not lose their state. */
export async function verifyWorktrees(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const main = { id: 'main', root: 'D:/Projects/App', commonDir: 'D:/Projects/App/.git', name: 'App', mainRoot: 'D:/Projects/App' };
      const linked = { ...main, id: 'linked', root: 'D:/Projects/App-feature', name: 'App-feature' };
      const clone = { id: 'clone', root: 'D:/Other/App', commonDir: 'D:/Other/App/.git', name: 'App', mainRoot: 'D:/Other/App' };
      const repositories = [linked, main, clone];
      const session = { version: 2, repoId: linked.id, drafts: { main: 'Main draft', linked: 'Linked draft' }, views: { main: { tab: 'changes', search: '' }, linked: { tab: 'changes', search: '' } } };
      const fixture = window.__worktreeFixture = { session, calls: [], version: 0 };
      window.acquireVsCodeApi = () => ({ getState: () => fixture.session, setState: value => { fixture.session = value; }, postMessage(request) {
        if (request.method === 'saveSession') return;
        fixture.calls.push(request);
        const repo = repositories.find(repo => repo.id === request.repoId) ?? linked;
        const branch = repo.id === linked.id ? 'feature' : 'main';
        const worktrees = repo.id === clone.id ? [] : [{ path: main.root, branch: 'main', head: 'a'.repeat(40), bare: false, detached: false }, { path: linked.root, branch: 'feature', head: 'b'.repeat(40), bare: false, detached: false }];
        let result;
        if (request.method === 'repositories') result = repositories;
        if (request.method === 'snapshot') result = { repository: repo, branch, head: undefined, ahead: 0, behind: 0, changes: [{ path: `${repo.id}.txt`, indexStatus: ' ', worktreeStatus: 'M', untracked: false, conflict: false }], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: 'a'.repeat(40) }, { name: 'feature', fullName: 'refs/heads/feature', kind: 'local', oid: 'b'.repeat(40) }], stashes: [], worktrees, operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: ++fixture.version };
        if (request.method === 'history') result = { commits: [], tips: [], nextOffset: 0, hasMore: false };
        if (request.method === 'diffPreview') result = { path: request.payload.path, leftLabel: 'Index', rightLabel: 'Working Tree', left: 'before', right: repo.id };
        if (request.method === 'openWorktree') {
          const target = repositories.find(repo => repo.root === request.payload.path);
          setTimeout(() => window.postMessage({ type: 'selectRepository', repoId: target.id }, '*'), 5);
        }
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 5);
      } });
    });
    await page.goto(url);
    const groups = page.locator('[data-repository-group]'), draft = page.getByRole('textbox', { name: 'Commit message', exact: true });
    await draft.waitFor();
    assert.equal(await groups.count(), 2, 'Main and linked directory share one entry; a separate clone keeps its own entry');
    const app = groups.filter({ has: page.locator('span.truncate', { hasText: /^App$/ }) }).first();
    assert.equal(await app.innerText(), 'App'); assert.equal(await app.getAttribute('title'), 'D:/Projects/App-feature');
    assert.match(await app.getAttribute('class'), /selected/); assert.equal(await draft.inputValue(), 'Linked draft');
    await app.click(); assert.equal(await draft.inputValue(), 'Linked draft', 'Clicking the selected group keeps its Worktree');
    await app.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Copy Repository Path', exact: true }).click();
    await page.waitForFunction(() => window.__worktreeFixture.calls.some(call => call.method === 'copyText'));
    assert.equal(await page.evaluate(() => window.__worktreeFixture.calls.find(call => call.method === 'copyText').payload.text), 'D:/Projects/App-feature');
    await draft.fill('Edited linked draft');
    await page.getByTestId('sidebar').getByRole('button', { name: 'main · App', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#ag-commit-message')?.value === 'Main draft');
    assert.equal(await groups.count(), 2); assert.equal(await app.getAttribute('title'), 'D:/Projects/App');
    await page.getByTestId('sidebar').getByRole('button', { name: 'feature · App-feature', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#ag-commit-message')?.value === 'Edited linked draft');
    assert.equal(await groups.count(), 2);
    // Refreshing registered paths must not reset the selected Worktree.
    await page.evaluate(() => { window.postMessage({ type: 'repositoriesChanged' }, '*'); });
    await page.waitForTimeout(80);
    assert.equal(await draft.inputValue(), 'Edited linked draft');
    assert.equal(await page.evaluate(() => window.__worktreeFixture.session.repoId), 'linked');
    assert.equal(await page.evaluate(() => window.__worktreeFixture.session.drafts.main), 'Main draft');
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_WORKTREES_UI_TESTS_PASSED: grouped repository entries, legacy active Worktree/drafts, separate clone, current path menu, Worktree switching and repository refresh');
  } finally { await page.close(); }
}
