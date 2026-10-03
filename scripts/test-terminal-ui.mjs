import assert from 'node:assert/strict';

export async function verifyTerminalDock(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url);
    await page.getByTestId('sidebar').getByRole('option', { name: /^AlwayGit/ }).dblclick();
    const dock = page.getByTestId('bottom-dock'), newTerminal = dock.getByRole('button', { name: 'New embedded terminal', exact: true });
    await newTerminal.click();
    const input = dock.locator('.terminal-content:not([hidden]) textarea');
    await input.waitFor(); await input.focus(); await input.pressSequentially('rfptest');
    await page.waitForFunction(() => [...document.querySelectorAll('.terminal-content:not([hidden]) .xterm-rows')].some(row => row.textContent.includes('rfptest')));
    assert.equal(await page.getByRole('dialog').count(), 0, 'Terminal characters must not invoke Git shortcuts');
    await newTerminal.click(); await dock.getByRole('tab', { name: 'PowerShell 2', exact: true }).waitFor();
    assert.equal(await dock.getByRole('tab').count(), 3);
    await dock.getByRole('button', { name: 'Rename terminal', exact: true }).click();
    await page.getByRole('textbox', { name: 'Rename terminal' }).fill('dev server');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await dock.getByRole('tab', { name: 'dev server', exact: true }).waitFor();
    const cwd = await dock.locator('.terminal-content:not([hidden]) .pane-heading .truncate').innerText();
    await page.getByTestId('sidebar').getByRole('option', { name: /^website/ }).dblclick();
    assert.equal(await dock.locator('.terminal-content:not([hidden]) .pane-heading .truncate').innerText(), cwd, 'Repository switches keep existing terminal directories');
    await dock.getByRole('button', { name: 'Collapse bottom panel', exact: true }).click();
    assert.ok((await dock.boundingBox()).height <= 32);
    assert.equal(await dock.getByRole('tab').count(), 3);
    await dock.getByRole('button', { name: 'Expand bottom panel', exact: true }).click();
    assert.equal(await dock.getByRole('button', { name: 'End shell process', exact: true }).count(), 0);
    // Simulate a natural host exit: a running terminal no longer has a stop button.
    const sessionId = await dock.getByRole('tab', { name: 'dev server', exact: true }).getAttribute('data-tab-id');
    await page.evaluate(({ id, cwd }) => window.postMessage({ type: 'terminalUpdated', session: { id, cwd, repoId: 'website', shell: 'default', title: 'dev server', status: 'exited', exitCode: 0 } }, '*'), { id: sessionId, cwd });
    await dock.getByText('Exited (0)', { exact: true }).waitFor();
    await dock.getByRole('button', { name: 'Restart terminal', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.terminal-content:not([hidden]) [role="status"]'));
    assert.equal(await dock.getByRole('button', { name: 'Restart terminal', exact: true }).count(), 0);
    assert.equal(await dock.getByRole('tab').count(), 3);
    await dock.getByRole('button', { name: 'Maximize bottom panel', exact: true }).click();
    assert.ok((await dock.boundingBox()).height > 850);
    await dock.getByRole('button', { name: 'Restore bottom panel', exact: true }).click();
    await page.getByTestId('details').getByRole('button', { name: /webview\/App.tsx/ }).first().click();
    assert.equal(await dock.getByRole('tab', { name: /^Diff/ }).getAttribute('aria-selected'), 'true');
    await dock.getByRole('tab', { name: 'dev server', exact: true }).click();
    await dock.getByRole('button', { name: 'All tabs', exact: true }).click();
    await page.getByRole('menuitem', { name: /PowerShell 1/ }).click();
    assert.equal(await dock.getByRole('tab', { name: 'PowerShell 1', exact: true }).getAttribute('aria-selected'), 'true');
    await dock.locator('.dock-tab-wrap:has(.dock-tab-close)').first().getByRole('button', { name: 'Close terminal and end its shell' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.dock-tab-close').length === 1);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}
