import assert from 'node:assert/strict';
export async function verifyInteractiveRebase(browser,url) {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try {
  await page.goto(url+'&interactiveRebase=1');
  const sidebar=page.getByTestId('sidebar');await sidebar.getByRole('option',{name:/^AlwayGit/}).dblclick();
  await sidebar.getByRole('button',{name:'Branch main',exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Interactive Rebase',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Interactive Rebase',exact:true}),rows=dialog.locator('.rebase-plan li'),execute=dialog.getByRole('button',{name:'Execute reviewed Rebase plan',exact:true});
  await rows.nth(2).waitFor();assert.equal(await rows.count(),3);
  const original=await rows.first().locator('.rebase-commit').innerText();
  await rows.first().getByRole('button',{name:'Move later (Alt+Down)',exact:true}).click();assert.equal(await rows.nth(1).locator('.rebase-commit').innerText(),original);
  await rows.nth(1).getByRole('combobox').focus();await page.keyboard.press('Alt+ArrowUp');assert.equal(await rows.first().locator('.rebase-commit').innerText(),original);
  await rows.first().getByRole('combobox').selectOption('squash');assert.equal(await execute.isDisabled(),true);await rows.first().getByRole('combobox').selectOption('reword');
  await rows.first().getByRole('textbox',{name:'New commit message'}).fill('Reviewed message');
  await rows.nth(1).locator('.rebase-commit').click();await dialog.locator('.revision-files button').first().click();await dialog.locator('.revision-inspector').waitFor();
  await rows.first().dispatchEvent('drop',{dataTransfer:await page.evaluateHandle(()=>{const d=new DataTransfer();d.setData('text/alwaygit-rebase','999999');return d;})});assert.equal(await rows.count(),3);
  const scope=dialog.getByRole('textbox',{name:'First commit (inclusive, full ID)',exact:true});await scope.fill('00a07b11c42d9918a6bc5e4791033ad7e6f202cc');assert.equal(await execute.isDisabled(),true);
  // Demo OIDs use the same deterministic sequence as history; this includes a cached remote commit.
  const published=(0x9a73ed+4*98761).toString(16).padStart(8,'0')+'c42d9918a6bc5e4791033ad7e6f202cc';
  await scope.fill(published);await dialog.getByRole('button',{name:'Load scope and reset plan',exact:true}).click();await rows.nth(4).waitFor();assert.equal(await execute.isDisabled(),true);
  await dialog.getByRole('checkbox').check();assert.equal(await execute.isEnabled(),true);
  await execute.click();await dialog.getByRole('status').filter({hasText:'Rebase completed'}).waitFor();await dialog.getByRole('status').locator('code').waitFor();assert.match(await dialog.getByRole('status').innerText(),/refs\/alwaygit\/rebase-backups\//);
  assert.deepEqual(errors,[]);
 }finally{await page.close();}
}
