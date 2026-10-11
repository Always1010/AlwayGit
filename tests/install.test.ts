import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const { parseInstallArgs, chooseInstallOptions, install, commandInvocation } = await import(new URL('../scripts/install.mjs', import.meta.url).href);
const { inspectInstallPackage } = await import(new URL('../scripts/install-package.mjs', import.meta.url).href);
const require = createRequire(import.meta.url);
const vsceRequire = createRequire(require.resolve('@vscode/vsce/package.json'));
const { ZipFile } = vsceRequire('yazl');
const { ManifestProcessor, toVsixManifest } = vsceRequire('./out/package.js');
const manifest = { name: 'alwaygit', publisher: 'alwaygit-dev', version: '1.3.0', main: './dist/extension.cjs', engines: { vscode: '^1.106.0' }, extensionKind: ['workspace'] };
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });

async function archive(filename: string, target = 'linux-x64', options: { version?: string; compress?: boolean; duplicate?: boolean } = {}) {
  const packaged = { ...manifest, version: options.version ?? manifest.version };
  const xml = await toVsixManifest({ ...new ManifestProcessor(packaged, { target }).vsix, assets: [] });
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(packaged)), 'extension/package.json', { compress: options.compress ?? true });
  zip.addBuffer(Buffer.from(xml), 'extension.vsixmanifest');
  if (options.duplicate) zip.addBuffer(Buffer.from(JSON.stringify(packaged)), 'extension/package.json');
  const written = pipeline(zip.outputStream, createWriteStream(filename));
  zip.end();
  await written;
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-install-test-'));
  directories.push(root);
  await mkdir(path.join(root, 'artifacts'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
  const vsix = path.join(root, 'artifacts/alwaygit.vsix');
  await archive(vsix);
  const cliScript = path.join(root, 'mock-cli.cjs');
  const codePath = path.join(root, process.platform === 'win32' ? 'code mock.cmd' : 'code mock');
  const source = `#!${process.execPath}
const args = process.argv.slice(2);
if (args.includes('--help')) console.log('--install-extension --list-extensions --show-versions' + (process.env.MOCK_NO_PROFILE ? '' : ' --profile <name>'));
else if (args.includes('--install-extension')) { if (process.env.MOCK_FAIL_INSTALL) process.exit(3); }
else if (args.includes('--list-extensions')) console.log('alwaygit-dev.alwaygit@' + (process.env.MOCK_VERSION || '1.3.0'));
else process.exit(4);
`;
  await writeFile(cliScript, source);
  await writeFile(codePath, process.platform === 'win32' ? `@"${process.execPath}" "${cliScript}" %*\r\n` : source, { mode: 0o755 });
  const env = { ...process.env, PATH: '', ALWAYGIT_CODE_CLI: '', ALWAYGIT_VSCODE_PROFILE: '', SSH_CONNECTION: '', VSCODE_AGENT_FOLDER: '' };
  return { root, vsix, codePath, env, record: path.join(root, 'artifacts/local-install.json') };
}

describe('Unified installer', () => {
  it('requires an explicit operation outside interactive terminals and rejects conflicting options', async () => {
    expect(parseInstallArgs(['--target', 'linux-arm64', '--build-install'])).toEqual({ target: 'linux-arm64', mode: 'build-install' });
    expect(parseInstallArgs(['--install-only', '--profile', '']).profile).toBe('');
    expect(parseInstallArgs(['--install-only', '--profile=']).profile).toBe('');
    expect(() => parseInstallArgs(['--install-only', '--build-install'])).toThrow(/一种操作/);
    expect(() => parseInstallArgs(['--target'])).toThrow(/缺少/);
    expect(() => parseInstallArgs(['--package-only', '--vsix', 'example.vsix'])).toThrow(/install-only/);
    await expect(chooseInstallOptions({ target: 'auto' }, 'linux-x64', { input: { isTTY: false } })).rejects.toThrow(/非交互/);
  });

  it('lets interactive users accept the detected Rock 5B platform and choose install-only', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = new Writable({ write(chunk, _encoding, callback) {
      const text = chunk.toString();
      if (text.includes('请选择平台')) queueMicrotask(() => input.write('\n'));
      if (text.includes('请选择操作')) queueMicrotask(() => input.write('2\n'));
      callback();
    } });
    try {
      expect(await chooseInstallOptions({ target: 'auto' }, 'linux-arm64', { input, output })).toEqual({ target: 'linux-arm64', mode: 'install-only' });
    } finally { input.destroy(); output.destroy(); }
  });

  it('checks real VSCE XML identity in stored and deflated metadata without runtime dependencies', async () => {
    const f = await fixture();
    expect(await inspectInstallPackage(f.vsix, manifest, 'linux-x64')).toMatchObject(manifest);
    await archive(f.vsix, 'linux-x64', { compress: false });
    expect(await inspectInstallPackage(f.vsix, manifest, 'linux-x64')).toMatchObject(manifest);
    await expect(inspectInstallPackage(f.vsix, manifest, 'linux-arm64')).rejects.toThrow(/target/);
    await archive(f.vsix, 'linux-x64', { version: '1.2.0' });
    await expect(inspectInstallPackage(f.vsix, manifest, 'linux-x64')).rejects.toThrow(/version/);
    await archive(f.vsix, 'linux-x64', { duplicate: true });
    await expect(inspectInstallPackage(f.vsix, manifest, 'linux-x64')).rejects.toThrow(/Duplicate/);
    await writeFile(f.vsix, 'broken archive');
    await expect(inspectInstallPackage(f.vsix, manifest, 'linux-x64')).rejects.toThrow(/Invalid/);
  });

  it('installs with a CLI path containing spaces, verifies the version and writes a context record without building', async () => {
    const f = await fixture();
    const messages: string[] = [];
    await install({ target: 'auto', mode: 'install-only', codePath: f.codePath, profile: '工作 Profile' }, { ...f, host: 'linux-x64', machine: 'rock-test', log: (message: string) => messages.push(message) });
    const record = JSON.parse(await readFile(f.record, 'utf8'));
    expect(record).toMatchObject({ schemaVersion: 2, codePath: f.codePath, target: 'linux-x64', version: '1.3.0', profile: '工作 Profile' });
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.contexts[JSON.stringify(['linux-x64', 'rock-test', 'local'])]).toMatchObject({ codePath: f.codePath });
    expect(messages.at(-1)).toMatch(/已安装并核对/);
    await expect(access(path.join(f.root, 'node_modules'))).rejects.toThrow();
  });

  it.each(['install', 'version'])('does not overwrite a successful record after a failed %s check', async failure => {
    const f = await fixture();
    const prior = JSON.stringify({ codePath: 'C:\\Windows\\code.cmd', profile: 'Windows Profile' });
    await writeFile(f.record, prior);
    const env = { ...f.env, ...(failure === 'install' ? { MOCK_FAIL_INSTALL: '1' } : { MOCK_VERSION: '1.2.0' }) };
    await expect(install({ target: 'auto', mode: 'install-only', codePath: f.codePath }, { ...f, env, host: 'linux-x64', log: () => {} })).rejects.toThrow();
    expect(await readFile(f.record, 'utf8')).toBe(prior);
  });

  it('refuses a foreign host or package before installation', async () => {
    const f = await fixture();
    const calls: string[][] = [];
    const run = async (_command: string, args: string[]) => { calls.push(args); return '--install-extension --list-extensions --show-versions'; };
    await expect(install({ target: 'linux-arm64', mode: 'build-install' }, { ...f, host: 'linux-x64', run, log: () => {} })).rejects.toThrow(/does not cross-compile/);
    expect(calls).toEqual([]);
    await archive(f.vsix, 'linux-arm64');
    await expect(install({ target: 'auto', mode: 'install-only', codePath: f.codePath }, { ...f, host: 'linux-x64', run, log: () => {} })).rejects.toThrow(/target/);
    expect(calls).toEqual([['--help']]);
    await expect(access(f.record)).rejects.toThrow();
  });

  it('refuses unsupported remote Profiles and allows explicitly clearing a saved Profile', async () => {
    const f = await fixture();
    const context = JSON.stringify(['linux-x64', 'rock-test', 'remote']);
    await writeFile(f.record, JSON.stringify({ schemaVersion: 2, contexts: { [context]: { codePath: f.codePath, profile: 'desktop' } } }));
    const env = { ...f.env, SSH_CONNECTION: 'test', MOCK_NO_PROFILE: '1' };
    delete (env as Record<string, string | undefined>).ALWAYGIT_VSCODE_PROFILE;
    await expect(install({ mode: 'install-only', codePath: f.codePath }, { ...f, env, host: 'linux-x64', machine: 'rock-test', log: () => {} })).rejects.toThrow(/不支持 --profile/);
    await install({ mode: 'install-only', codePath: f.codePath, profile: '' }, { ...f, env, host: 'linux-x64', machine: 'rock-test', log: () => {} });
    const record = JSON.parse(await readFile(f.record, 'utf8'));
    expect(record.contexts[context].profile).toBe('');
  });

  it('reuses only the current machine context and preserves records for other machines', async () => {
    const f = await fixture();
    const current = JSON.stringify(['linux-x64', 'current', 'local']);
    const foreign = JSON.stringify(['win32-x64', 'windows', 'local']);
    const contexts = { [current]: { codePath: f.codePath, profile: 'Linux' }, [foreign]: { codePath: 'C:\\code.cmd', profile: 'Windows' } };
    await writeFile(f.record, JSON.stringify({ schemaVersion: 2, contexts }));
    delete (f.env as Record<string, string | undefined>).ALWAYGIT_VSCODE_PROFILE;
    await install({ mode: 'install-only' }, { ...f, host: 'linux-x64', machine: 'current', log: () => {} });
    const record = JSON.parse(await readFile(f.record, 'utf8'));
    expect(record.contexts[current].profile).toBe('Linux');
    expect(record.contexts[foreign]).toEqual(contexts[foreign]);
  });

  it('checks dependencies without installing them, and stops after a failed build', async () => {
    const f = await fixture();
    const calls: string[][] = [];
    const run = async (_command: string, args: string[]) => {
      calls.push(args);
      if (args[0].endsWith('package.mjs')) throw new Error('mock build failed');
      return '--install-extension --list-extensions --show-versions';
    };
    await expect(install({ mode: 'package-only' }, { ...f, host: 'linux-x64', run, log: () => {} })).rejects.toThrow(/npm ci/);
    expect(calls).toEqual([]);
    await mkdir(path.join(f.root, 'node_modules/@vscode/vsce'), { recursive: true });
    await mkdir(path.join(f.root, 'node_modules/node-pty'), { recursive: true });
    await writeFile(path.join(f.root, 'node_modules/@vscode/vsce/vsce'), '');
    await writeFile(path.join(f.root, 'node_modules/node-pty/package.json'), '{}');
    await expect(install({ mode: 'build-install', codePath: f.codePath }, { ...f, host: 'linux-x64', run, log: () => {} })).rejects.toThrow(/mock build failed/);
    expect(calls).toEqual([['--help'], [path.join(f.root, 'scripts/package.mjs'), '--target', 'linux-x64']]);
    await expect(access(f.record)).rejects.toThrow();
    calls.length = 0;
    await install({ mode: 'package-only' }, { ...f, host: 'linux-x64', run: async (_command: string, args: string[]) => { calls.push(args); }, log: () => {} });
    expect(calls).toEqual([[path.join(f.root, 'scripts/package.mjs'), '--target', 'linux-x64']]);
  });

  it('quotes Windows batch paths and arguments without exposing shell expansions', () => {
    const invocation = commandInvocation('C:\\Program Files\\Code\\code.cmd', ['--profile', '工作 & Profile!'], 'win32', { ComSpec: 'C:\\Windows\\cmd.exe' });
    expect(invocation).toMatchObject({ command: 'C:\\Windows\\cmd.exe', windowsVerbatimArguments: true });
    expect(invocation.args).toEqual(['/d', '/v:off', '/s', '/c', '""C:\\Program Files\\Code\\code.cmd" "--profile" "工作 & Profile!""']);
    expect(() => commandInvocation('code.cmd', ['%PATH%'], 'win32')).toThrow(/百分号/);
    expect(() => commandInvocation('code.cmd', ['" & echo unsafe'], 'win32')).toThrow(/双引号/);
    expect(commandInvocation('/bin/code', ['--help'], 'linux').args).toEqual(['--help']);
  });
});
