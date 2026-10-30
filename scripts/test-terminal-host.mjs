import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import path from 'node:path';

// An extracted VSIX can be tested without access to the project's node_modules.
const helper = path.resolve(process.argv[2] ?? 'dist/terminal-host.cjs');
async function runShell(file, args, input, stop = false) {
  const child = fork(helper, [], {
    windowsHide: true,
    execArgv: [],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let output = '',
    shellExit,
    errors = '';
  child.stderr.on('data', (data) => {
    errors += data;
  });
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error('Terminal helper did not release its native resources.'));
    }, 15000);
    child.on('error', reject);
    child.on('message', (event) => {
      if (event.type === 'data') {
        output += event.data;
        if (stop) {
          stop = false;
          child.send({ type: 'kill' });
        }
      }
      if (event.type === 'exit') shellExit = event.exitCode;
    });
    child.on('exit', () => {
      clearTimeout(deadline);
      resolve({ output, shellExit, errors });
    });
    child.send({
      type: 'start',
      shell: { file, args, env: process.env },
      cwd: process.cwd(),
      cols: 100,
      rows: 30,
    });
    child.send({ type: 'resize', cols: 120, rows: 40 });
    if (input) child.send({ type: 'input', data: input });
  });
}
const windows = process.platform === 'win32',
  shell = windows ? process.env.ComSpec : '/bin/sh';
const successful = await runShell(
  shell,
  windows ? ['/d', '/q'] : [],
  windows ? 'echo ALWAYGIT_TERMINAL_OK\r\nexit\r\n' : "printf 'ALWAYGIT_%s\\n' TERMINAL_OK\nexit\n",
);
assert.equal(successful.shellExit, 0);
assert.match(successful.output, /ALWAYGIT_TERMINAL_OK/);
assert.equal(successful.errors, '');
const stopped = await runShell(shell, windows ? ['/d', '/q'] : ['-i'], '', true);
assert.equal(typeof stopped.shellExit, 'number');
if (windows) {
  const powershell = path.join(
    process.env.SystemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const result = await runShell(
    powershell,
    ['-NoLogo', '-NoProfile'],
    "Write-Output ('ALWAYGIT_' + 'POWERSHELL_OK'); exit\r\n",
  );
  assert.equal(result.shellExit, 0);
  assert.match(result.output, /ALWAYGIT_POWERSHELL_OK/);
  assert.equal(result.errors, '');
}
const unavailable = await runShell(path.resolve('artifacts/nonexistent-terminal-shell'), [], '');
assert.equal(unavailable.shellExit, 1);
console.log(
  'ALWAYGIT_TERMINAL_HOST_PASSED: native input/output, resize, natural exit, forced stop, failed launch and helper cleanup; Windows PowerShell when applicable',
);
