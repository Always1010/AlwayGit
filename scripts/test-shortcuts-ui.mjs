import assert from 'node:assert/strict';

export async function verifyShortcuts(browser, url) {
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.addInitScript(()=>{
      const repo={id:'keys',root:'/keys',commonDir:'/keys/.git',name:'Shortcut fixture'},other={id:'other',root:'/other',commonDir:'/other/.git',name:'Other repository'};
      const commit={oid:'a'.repeat(40),parents:['b'.repeat(40)],author:'Fixture',email:'test@example.com',timestamp:0,subject:'Shortcut Commit'};
      const older={...commit,oid:'b'.repeat(40),parents:[],subject:'Older Commit'};
      const snapshot={repository:repo,branch:'main',head:commit.oid,ahead:1,behind:0,remotes:['origin'],pushTarget:{localBranch:'main',remote:'origin',remoteBranch:'main',configured:true},
        refs:[{name:'main',fullName:'refs/heads/main',kind:'local',oid:commit.oid}],stashes:[],worktrees:[],operation:{conflicts:0,canContinue:false,canAbort:false,canSkip:false},version:0,
        changes:['a.ts','b.ts'].map(path=>({path,indexStatus:'M',worktreeStatus:'M',conflict:false,untracked:false}))};
      const fixture=window.__shortcutFixture={calls:[],holdAction:false,pending:undefined,snapshot,
        complete(){const request=this.pending;this.pending=undefined;window.postMessage({type:'response',id:request.id,result:structuredClone(snapshot)},'*');}};
      window.acquireVsCodeApi=()=>({
        getState:()=>JSON.parse(localStorage.getItem('shortcut-session')??'{"repoId":"keys"}'),
        setState:value=>localStorage.setItem('shortcut-session',JSON.stringify(value)),
        postMessage(request){
          fixture.calls.push(request);
          if(request.method==='action'&&fixture.holdAction){fixture.pending=request;return;}
          let result;
          if(request.method==='repositories')result=[repo,other];
          if(request.method==='snapshot')result=structuredClone({...snapshot,repository:request.repoId==='other'?other:repo,version:++snapshot.version});
          if(request.method==='history')result={commits:[commit,older],tips:[commit.oid],nextOffset:2,hasMore:false};
          if(request.method==='details')result={commit:request.payload.oid===commit.oid?commit:older,body:'',files:['a.ts','b.ts'].map(path=>({path,status:'M'}))};
          if(request.method==='diffPreview'){
            const left=Array.from({length:32},(_,index)=>`line ${index}`),right=[...left];
            for(const index of request.payload.path==='a.ts'?[4,24]:[12])right[index]+=' changed';
            result={path:request.payload.path,leftLabel:'Before',rightLabel:'After',left:left.join('\n'),right:right.join('\n')};
          }
          if(request.method==='action')result=structuredClone(snapshot);
          setTimeout(()=>window.postMessage({type:'response',id:request.id,result},'*'),0);
        },
      });
    });
    await page.goto(url);
    const root=page.getByTestId('workbench'),history=page.getByTestId('history'),diff=page.getByTestId('diff-preview'),count=diff.getByTestId('diff-change-count');
    await count.getByText('File 1/2 · Change 1/2',{exact:true}).waitFor();
    const calls=()=>page.evaluate(()=>window.__shortcutFixture.calls.filter(call=>call.method==='action').length);
    const dialog=()=>page.getByRole('dialog');
    const press=async key=>{await root.focus();await page.keyboard.press(key);};
    assert.match(await page.locator('.toolbar').getByRole('button',{name:'Fetch',exact:true}).getAttribute('title'),/F$/);
    assert.match(await diff.getByRole('button',{name:'Next change',exact:true}).getAttribute('title'),/\]$/);
    assert.match(await history.locator('[data-working-tree]').getAttribute('title'),/W$/);

    // Sidebar selection must not redirect toolbar shortcuts to an unopened repository.
    await page.getByRole('option',{name:'Other repository',exact:true}).click();
    await page.keyboard.press('f');
    await page.waitForFunction(()=>window.__shortcutFixture.calls.some(call=>call.method==='action'&&call.payload.type==='fetch'));
    assert.equal(await page.evaluate(()=>window.__shortcutFixture.calls.find(call=>call.method==='action').repoId),'keys');
    await page.waitForFunction(()=>!document.querySelector('.toolbar button[title="Fetch · F"]')?.disabled);
    const beforeHeld=await calls();
    await page.evaluate(()=>{window.__shortcutFixture.holdAction=true;});
    await press('f');await page.waitForFunction(()=>!!window.__shortcutFixture.pending);
    await page.keyboard.press('f');
    await root.dispatchEvent('keydown',{key:'f',repeat:true});
    assert.equal(await calls(),beforeHeld+1,'Busy and held keys cannot duplicate a Git action');
    await page.evaluate(()=>{window.__shortcutFixture.holdAction=false;window.__shortcutFixture.complete();});
    await page.waitForFunction(()=>!document.querySelector('.toolbar button[title="Fetch · F"]')?.disabled);

    // A ref badge currently stops bubbling; capture dispatch must still work there.
    await history.locator('.ref-badge').first().focus();await page.keyboard.press('p');
    await dialog().getByText('Push Target',{exact:true}).waitFor();
    const beforeOverlay=await calls();
    await dialog().getByRole('button',{name:'Cancel',exact:true}).focus();
    for(const key of ['f','c','d','p'])await page.keyboard.press(key);
    assert.equal(await calls(),beforeOverlay);assert.equal(await dialog().count(),1);
    await page.keyboard.press('Escape');await dialog().waitFor({state:'hidden'});
    await history.locator('[data-head-commit]').click({button:'right'});await page.getByRole('menu').waitFor();
    await page.keyboard.press('f');assert.equal(await calls(),beforeOverlay,'Context menus own the keyboard');
    await page.keyboard.press('Escape');await page.getByRole('menu').waitFor({state:'hidden'});
    for(const [key,title] of [['l','Pull'],['s','Stash All Changes']]){
      await press(key);await page.getByRole('dialog',{name:title,exact:true}).waitFor();await page.keyboard.press('Escape');
    }
    await press('?');await dialog().waitFor();await page.keyboard.press('Escape');await dialog().waitFor({state:'hidden'});

    // Brackets navigate the existing Commit scope even with sidebar focus or collapsed Diff.
    await page.getByRole('option',{name:'Other repository',exact:true}).focus();await page.keyboard.press(']');
    await count.getByText('File 1/2 · Change 2/2',{exact:true}).waitFor();
    await page.keyboard.press('\\');assert.equal(await diff.locator('.diff-viewport').count(),0);
    await page.keyboard.press(']');await count.getByText('File 2/2 · Change 1/1',{exact:true}).waitFor();
    await diff.locator('.active-change-start').waitFor();
    assert.equal(await diff.locator('.diff-viewport').count(),1);
    await page.keyboard.press('[');await count.getByText('File 1/2 · Change 2/2',{exact:true}).waitFor();
    for(const [key,method] of [['d','diff'],['e','openFile'],['o','openProject']]){
      await press(key);await page.waitForFunction(method=>window.__shortcutFixture.calls.some(call=>call.method===method),method);
    }

    await press('/');const search=page.getByRole('textbox',{name:'Search commit history'});
    await search.fill('');await page.keyboard.type('rfplcswodeau');
    assert.equal(await search.inputValue(),'rfplcswodeau');assert.equal(await dialog().count(),0);assert.equal(await calls(),beforeOverlay);
    await search.press('Control+a');assert.deepEqual(await search.evaluate(element=>[element.selectionStart,element.selectionEnd]),[0,12]);
    await search.fill('');
    // Clicking non-focusable text must release the input before dispatching another key.
    await diff.locator('.pane-heading > .truncate').click();await page.keyboard.press('w');
    await page.getByRole('textbox',{name:'Commit message',exact:true}).waitFor();
    await press('c');const message=page.getByRole('textbox',{name:'Commit message',exact:true});
    await page.waitForFunction(()=>document.activeElement?.id==='ag-commit-message');
    await page.keyboard.type('rfplcswodeau');assert.equal(await message.inputValue(),'rfplcswodeau');assert.equal(await calls(),beforeOverlay);

    // Selectors and editable elements preserve text entry even outside a modal.
    for(const html of ['<select><option>first</option><option>previous</option></select>','<div contenteditable="true"></div>']){
      await root.evaluate((element,html)=>{const holder=document.createElement('div');holder.id='shortcut-editable';holder.innerHTML=html;element.append(holder);holder.firstChild.focus();},html);
      await page.keyboard.press('p');assert.equal(await dialog().count(),0);
      await page.locator('#shortcut-editable').evaluate(element=>element.remove());
    }
    await root.focus();
    await root.dispatchEvent('compositionstart');await page.keyboard.press('f');await root.dispatchEvent('compositionend');
    await root.dispatchEvent('keydown',{key:'f',isComposing:true});await root.dispatchEvent('keydown',{key:'f',keyCode:229});
    assert.equal(await calls(),beforeOverlay,'Composition must never trigger Fetch');

    // All-group shortcuts preserve the existing confirmation and ignore a one-file selection.
    await page.getByTestId('details').getByRole('button',{name:'a.ts',exact:true}).first().click();
    await page.keyboard.press('a');await page.getByRole('dialog',{name:'Stage all 2 files?',exact:true}).waitFor();
    assert.equal(await calls(),beforeOverlay,'Stage requires confirmation');
    await page.keyboard.press('Enter');await dialog().waitFor({state:'hidden'});
    assert.deepEqual(await page.evaluate(()=>window.__shortcutFixture.calls.filter(call=>call.method==='action').at(-1).payload),{type:'stage',paths:['a.ts','b.ts']});
    await press('u');await page.getByRole('dialog',{name:'Unstage all 2 files?',exact:true}).waitFor();await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(()=>window.__shortcutFixture.calls.some(call=>call.method==='action'&&call.payload.type==='commit')),false,'C must never submit a commit');

    await press('h');await history.locator('[data-head-commit][aria-selected="true"]').waitFor();
    await press('r');await page.waitForFunction(()=>!document.querySelector('.toolbar button[aria-label="Refresh current repository status and history"]')?.disabled);
    await press(',');await dialog().getByRole('button',{name:'Keyboard shortcuts',exact:true}).click();
    await dialog().getByRole('checkbox',{name:'Enable single-key shortcuts',exact:true}).uncheck();
    await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
    assert.match(await page.locator('.toolbar').getByRole('button',{name:'Fetch',exact:true}).getAttribute('title'),/F$/,'Cancel restores single keys');
    await press(',');await dialog().getByRole('button',{name:'Keyboard shortcuts',exact:true}).click();
    await dialog().getByRole('checkbox',{name:'Enable single-key shortcuts',exact:true}).uncheck();
    await dialog().getByRole('button',{name:'Apply',exact:true}).click();await dialog().waitFor({state:'hidden'});
    const beforeDisabled=await calls();await press('f');await page.keyboard.press('w');await page.keyboard.press('p');
    assert.equal(await calls(),beforeDisabled);assert.equal(await dialog().count(),0);
    const beforeRefresh=await page.evaluate(()=>window.__shortcutFixture.calls.filter(call=>call.method==='snapshot').length);
    await page.keyboard.press('Control+r');
    await page.waitForFunction(before=>window.__shortcutFixture.calls.filter(call=>call.method==='snapshot').length>before,beforeRefresh);
    await page.reload();await history.locator('[data-head-commit]').waitFor();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('shortcut-session')).singleKeyShortcuts),false);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('shortcut-session')).drafts.keys),'rfplcswodeau','Updating shortcut preferences preserves drafts');
    await press('f');assert.equal(await calls(),0,'Saved disabled preference survives a reload');
    assert.deepEqual(errors,[]);
    console.log('ALWAYGIT_SHORTCUT_UI_TESTS_PASSED: global focus, targets, overlays, IME, repeats, text editing, Diff navigation, confirmations and saved preferences');
  } finally {await page.close();}
}
