import assert from 'node:assert/strict';

export async function verifyStash(browser,url){
  const page=await browser.newPage({viewport:{width:1200,height:800}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(url);await page.getByRole('option',{name:/^AlwayGit/}).click();
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
    assert.deepEqual(errors,[]);console.log('ALWAYGIT_STASH_UI_TESTS_PASSED: saved summary, category navigation, safe repeated-restore explanation and recovery actions');
  }finally{await page.close();}
}
