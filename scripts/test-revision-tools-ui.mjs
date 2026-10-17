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
}
