import { build } from 'esbuild';
import { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const directory = await mkdtemp(path.join(tmpdir(), 'alwaygit-windows-test-'));
const mailbox = path.join(directory, 'mailbox');
const profile = path.join(directory, 'profile');
const extensionDirectory = path.join(directory, 'extensions');
const controller = path.join(directory, 'controller');
const extensionRoot = path.resolve('.');
const children = [];
let processOutput = '';
let sequence = 0, code;
async function read(name) { try { return JSON.parse(await readFile(path.join(mailbox, name), 'utf8')); } catch { return undefined; } }
async function waitFor(label, probe, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await probe(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); }
  const states = await Promise.all(['source', 'target', 'new-project', 'workbench-project'].map(name => read(name + '.state.json')));
  throw new Error(`${label} timed out. States: ${JSON.stringify(states)}\n${processOutput}`);
}
function launch(root) {
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE;
  // Foreground/focus assertions require visible GUI windows, all within the isolated test profile.
  const child = spawn(code, [root, '--new-window', '--user-data-dir', profile, '--shared-data-dir', path.join(directory, 'shared'), '--extensions-dir', extensionDirectory, '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu', '--disable-telemetry'], { windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'], env: environment });
  children.push(child);
  const capture = chunk => { processOutput = (processOutput + chunk.toString()).slice(-12000); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  child.on('error', error => console.error(error.message));
}
async function action(name, data) {
  const id = String(++sequence);
  await writeFile(path.join(mailbox, name + '.action.json'), JSON.stringify({ id, ...data }));
  const result = await waitFor(`${name} action ${data.method ?? data.type}`, async () => { const result = await read(name + '.result.json'); return result?.id === id && result; });
  assert.equal(result.error, undefined, result.error && `${result.error}\n${JSON.stringify(await read('target.state.json'))}\n${JSON.stringify(result.state)}`);
  return result;
}
function tabs(state) { return state.groups.flatMap(group => group.tabs); }
function assertPreserved(state) {
  assert.equal(state.sentinel.dirty, true);
  assert.equal(state.sentinel.closed, false);
  assert.match(state.sentinel.text, /Unsaved changes must survive/);
  assert.ok(tabs(state).some(tab => tab.uri === state.sentinel.uri));
  assert.equal(state.groups.length, 1, 'Opening native editors must not create a side group');
}
try {
  await Promise.all([mkdir(mailbox), mkdir(controller, { recursive: true }), mkdir(path.join(profile, 'User'), { recursive: true })]);
  await writeFile(path.join(profile, 'User', 'settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'git.autofetch': false, 'window.confirmBeforeClose': 'never', 'workbench.startupEditor': 'none', 'extensions.autoUpdate': false, 'telemetry.telemetryLevel': 'off' }));
  await writeFile(path.join(controller, 'package.json'), JSON.stringify({ name: 'window-controller', publisher: 'alwaygit-test', version: '1.0.0', engines: { vscode: '^1.95.0' }, main: './extension.cjs', activationEvents: ['onStartupFinished'] }));
  await writeFile(path.join(controller, 'README.md'), 'Companion extension used only by isolated AlwayGit window integration tests.\n');
  await build({ entryPoints: ['tests/extension/window-controller.ts'], outfile: path.join(controller, 'extension.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'] });
  const roots = {};
  for (const name of ['source', 'target', 'new-project', 'workbench-project']) {
    const root = roots[name] = path.join(directory, name); await mkdir(root);
    const git = (...args) => exec('git', ['-C', root, ...args], { windowsHide: true });
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Window Test'); await git('config', 'user.email', 'windows@example.com'); await git('config', 'commit.gpgsign', 'false');
    await writeFile(path.join(root, 'sample.ts'), 'export const value = 1;\n'); await git('add', '.'); await git('commit', '-m', 'Initial');
    await writeFile(path.join(root, 'sample.ts'), 'export const value = 2;\n'); await git('add', '.');
    await writeFile(path.join(root, 'sample.ts'), 'export const value = 3;\n');
  }
  code = process.env.ALWAYGIT_VSCODE_EXECUTABLE || await downloadAndUnzipVSCode(process.env.ALWAYGIT_VSCODE_VERSION || 'stable');
  // Installed extensions allow multiple ordinary windows; development hosts deliberately reuse one window.
  const pack = async (cwd, output) => exec(process.execPath, [path.join(extensionRoot, 'node_modules/@vscode/vsce/vsce'), 'package', '--allow-missing-repository', '--skip-license', '--no-dependencies', '--no-rewrite-relative-links', '--out', output], { cwd, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  await pack(extensionRoot, path.join(directory, 'alwaygit.vsix'));
  await pack(controller, path.join(directory, 'controller.vsix'));
  const cli = resolveCliPathFromVSCodeExecutablePath(code);
  const cliArguments = ['--user-data-dir', profile, '--shared-data-dir', path.join(directory, 'shared'), '--extensions-dir', extensionDirectory, '--install-extension', path.join(directory, 'alwaygit.vsix'), '--install-extension', path.join(directory, 'controller.vsix'), '--force'];
  if (process.platform === 'win32') {
    // PowerShell single-quoted literals preserve spaces, dollar signs and apostrophes in paths.
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '& ' + [cli, ...cliArguments].map(quote).join(' ')], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  } else await exec(cli, cliArguments, { maxBuffer: 2 * 1024 * 1024 });
  launch(roots.target);
  const initialTarget = await waitFor('Target startup', async () => (await read('target.state.json'))?.ready && await read('target.state.json'));
  launch(roots.source);
  await waitFor('Source startup', async () => (await read('source.state.json'))?.ready);
  // The workbench knows target, but its actual workspace is still source.
  await action('source', { root: roots.target, method: 'openProject' });
  const focusedTarget = await waitFor('Target window focus', async () => { const state = await read('target.state.json'); return state?.focused && state; });
  assertPreserved(focusedTarget);
  assert.equal(tabs(focusedTarget).length, tabs(initialTarget).length);
  await action('source', { root: roots.target, method: 'diff', payload: { kind: 'change', area: 'staged', path: 'sample.ts' } });
  const staged = await waitFor('Staged target diff', async () => { const state = await read('target.state.json'); return state && tabs(state).some(tab => tab.left && tab.label.includes('HEAD')) && state; });
  assertPreserved(staged);
  assert.equal(tabs(staged).find(tab => tab.left)?.preview, false);
  assert.ok(staged.documents.some(document => document.uri.startsWith('alwaygit-content:') && document.text.includes('value = 1')));
  assert.ok(staged.documents.some(document => document.uri.startsWith('alwaygit-content:') && document.text.includes('value = 2')));
  await action('source', { root: roots.target, method: 'diff', payload: { kind: 'change', area: 'unstaged', path: 'sample.ts' } });
  const unstaged = await waitFor('Unstaged target diff', async () => { const state = await read('target.state.json'); return state && tabs(state).filter(tab => tab.left).length === 2 && state; });
  assertPreserved(unstaged);
  assert.ok(tabs(unstaged).filter(tab => tab.left).every(tab => !tab.preview));
  await action('source', { root: roots.target, method: 'openFile', payload: { path: 'sample.ts' } });
  const edited = await waitFor('Target file tab', async () => { const state = await read('target.state.json'); return state && tabs(state).some(tab => tab.uri?.endsWith('/sample.ts')) && state; });
  assertPreserved(edited);
  assert.equal(tabs(edited).find(tab => tab.uri?.endsWith('/sample.ts'))?.preview, false);
  const source = await read('source.state.json');
  assertPreserved(source);
  assert.ok(tabs(source).some(tab => tab.label === 'AlwayGit'));
  assert.equal(tabs(source).filter(tab => tab.left || tab.uri?.endsWith('/sample.ts')).length, 0, 'Native editors must be opened in target, not in the workbench source window');
  await action('source', { root: roots['new-project'], method: 'openFile', payload: { path: 'sample.ts' } });
  const fresh = await waitFor('New project file tab', async () => { const state = await read('new-project.state.json'); return state && tabs(state).some(tab => tab.uri?.endsWith('/sample.ts')) && state; });
  assertPreserved(fresh);
  await action('source', { root: roots['workbench-project'], method: 'openRepository', payload: { newWindow: true } });
  const workbenchProject = await waitFor('New project workbench tab', async () => { const state = await read('workbench-project.state.json'); return state && tabs(state).some(tab => tab.label === 'AlwayGit') && state; });
  assertPreserved(workbenchProject);
  assert.equal((await readdir(source.registry)).filter(name => name.endsWith('.json')).length, 4, 'Existing project windows must be reused and explicit Workbench opens get one new window');
  console.log('ALWAYGIT_WINDOW_TESTS_PASSED: exact project window/focus, receiving-host staged/unstaged Diff, pinned file tabs, no side group, preserved unsaved editors/workbench, unopened project startup, new-window Workbench startup');
} finally {
  // Only terminate processes launched with this isolated test profile; never touch user VS Code.
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (process.platform === 'win32') await exec('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
    else child.kill('SIGTERM');
  }
  // A reused main process can leave child windows; ask only the test companion to close them.
  for (const name of ['new-project', 'workbench-project', 'source', 'target']) await writeFile(path.join(mailbox, name + '.action.json'), JSON.stringify({ id: 'close-' + (++sequence), type: 'close' })).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 1500));
  const absolute = path.resolve(directory);
  if (path.dirname(absolute) !== path.resolve(tmpdir()) || !path.basename(absolute).startsWith('alwaygit-windows-test-')) throw new Error('Unsafe window test cleanup target');
  await rm(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
