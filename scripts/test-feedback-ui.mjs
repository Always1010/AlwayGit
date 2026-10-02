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
        pending: undefined, calls: [], cleanReview: false,
        snapshot: { repository: repo, branch: 'main', head: commit.oid, ahead: 1, behind: 0, pushTarget: { localBranch: 'main', remote: 'origin', remoteBranch: 'release', configured: true }, remotes: ['origin'], changes: [], refs: [{ name: 'main', fullName: 'refs/heads/main', kind: 'local', oid: commit.oid }], stashes: [], worktrees: [], operation: { conflicts: 0, canContinue: false, canAbort: false, canSkip: false }, version: 0 },
        complete(error) { window.postMessage({ type: 'response', id: this.pending.id, result: error ? undefined : structuredClone({ ...this.snapshot, version: ++this.snapshot.version }), error: error ? { message: error } : undefined }, '*'); this.pending = undefined; },
      };
      window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage(request) {
        if (request.method === 'saveSession') { setTimeout(() => window.postMessage({ type: 'response', id: request.id, result: null }, '*'), 0); return; }
        fixture.calls.push(request);
        if (request.method === 'action') { fixture.pending = request; return; }
        let result;
        if (request.method === 'repositories') result = [repo];
        if (request.method === 'snapshot') result = structuredClone({ ...fixture.snapshot, version: ++fixture.snapshot.version });
        if (request.method === 'operationReview') result = {kind:fixture.snapshot.operation.kind,token:'reviewed-index',files:fixture.snapshot.changes.filter(file=>!file.conflict&&file.indexStatus!==' ').map(file=>({path:file.path,lines:fixture.cleanReview?[]:[1,3,5]}))};
        if (request.method === 'history') result = { commits: [commit], tips: [commit.oid], nextOffset: 1, hasMore: false };
        if (request.method === 'details') result = { commit, body: '', files: [] };
        if (request.method === 'diffPreview') result = { path: request.payload.path, leftLabel: request.payload.area==='staged'?'HEAD':'Ours', rightLabel: request.payload.area==='staged'?'Index':'Theirs', left: 'before', right: request.payload.area==='staged'&&!fixture.cleanReview?'<<<<<<< HEAD\nmain-ready\n=======\nfeature-ready\n>>>>>>> feature/release':'feature-ready' };
        setTimeout(() => window.postMessage({ type: 'response', id: request.id, result }, '*'), 10);
      } });
    });
    await page.goto(url);
    await page.getByRole('option', { name: 'Feedback fixture' }).dblclick();
    const bar = page.getByTestId('action-feedback');
    for (const [kind, title] of [['merge', 'Merge'], ['rebase', 'Rebase'], ['reset', 'Reset']]) {
      await page.getByTestId('history').locator('[data-oid]').first().click({ button: 'right' });
      await page.getByRole('menuitem', { name: `${title}…`, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: title, exact: true });
      await dialog.getByText(`HEAD: ${'a'.repeat(40)}`, { exact: false }).waitFor();
      await page.evaluate(() => { const fixture = window.__feedbackFixture; fixture.snapshot.branch = 'other-confirmation'; fixture.snapshot.head = 'b'.repeat(40); window.postMessage({ type: 'changed', repoId: 'feedback' }, '*'); });
      await page.waitForFunction(() => document.querySelector('.toolbar')?.textContent.includes('other-confirmation'));
      assert.match(await dialog.innerText(), /main/);
      assert.equal((await dialog.innerText()).includes('other-confirmation'), false);
      await dialog.getByRole('button', { name: title, exact: true }).click();
      await page.waitForFunction(kind => window.__feedbackFixture.pending?.payload.type === kind, kind);
      const payload = await page.evaluate(() => window.__feedbackFixture.pending.payload);
      assert.equal(payload.expectedBranch, 'main'); assert.equal(payload.expectedHead, 'a'.repeat(40));
      await page.evaluate(() => { const fixture = window.__feedbackFixture; fixture.snapshot.branch = 'main'; fixture.snapshot.head = 'a'.repeat(40); fixture.complete('The confirmed branch changed. Refresh and reopen the dialog.'); });
      await bar.getByText(`${title} failed`, { exact: true }).waitFor();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await bar.getByRole('button', { name: 'Dismiss notification' }).click();
      await page.waitForFunction(() => !document.querySelector('.toolbar')?.textContent.includes('other-confirmation'));
    }
    await page.evaluate(()=>{const fixture=window.__feedbackFixture;fixture.snapshot.changes=[{path:'notes.txt',indexStatus:'?',worktreeStatus:'?',conflict:false,untracked:true}];window.postMessage({type:'changed',repoId:'feedback'},'*');});
    await page.locator('.toolbar').getByRole('button',{name:'Stash All Changes…',exact:true}).click();
    await page.getByRole('dialog',{name:'Stash All Changes',exact:true}).getByRole('button',{name:'Stash All Changes',exact:true}).click();
    await page.waitForFunction(()=>window.__feedbackFixture.pending?.payload.type==='stash.create');
    await page.evaluate(()=>{const fixture=window.__feedbackFixture;fixture.snapshot.stashes=[{selector:'stash@{0}',oid:'c'.repeat(40),subject:'pause notes'}];fixture.snapshot.changes=[];fixture.complete();});
    await bar.getByText('1 file saved · 1 untracked · Working tree clean',{exact:true}).waitFor();await bar.getByRole('button',{name:'Dismiss notification'}).click();
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
    await page.getByTestId('history').locator('[data-oid]').first().click({button:'right'});
    await page.getByRole('menuitem',{name:'Merge…',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Merge',exact:true}).click();
    await page.waitForFunction(()=>window.__feedbackFixture.pending?.payload.type==='merge');
    await page.evaluate(() => {
      const fixture = window.__feedbackFixture;
      fixture.snapshot.operation = { kind: 'merge', conflicts: 2, canContinue: false, canAbort: true, canSkip: false, originalHead:'a'.repeat(40) };
      fixture.snapshot.changes = ['src/features/auth/login.ts', 'webview/Details.tsx'].map(path => ({ path, indexStatus: 'U', worktreeStatus: 'U', conflict: true, untracked: false }));
      fixture.complete('CONFLICT: edit and stage the result');
    });
    const paused=page.getByRole('dialog',{name:'merge paused',exact:true});
    await paused.waitFor();
    assert.equal(await paused.getByRole('button',{name:'Merge',exact:true}).count(),0);
    assert.equal(await paused.getByRole('button',{name:'Cancel',exact:true}).count(),0);
    await paused.getByRole('button',{name:'Abort merge…',exact:true}).waitFor();
    await paused.getByRole('button',{name:'Close This Window',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.__feedbackFixture.calls.filter(call=>call.payload?.type==='operation.abort').length),0);
    const operation = page.getByTestId('operation-notice');
    await operation.getByText('Merge paused', { exact: true }).waitFor();
    await operation.getByText('2 conflicts', { exact: true }).waitFor();
    assert.equal(await operation.getByRole('button', { name: 'Continue', exact: true }).isDisabled(), true);
    await operation.getByText('Resolve and Stage conflicting files before Continue.', { exact: true }).waitFor();
    await operation.getByRole('button', { name: 'View Conflicts', exact: true }).click();
    await page.waitForFunction(() => window.__feedbackFixture.calls.some(call => call.method === 'diffPreview' && call.payload.area === 'conflict' && call.payload.path === 'src/features/auth/login.ts'));
    await page.getByTestId('details').locator('.change-group').first().getByText('./src/features/auth', { exact: true }).waitFor();
    await operation.getByRole('button', { name: 'Abort Merge…', exact: true }).click();
    await page.getByRole('dialog').getByText('a'.repeat(40),{exact:true}).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    const conflictGroup=page.getByTestId('details').locator('.change-group').first();
    await conflictGroup.getByText('This does not choose the correct content or verify your resolution.',{exact:false}).waitFor();
    await conflictGroup.getByRole('button',{name:/Manually handled: Mark & Stage/}).click();
    await page.waitForFunction(()=>window.__feedbackFixture.pending?.payload.type==='resolve-and-stage');
    await page.evaluate(() => {
      const fixture = window.__feedbackFixture;
      fixture.snapshot.operation = { kind: 'merge', conflicts: 0, canContinue: true, canAbort: true, canSkip: false };
      fixture.snapshot.changes = fixture.snapshot.changes.map(file => ({ ...file, indexStatus: 'M', worktreeStatus: ' ', conflict: false }));
      fixture.complete();
    });
    await operation.getByText('Awaiting result review', { exact: true }).waitFor();
    assert.equal(await operation.getByText('Conflicts resolved.',{exact:false}).count(),0);
    await bar.getByText('Marked and staged; inspect the result before continuing.',{exact:true}).waitFor();
    await operation.getByRole('button',{name:'Review Staged Result',exact:true}).waitFor();
    assert.equal(await operation.getByRole('button', { name: 'Continue', exact: true }).isEnabled(), true);
    await operation.getByRole('button', { name: 'Continue', exact: true }).click();
    let review=page.getByRole('dialog',{name:'Inspect Staged Result',exact:true});
    await review.getByText('Possible markers at lines: 1, 3, 5',{exact:true}).first().waitFor();
    assert.equal(await review.getByRole('button',{name:'Continue Anyway',exact:true}).isDisabled(),true);
    assert.equal(await page.evaluate(()=>window.__feedbackFixture.pending),undefined);
    await review.getByRole('button',{name:'Return to Review',exact:true}).click();
    await page.waitForFunction(()=>window.__feedbackFixture.calls.some(call=>call.method==='diffPreview'&&call.payload.area==='staged'));
    await operation.getByRole('button',{name:'Continue',exact:true}).click();
    review=page.getByRole('dialog',{name:'Inspect Staged Result',exact:true});
    await review.getByRole('checkbox').check();
    await review.getByRole('button',{name:'Continue Anyway',exact:true}).click();
    await page.waitForFunction(() => window.__feedbackFixture.pending?.payload.type === 'operation.continue');
    assert.equal(await page.evaluate(()=>window.__feedbackFixture.pending.payload.reviewToken),'reviewed-index');
    await page.evaluate(() => { window.__feedbackFixture.snapshot.operation = { conflicts: 0, canContinue: false, canSkip: false, canAbort: false }; window.__feedbackFixture.complete(); });
    await operation.waitFor({ state: 'hidden' });
    // Ordinary Commit during an active operation uses the same review boundary.
    await page.evaluate(()=>{const fixture=window.__feedbackFixture;fixture.cleanReview=true;fixture.snapshot.operation={kind:'merge',conflicts:0,canContinue:true,canAbort:true,canSkip:false};window.postMessage({type:'changed',repoId:'feedback'},'*');});
    await operation.waitFor();
    await page.getByLabel('Commit message',{exact:true}).fill('Reviewed merge');
    await page.locator('.commit-form').getByRole('button',{name:'Commit',exact:true}).click();
    review=page.getByRole('dialog',{name:'Inspect Staged Result',exact:true});
    await review.getByText('This does not verify content correctness.',{exact:false}).waitFor();
    assert.equal(await review.getByRole('checkbox').count(),0);
    await review.getByRole('button',{name:'Confirm & Continue',exact:true}).click();
    await page.waitForFunction(()=>window.__feedbackFixture.pending?.payload.type==='commit');
    await page.evaluate(()=>{const fixture=window.__feedbackFixture;fixture.snapshot.head='b'.repeat(40);fixture.snapshot.operation={conflicts:0,canContinue:false,canAbort:false,canSkip:false};fixture.snapshot.changes=[{path:'notes.txt',indexStatus:'?',worktreeStatus:'?',conflict:false,untracked:true}];fixture.complete();});
    await page.waitForFunction(()=>document.querySelector('#ag-commit-message').value==='');
    await bar.getByText(`Commit ${'b'.repeat(8)} created`,{exact:true}).waitFor();
    await bar.getByText('2 files committed · 1 change remaining',{exact:true}).waitFor();
    await bar.getByRole('button',{name:'View Commit',exact:true}).click();
    await page.waitForFunction(()=>window.__feedbackFixture.calls.some(call=>call.method==='details'&&call.payload.oid==='b'.repeat(40)));
    assert.deepEqual(errors, []);
    console.log('ALWAYGIT_FEEDBACK_UI_TESTS_PASSED: feedback, Commit result summary and View Commit, paused Merge exit/abort, manual staging, staged marker review, return, explicit override and Commit guard');
  } finally { await page.close(); }
}
