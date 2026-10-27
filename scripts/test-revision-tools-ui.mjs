import assert from 'node:assert/strict';
export async function verifyReflog(browser,url) {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  try {
    await page.goto(url);
    await page.getByTestId('sidebar').getByRole('option',{name:/^AlwayGit/}).dblclick();
    await page.getByRole('button',{name:'More actions',exact:true}).click();
    await page.getByRole('menuitem',{name:'Open Reflog',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Reflog and recovery'});
    await dialog.getByRole('button',{name:/commit:/}).first().click();
    await dialog.getByText('Changed files',{exact:true}).count();
    await dialog.locator('.revision-files button').first().click();
    await dialog.getByRole('textbox',{name:'Recovery branch name',exact:true}).fill('recovery/ui-test');
    await dialog.getByRole('button',{name:'Create recovery branch',exact:true}).click();
    await dialog.getByRole('status').filter({hasText:'Recovery branch created'}).waitFor();
    assert.equal(await page.getByTestId('current-branch').textContent(),'main');
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'detached'});
    assert.equal(await page.getByTestId('current-branch').textContent(),'main');
  } finally {await page.close();}
  await verifyInspectionIsolation(browser,url);
}

async function verifyInspectionIsolation(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const repo = { id: 'revision-fixture', root: '/revision', commonDir: '/revision/.git', name: 'Revision fixture' };
      const first = 'a'.repeat(40), second = 'b'.repeat(40), inspected = 'c'.repeat(40);
      const commit = { oid: inspected, parents: [first], author: 'Fixture', email: 'test@example.com', timestamp: 1700000000, subject: 'Inspected revision' };
      const fixture = window.__revisionFixture = { calls: [], held: [], holdReflog: false, openFailure: false, session: { version: 2, repoId: repo.id, language: 'en', singleKeyShortcuts: true, drafts: { [repo.id]: 'Keep my draft' } }, snapshot: { repository: repo, branch: 'main', head: first, ahead: 0, behind: 0, changes: [{path:'working.txt',indexStatus:' ',worktreeStatus:'M',conflict:false,untracked:false}], refs: [{name:'main',fullName:'refs/heads/main',kind:'local',oid:first},{name:'other',fullName:'refs/heads/other',kind:'local',oid:second}], stashes: [], worktrees: [], operation: {conflicts:0,canContinue:false,canAbort:false,canSkip:false}, version: 1 } };
      window.acquireVsCodeApi = () => ({ getState: () => fixture.session, setState: value => { fixture.session = value; }, postMessage(request) {
        fixture.calls.push(structuredClone(request)); let result;
        if (request.method === 'repositories') result = [repo];
        if (['repositoryCollections','repositoryStatuses','terminalList'].includes(request.method)) result = [];
        if (request.method === 'interfaceSettings') result = {language:'en',singleKeyShortcuts:true};
        if (request.method === 'operationSettings') result = {scope:'user'};
        if (request.method === 'snapshot') result = fixture.snapshot;
        if (request.method === 'history') result = { commits:[commit],tips:[first],nextOffset:1,hasMore:false };
        if (request.method === 'inspectDetails') result = {commit,body:'Read this immutable revision.',parent:first,files:[{path:'revision.txt',status:'M'}]};
        if (request.method === 'reflog') {
          result = {token:'11111111-1111-4111-8111-111111111111',ref:request.payload.ref,entries:[{oid:inspected,selector:'HEAD@{0}',description:'commit: inspect fixture',actor:'Fixture',email:'test@example.com'}],recoveries:[],nextOffset:1,hasMore:false,truncated:false,checkedAt:1700000000000};
          if (fixture.holdReflog) {fixture.held.push({id:request.id,result});return;}
        }
        if (request.method === 'diffPreview') result = {kind:'text',path:'working.txt',leftLabel:'Index',rightLabel:'Working Tree',left:'before\n',right:'after\n'};
        if (request.method === 'isolatedDiffPreview') {
          const left = Array.from({length:600},(_,index)=>`line-${index}`), right = left.map((value,index)=>index===10||index===599?value+'-after':value);
          result = {kind:'text',path:'revision.txt',leftLabel:'Parent',rightLabel:'Commit',left:left.join('\n'),right:right.join('\n')};
        }
        const error = request.method==='openFile' && fixture.openFailure ? {message:'Current working file is missing'} : undefined;
        setTimeout(() => window.postMessage({type:'response',id:request.id,result,error},'*'),0);
      }});
    });
    await page.goto(url.replace('?demo=1',''));
    await page.getByTestId('details').getByRole('button',{name:'working.txt',exact:true}).click();
    const mainDiff = page.getByTestId('diff-preview');
    await mainDiff.getByText('after',{exact:true}).waitFor();
    const open = async () => { await page.getByRole('button',{name:'More actions',exact:true}).click(); await page.getByRole('menuitem',{name:'Open Reflog',exact:true}).click(); return page.getByRole('dialog',{name:'Reflog and recovery',exact:true}); };
    let dialog = await open();
    await dialog.locator('.revision-files button').first().waitFor();
    const viewport = dialog.locator('.diff-viewport');
    await dialog.getByTestId('diff-preview').getByText('line-10-after',{exact:true}).waitFor();
    const bounds = await viewport.evaluate(element => ({height:element.clientHeight,scroll:element.scrollHeight,host:element.closest('.revision-preview').clientHeight}));
    assert.ok(bounds.height>0 && bounds.height<=bounds.host && bounds.scroll>bounds.height, 'Revision Diff must have a bounded, scrollable viewport');
    await viewport.evaluate(element => {element.scrollTop=element.scrollHeight;});
    await dialog.getByTestId('diff-preview').getByText('line-599-after',{exact:true}).waitFor();
    await dialog.getByTestId('diff-preview').getByRole('button',{name:'Open Diff',exact:true}).click();
    await page.waitForFunction(() => window.__revisionFixture.calls.some(call=>call.method==='diff' && call.payload.kind==='commit'));
    await dialog.getByTestId('diff-preview').getByRole('button',{name:'Open File in VS Code',exact:true}).click();
    await page.waitForFunction(() => window.__revisionFixture.calls.some(call=>call.method==='openFile' && call.repoId==='revision-fixture' && call.payload.path==='revision.txt'));
    assert.equal(await page.evaluate(() => window.__revisionFixture.calls.filter(call=>call.method==='diff').length),1,'Opening an inspected file must not open another Diff');
    await page.evaluate(() => { window.__revisionFixture.openFailure=true; });
    await dialog.getByTestId('diff-preview').getByRole('button',{name:'Open File in VS Code',exact:true}).click();
    const openError=dialog.getByRole('alert').filter({hasText:'Current working file is missing'});
    await openError.waitFor();
    assert.doesNotMatch(await openError.innerText(),/pruned|commit is no longer available/);
    assert.equal(await page.evaluate(() => window.__revisionFixture.calls.filter(call=>call.method==='diff').length),1);
    await page.evaluate(() => { window.__revisionFixture.openFailure=false; });
    await page.keyboard.press('Escape'); await dialog.waitFor({state:'detached'});
    await page.getByTestId('workbench').focus();
    await page.keyboard.press('d');
    await page.waitForFunction(() => window.__revisionFixture.calls.some(call=>call.method==='diff' && call.payload.kind==='change' && call.payload.path==='working.txt'));
    await page.keyboard.press('e');
    await page.waitForFunction(() => window.__revisionFixture.calls.some(call=>call.method==='openFile' && call.payload.path==='working.txt'));
    // HEAD checkout does not change either branch tip, and must still mark the frozen log stale.
    dialog = await open();
    await dialog.locator('.revision-files button').first().waitFor();
    const hint = dialog.getByRole('status').filter({hasText:'Refresh to load the latest Reflog'});
    await page.evaluate(() => { const fixture=window.__revisionFixture; fixture.snapshot.head='b'.repeat(40);fixture.snapshot.branch='other';fixture.snapshot.version++;window.postMessage({type:'changed',repoId:'revision-fixture',changes:{paths:[]},snapshot:structuredClone(fixture.snapshot)},'*'); });
    await hint.waitFor();
    await dialog.getByRole('button',{name:'Refresh',exact:true}).click();
    await hint.waitFor({state:'detached'});
    await page.waitForFunction(() => document.querySelector('.reflog-list')?.getAttribute('aria-busy')==='false');
    // The fingerprint belongs to read-start, even if HEAD moves before the response arrives.
    await page.evaluate(() => { window.__revisionFixture.holdReflog=true; });
    await dialog.getByRole('button',{name:'Refresh',exact:true}).click();
    await page.waitForFunction(() => window.__revisionFixture.held.length===1);
    await page.evaluate(() => { const fixture=window.__revisionFixture;fixture.snapshot.head='a'.repeat(40);fixture.snapshot.branch='main';fixture.snapshot.version++;window.postMessage({type:'changed',repoId:'revision-fixture',changes:{paths:[]},snapshot:structuredClone(fixture.snapshot)},'*'); });
    await page.waitForFunction(() => document.querySelector('[data-testid="current-branch"]')?.textContent==='main');
    await page.evaluate(() => { const held=window.__revisionFixture.held.shift();window.postMessage({type:'response',...held},'*'); });
    await hint.waitFor();
    assert.equal(await page.evaluate(()=>window.__revisionFixture.session.drafts['revision-fixture']),'Keep my draft');
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
}
