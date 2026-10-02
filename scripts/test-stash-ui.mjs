import assert from 'node:assert/strict';

export async function verifyStash(browser,url){
  const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url);await page.getByRole('option',{name:/^AlwayGit/}).dblclick();
    const details=page.getByTestId('details'),stash=page.getByTestId('sidebar').getByRole('button').filter({hasText:'stash@{0}'});await stash.click();
    await details.getByText('1 saved file · 1 untracked',{exact:true}).waitFor();
    const tabs=details.getByRole('tablist',{name:'Stash file categories',exact:true}),untracked=tabs.getByRole('tab',{name:'Untracked Files 1',exact:true});await untracked.waitFor();
    assert.equal(await untracked.getAttribute('aria-selected'),'true','A Stash containing only untracked files opens its first non-empty category');
    await details.getByLabel('notes.txt',{exact:true}).waitFor();
    await tabs.getByRole('tab',{name:'Working Tree 0',exact:true}).click();
    await details.getByText('This category has no files; Untracked Files has 1.',{exact:true}).waitFor();
    await details.getByRole('button',{name:'Open Untracked Files',exact:true}).click();await details.getByLabel('notes.txt',{exact:true}).waitFor();
    const menu=page.getByTestId('context-menu');
    const apply=async()=>{await stash.click({button:'right'});await menu.getByRole('menuitem',{name:'Apply Stash',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Apply Stash',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'Apply Stash',exact:true}).click();return dialog;};
    let dialog=await apply();await dialog.waitFor({state:'hidden'});
    dialog=await apply();
    await dialog.getByText('Cannot restore because these files already exist in the project.',{exact:true}).waitFor();
    await dialog.getByText('notes.txt',{exact:true}).waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Apply Stash',exact:true}).count(),0,'A known collision must not offer the same ineffective retry');
    const compare=dialog.getByRole('button',{name:'Compare saved and existing file: notes.txt',exact:true}),open=dialog.getByRole('button',{name:'Open existing file: notes.txt',exact:true});
    for(const action of [compare,open]){assert.equal((await action.innerText()).trim(),'','File recovery actions remain icon-only');assert.equal(await action.locator('.codicon').count(),1,'File recovery actions expose recognizable icons');await action.click();}
    await dialog.getByRole('button',{name:'Cancel and keep current state',exact:true}).click();
    assert.deepEqual(errors,[]);await verifyRestoreDiagnostics(browser,url);console.log('ALWAYGIT_STASH_UI_TESTS_PASSED: saved summary, category navigation, safe repeated restore, underlying diagnostics and confirmed conflict paths');
  }finally{await page.close();}
}

async function verifyRestoreDiagnostics(browser,url){
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.addInitScript(()=>{
      const repo={id:'stash-diagnostics',name:'Stash diagnostics',root:'/diagnostics',commonDir:'/diagnostics/.git'},oid='a'.repeat(40);
      const fixture=window.__stashDiagnostics={calls:[],version:1,blocker:{kind:'stash-apply',reason:'restore-blocked',paths:['notes.txt'],conflictPaths:[],selector:'stash@{0}',stashOid:oid,stashRetained:true,workingTreeUnchanged:true,output:'error: staged-only.txt would be overwritten\nIndex was not unstashed.'}};
      window.acquireVsCodeApi=()=>({getState:()=>({}),setState:()=>{},postMessage(request){
        fixture.calls.push(request);let result,error;
        if(request.method==='repositories')result=[repo];
        if(request.method==='snapshot')result={repository:repo,branch:'main',head:oid,version:++fixture.version,ahead:0,behind:0,changes:[],refs:[],worktrees:[],stashes:[{selector:'stash@{0}',oid,subject:'notes'}],operation:{conflicts:0,canContinue:false,canAbort:false,canSkip:false}};
        if(request.method==='history')result={commits:[],tips:[],nextOffset:0,hasMore:false};
        if(request.method==='action')error={message:'The Stash could not be restored in the isolated trial. The real Index and Working Tree were not changed, and the Stash is still saved.',code:'STASH_RESTORE_BLOCKED',details:structuredClone(fixture.blocker)};
        setTimeout(()=>window.postMessage({type:'response',id:request.id,result,error},'*'),0);
      }});
    });
    await page.goto(url);await page.getByRole('option',{name:'Stash diagnostics',exact:true}).dblclick();
    const open=async()=>{
      await page.getByTestId('sidebar').getByRole('button').filter({hasText:'stash@{0}'}).click({button:'right'});
      await page.getByTestId('context-menu').getByRole('menuitem',{name:'Apply Stash',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Apply Stash',exact:true});
      await dialog.getByRole('button',{name:'Apply Stash',exact:true}).click();return dialog;
    };
    let dialog=await open();
    await dialog.getByText('Restore stopped because preflight could not restore the saved state.',{exact:true}).waitFor();
    await dialog.getByText('Files included in this restore',{exact:true}).waitFor();
    assert.equal(await dialog.getByText('Confirmed conflicting files',{exact:true}).count(),0);
    await dialog.getByText('Git details',{exact:true}).click();
    await dialog.locator('pre').filter({hasText:'Index was not unstashed.'}).waitFor();
    assert.ok((await dialog.locator('pre').innerText()).includes('staged-only.txt'));
    await dialog.getByRole('button',{name:'Cancel and keep current state',exact:true}).click();
    await page.getByTestId('action-feedback').getByRole('button',{name:'Show Log',exact:true}).click();
    await page.waitForFunction(()=>window.__stashDiagnostics.calls.some(call=>call.method==='showLog'));
    await page.evaluate(()=>{Object.assign(window.__stashDiagnostics.blocker,{reason:'restore-conflict',paths:['notes.txt','neighbor.txt'],conflictPaths:['notes.txt'],output:'CONFLICT (content): Merge conflict in notes.txt'});});
    dialog=await open();await dialog.getByText('Confirmed conflicting files',{exact:true}).waitFor();
    assert.equal(await dialog.locator('.stash-conflict-file').count(),1);
    assert.equal(await dialog.locator('.stash-conflict-file code').innerText(),'notes.txt');
    await dialog.getByRole('button',{name:'Cancel and keep current state',exact:true}).click();
    assert.deepEqual(errors,[]);
  }finally{await page.close();}
}
