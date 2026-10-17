import assert from 'node:assert/strict';

export async function verifyBranchComparison(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const base = 'a'.repeat(40), target = 'b'.repeat(40), ancestor = 'c'.repeat(40), newer = 'd'.repeat(40);
      const repo = { id: 'comparison-repo', root: '/comparison', commonDir: '/comparison/.git', name: 'Comparison fixture' };
      const commit = (oid, subject) => ({ oid, parents: [ancestor], author: 'Fixture', email: 'test@example.com', timestamp: 1700000000, subject });
      const fixture = window.__comparisonFixture = { calls: [], base, target, newer, repo, snapshot: { repository: repo, branch: 'main', head: base, ahead: 0, behind: 0, remotes: ['origin'], changes: [{ path: 'working.txt', indexStatus: ' ', worktreeStatus: 'M', untracked: false }], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: base }, { name: 'origin/topic', fullName: 'refs/remotes/origin/topic', kind: 'remote', oid: target }], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 }, session: { version: 2, language: 'en', repoId: repo.id, drafts: { [repo.id]: 'Keep this draft' }, views: { [repo.id]: { search: '', tab: 'changes', fileHistory: { path: 'history.txt' } } } } };
      window.acquireVsCodeApi = () => ({ getState: () => fixture.session, setState: value => { fixture.session = value; }, postMessage(request) {
        fixture.calls.push(structuredClone(request));
        let result;
        if (request.method === 'repositories') result = [repo];
        if (['repositoryCollections', 'repositoryStatuses'].includes(request.method)) result = [];
        if (request.method === 'interfaceSettings') result = { language: 'en' };
        if (request.method === 'operationSettings') result = { scope: 'user' };
        if (request.method === 'snapshot') result = fixture.snapshot;
        if (request.method === 'history') result = { commits: [commit(base, 'Graph selection')], tips: [base], nextOffset: 1, hasMore: false, filePaths: ['history.txt'] };
        if (request.method === 'details' || request.method === 'inspectDetails') result = { commit: commit(request.payload.oid, 'Inspected commit'), body: 'Commit body', parent: ancestor, files: [{ path: 'commit.txt', status: 'M' }] };
        if (['diffPreview', 'isolatedDiffPreview'].includes(request.method)) result = { kind: 'text', path: request.payload.path, leftLabel: 'Before', rightLabel: 'After', left: 'before\n', right: 'after\n' };
        if (request.method === 'branchComparison') {
          const query = request.payload, baseOid = query.baseOid ?? fixture.snapshot.refs.find(ref => ref.fullName === query.baseRef)?.oid ?? base, targetOid = query.targetOid ?? fixture.snapshot.refs.find(ref => ref.fullName === query.targetRef)?.oid ?? target;
          const page = (side, offset = 0) => ({ commits: [commit(offset ? ancestor : side, offset ? 'Second exclusive commit' : 'Exclusive commit')], total: 2, nextOffset: offset + 1, hasMore: offset === 0 });
          result = { baseRef: query.baseRef, targetRef: query.targetRef, baseOid, targetOid, mode: query.mode ?? 'review', mergeBases: [ancestor], mergeBase: ancestor, diffBase: query.mode === 'snapshot' ? baseOid : ancestor, files: [{ path: 'review.txt', status: 'M' }], base: page(baseOid, query.baseOffset), target: page(targetOid, query.targetOffset) };
        }
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 0);
      } });
    });
    await page.goto(url.replace('?demo=1', ''));
    await page.getByTestId('workbench').waitFor();
    const sidebar = page.getByTestId('sidebar');
    await sidebar.getByRole('button', { name: 'Branch origin/topic', exact: true }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Compare with Current Branch', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Compare branches', exact: true });
    await dialog.getByRole('button', { name: /review.txt/ }).waitFor();
    await dialog.getByTestId('diff-preview').getByText('after', { exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Base branch', { exact: true }).inputValue(), 'refs/heads/main');
    assert.equal(await dialog.getByLabel('Target branch', { exact: true }).inputValue(), 'refs/remotes/origin/topic');
    await dialog.getByRole('button', { name: 'Load more', exact: true }).first().click();
    await dialog.getByRole('button', { name: /Second exclusive commit/ }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: /Exclusive commit/ }).count(), 2);
    await page.evaluate(() => { const fixture = window.__comparisonFixture; fixture.snapshot.refs[1].oid = fixture.newer; window.postMessage({ type: 'changed', repoId: fixture.repo.id, snapshot: structuredClone(fixture.snapshot) }, '*'); });
    await dialog.getByText(' · Branch updated · refresh to compare latest', { exact: true }).waitFor();
    await dialog.getByLabel('Comparison mode').selectOption('snapshot');
    await page.waitForFunction(() => window.__comparisonFixture.calls.some(call => call.method === 'branchComparison' && call.payload.mode === 'snapshot'));
    const pinned = await page.evaluate(() => window.__comparisonFixture.calls.filter(call => call.method === 'branchComparison').at(-1).payload);
    assert.equal(pinned.targetOid, 'b'.repeat(40), 'Changing mode retains pinned branch objects');
    await dialog.getByRole('button', { name: 'Refresh pinned revisions', exact: true }).click();
    await page.waitForFunction(() => { const call = window.__comparisonFixture.calls.filter(call => call.method === 'branchComparison').at(-1); return call && !call.payload.targetOid && call.payload.mode === 'snapshot'; });
    await dialog.getByRole('button', { name: /Exclusive commit/ }).first().click();
    await dialog.getByRole('button', { name: /commit.txt/ }).waitFor();
    await dialog.getByRole('button', { name: 'Return to branch changes', exact: true }).click();
    await dialog.getByRole('button', { name: /review.txt/ }).waitFor();
    await dialog.getByRole('button', { name: 'Reverse comparison', exact: true }).click();
    assert.equal(await dialog.getByLabel('Base branch', { exact: true }).inputValue(), 'refs/remotes/origin/topic');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    const state = await page.evaluate(() => ({ session: window.__comparisonFixture.session, writes: window.__comparisonFixture.calls.filter(call => call.method === 'action') }));
    assert.equal(state.session.drafts['comparison-repo'], 'Keep this draft');
    assert.equal(state.session.views['comparison-repo'].fileHistory.path, 'history.txt');
    assert.equal(state.session.views['comparison-repo'].tab, 'changes');
    assert.deepEqual(state.writes, [], 'Comparing and inspecting never checks out or writes Git state');
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_BRANCH_COMPARISON_UI_PASSED: remote menu, pinned revisions, pages, mode, updates, refresh, reverse, inspect and graph/draft isolation');
  } catch (error) { console.error((await page.locator('body').innerText()).slice(-6000)); throw error; } finally { await page.close(); }
}
