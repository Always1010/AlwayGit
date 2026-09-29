import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const directory = await mkdtemp(path.join(tmpdir(), 'alwaygit-extension-'));
const fixture = path.join(directory, 'repo');
const { mkdir } = await import('node:fs/promises');
await mkdir(fixture);
const git = (...args) => exec('git', ['-C', fixture, ...args], { windowsHide: true });
try {
  await git('init', '-b', 'main'); await git('config', 'user.name', 'AlwayGit Test'); await git('config', 'user.email', 'test@example.com'); await git('config', 'commit.gpgsign', 'false');
  await writeFile(path.join(fixture, 'sample.ts'), 'export const value = 1;\n'); await git('add', '.'); await git('commit', '-m', 'Initial fixture');
  await writeFile(path.join(fixture, 'sample.ts'), 'export const value = 2;\n'); await git('add', '.');
  await writeFile(path.join(fixture, 'sample.ts'), 'export const value = 3;\n');
  await build({ entryPoints: ['tests/extension/runner.ts'], outfile: 'dist/extension-tests.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'] });
  await runTests({
    ...(process.env.ALWAYGIT_VSCODE_EXECUTABLE ? { vscodeExecutablePath: process.env.ALWAYGIT_VSCODE_EXECUTABLE } : { version: process.env.ALWAYGIT_VSCODE_VERSION ?? 'stable' }),
    extensionDevelopmentPath: process.cwd(), extensionTestsPath: path.resolve('dist/extension-tests.cjs'),
    launchArgs: [fixture, '--user-data-dir', path.join(directory, 'profile'), '--extensions-dir', path.join(directory, 'extensions'), '--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-gpu', '--disable-telemetry'],
  });
} finally {
  const absolute = path.resolve(directory);
  if (path.dirname(absolute) !== path.resolve(tmpdir()) || !path.basename(absolute).startsWith('alwaygit-extension-')) throw new Error('Unsafe test cleanup target');
  await rm(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
