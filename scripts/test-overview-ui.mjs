import assert from 'node:assert/strict';

export async function verifyOverview(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const repo = { id: 'main', root: '/repo', commonDir: '/repo/.git', name: 'repo' };
      const trees = Array.from({ length: 5 }, (_, index) => ({ path: index ? `/tree-${index}` : repo.root, branch: index ? `feature-${index}` : 'main', head: 'a'.repeat(40), bare: false, detached: false }));
      const snapshot = { repository: repo, branch: 'main', head: undefined, ahead: 0, behind: 0, changes: [], refs: [], stashes: [], worktrees: trees, operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 1 };
      const fixture = window.__overviewFixture = { calls: [], trees, snapshot, unstaged: {}, held: [], holdPaths: [], holdInventory: false, session: { version: 2, repoId: repo.id, drafts: { main: 'Keep my draft' } }, hold: false };
      window.acquireVsCodeApi = () => ({ getState: () => fixture.session, setState: value => { fixture.session = value; }, postMessage(request) {
        fixture.calls.push(request); let result;
        if (request.method === 'repositories') result = [repo, ...trees.slice(1).map((tree, index) => ({ ...repo, id: `linked-${index+1}`, root: tree.path, name: tree.branch }))];
        if (request.method === 'repositoryCollections') result = [];
        if (request.method === 'snapshot') result = snapshot;
        if (request.method === 'history') result = { commits: [], tips: [], nextOffset: 0, hasMore: false };
        if (request.method === 'terminalList') result = [];
        if (request.method === 'worktreeOverview') {
          result = request.payload.paths ? request.payload.paths.map(path => ({ ...trees.find(tree => tree.path === path), state: path === '/tree-4' ? 'error' : 'ready', staged: 1, unstaged: fixture.unstaged[path] ?? 2, untracked: 3, conflicts: 0, refreshedAt: 1, error: path === '/tree-4' ? 'Permission denied' : undefined })) : trees.map(tree => ({ ...tree, state: 'pending' }));
          if (fixture.hold && request.payload.paths || fixture.holdInventory && !request.payload.paths || request.payload.paths?.some(path => fixture.holdPaths.includes(path))) { fixture.held.push({ request, result }); return; }
        }
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), request.method === 'worktreeOverview' && request.payload.paths ? 120 : 5);
      } });
    });
    await page.goto(url);
    await page.locator('.sidebar .worktree-list').waitFor();
    const calls = () => page.evaluate(() => window.__overviewFixture.calls);
    assert.equal((await calls()).filter(call => call.method === 'worktreeOverview').length, 0);
    await page.getByRole('button', { name: 'Worktree Overview', exact: true }).click();
    const overview = page.getByRole('region', { name: 'Worktree Overview', exact: true });
    await overview.getByText('Permission denied').waitFor();
    assert.equal(await overview.locator('article').count(), 5);
    assert.match(await overview.innerText(), /File counts may overlap/);
    const reads = (await calls()).filter(call => call.method === 'worktreeOverview');
    assert.deepEqual(reads.slice(1).map(call => call.payload.paths.length), [3, 2]);
    const target = overview.getByRole('article', { name: '/tree-2', exact: true });
    await target.getByRole('button', { name: 'Open worktree project window: /tree-2', exact: true }).click();
    assert.deepEqual((await calls()).findLast(call => call.method === 'openWorktree').payload, { path: '/tree-2', newWindow: false, action: 'project' });
    await page.evaluate(() => window.postMessage({ type: 'changed', repoId: 'main', changes: { paths: ['tracked.txt'] } }, '*'));
    await page.waitForFunction(() => window.__overviewFixture.calls.filter(call => call.method === 'worktreeOverview').length === 4);
    assert.deepEqual((await calls()).filter(call => call.method === 'worktreeOverview').at(-1).payload.paths, ['/repo']);
    await page.waitForFunction(() => !document.querySelector('.worktree-overview [role="status"]'));
    // A second worktree invalidation cancels the first read, but must not discard it.
    await page.evaluate(() => { const fixture=window.__overviewFixture; fixture.unstaged['/repo']=7; fixture.holdPaths=['/repo']; window.postMessage({type:'changed',repoId:'main',changes:{paths:['first.txt']}},'*'); });
    await page.waitForFunction(() => window.__overviewFixture.held.some(item=>item.request.payload.paths?.includes('/repo')));
    await page.evaluate(() => { const fixture=window.__overviewFixture; fixture.holdPaths=[]; fixture.unstaged['/tree-1']=9; window.postMessage({type:'changed',repoId:'linked-1',changes:{paths:['second.txt']}},'*'); });
    const mainRow=overview.getByRole('article',{name:'/repo',exact:true}), linkedRow=overview.getByRole('article',{name:'/tree-1',exact:true});
    await page.waitForFunction(() => { const rows=[...document.querySelectorAll('.overview-row')]; return rows.find(row=>row.getAttribute('aria-label')==='/repo')?.textContent.includes('Unstaged: 7') && rows.find(row=>row.getAttribute('aria-label')==='/tree-1')?.textContent.includes('Unstaged: 9'); });
    assert.match(await mainRow.innerText(),/Unstaged: 7/); assert.match(await linkedRow.innerText(),/Unstaged: 9/);
    // An inventory read remains necessary if a later file event interrupts it.
    await page.evaluate(() => { const fixture=window.__overviewFixture; fixture.holdInventory=true; fixture.trees.push({path:'/tree-new',branch:'new',head:'b'.repeat(40),bare:false,detached:false}); fixture.snapshot.version++; window.postMessage({type:'changed',repoId:'main',changes:{paths:[]},snapshot:structuredClone(fixture.snapshot)},'*'); });
    await page.waitForFunction(() => window.__overviewFixture.held.some(item=>!item.request.payload.paths));
    await page.evaluate(() => { const fixture=window.__overviewFixture; fixture.holdInventory=false; fixture.unstaged['/repo']=11; window.postMessage({type:'changed',repoId:'main',changes:{paths:['during-inventory.txt']}},'*'); });
    await overview.getByRole('article',{name:'/tree-new',exact:true}).waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.overview-row')].find(row=>row.getAttribute('aria-label')==='/repo')?.textContent.includes('Unstaged: 11'));
    assert.equal(await overview.locator('article').count(),6);
    await page.evaluate(() => { const fixture=window.__overviewFixture; fixture.trees.splice(fixture.trees.findIndex(tree=>tree.path==='/tree-2'),1); fixture.snapshot.version++; window.postMessage({type:'changed',repoId:'main',changes:{paths:[]},snapshot:structuredClone(fixture.snapshot)},'*'); });
    await target.waitFor({state:'detached'});
    await page.waitForFunction(() => !document.querySelector('.worktree-overview [role="status"]'));
    assert.equal(await overview.locator('article').count(),5);
    await page.setViewportSize({ width: 720, height: 900 });
    assert.equal(await overview.locator('.overview-columns').isVisible(), false);
    await page.evaluate(() => { window.__overviewFixture.hold = true; });
    await overview.getByRole('button', { name: 'Refresh worktree status', exact: true }).click();
    await page.waitForFunction(() => window.__overviewFixture.calls.filter(call => call.method === 'worktreeOverview').at(-1)?.payload.paths?.length === 3);
    await overview.getByRole('button', { name: 'Return to history', exact: true }).click();
    await page.waitForFunction(() => window.__overviewFixture.calls.some(call => call.method === 'cancelQuery'));
    assert.equal(await page.locator('.history-panel').isVisible(), true);
    assert.equal(await page.evaluate(() => window.__overviewFixture.session.drafts.main), 'Keep my draft');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}
