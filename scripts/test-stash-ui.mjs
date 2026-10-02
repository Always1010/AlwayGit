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
    assert.deepEqual(errors,[]);console.log('ALWAYGIT_STASH_UI_TESTS_PASSED: saved summary, category counts, first non-empty selection and direct empty-category jump');
  }finally{await page.close();}
}
