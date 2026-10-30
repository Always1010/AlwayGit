import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const {
  parseInstallArgs,
  chooseInstallOptions,
  install,
  commandInvocation,
  assertCodeCompatibility,
  runCommand,
} = await import(new URL('../scripts/install.mjs', import.meta.url).href);
const { inspectInstallPackage } = await import(
  new URL('../scripts/install-package.mjs', import.meta.url).href
);
const require = createRequire(import.meta.url);
const vsceRequire = createRequire(require.resolve('@vscode/vsce/package.json'));
const { ZipFile } = vsceRequire('yazl');
const { ManifestProcessor, toVsixManifest } = vsceRequire('./out/package.js');
const manifest = {
  name: 'alwaygit',
  publisher: 'alwaygit-dev',
  version: '1.3.0',
  main: './dist/extension.cjs',
  engines: { vscode: '^1.106.0' },
  extensionKind: ['workspace'],
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function archive(
  filename: string,
  target = 'linux-x64',
  options: { version?: string; compress?: boolean; duplicate?: boolean; engine?: string } = {},
) {
  const packaged = {
    ...manifest,
    version: options.version ?? manifest.version,
    engines: { vscode: options.engine ?? manifest.engines.vscode },
  };
  const xml = await toVsixManifest({
    ...new ManifestProcessor(packaged, { target }).vsix,
    assets: [],
  });
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(packaged)), 'extension/package.json', {
    compress: options.compress ?? true,
  });
  zip.addBuffer(Buffer.from(xml), 'extension.vsixmanifest');
  if (options.duplicate)
    zip.addBuffer(Buffer.from(JSON.stringify(packaged)), 'extension/package.json');
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
if (args.includes('--help')) console.log('--install-extension --list-extensions --show-versions --server-data-dir --extensions-dir' + (process.env.MOCK_NO_PROFILE ? '' : ' --profile <name>'));
else if (args.includes('--version')) console.log(process.env.MOCK_CODE_VERSION || '1.106.0\\ncommit\\nx64');
else if (args.includes('--install-extension')) { if (process.env.MOCK_FAIL_INSTALL) process.exit(3); }
else if (args.includes('--list-extensions')) console.log('alwaygit-dev.alwaygit@' + (process.env.MOCK_VERSION || '1.3.0'));
else process.exit(4);
`;
  await writeFile(cliScript, source);
  await writeFile(
    codePath,
    process.platform === 'win32' ? `@"${process.execPath}" "${cliScript}" %*\r\n` : source,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: '',
    ALWAYGIT_CODE_CLI: '',
    ALWAYGIT_VSCODE_PROFILE: '',
    SSH_CONNECTION: '',
    VSCODE_AGENT_FOLDER: '',
    VSCODE_IPC_HOOK_CLI: '',
    VSCODE_CLIENT_COMMAND: '',
    MOCK_CODE_VERSION: '',
  };
  return {
    root,
    vsix,
    codePath,
    env,
    home: path.join(root, 'home'),
    record: path.join(root, 'artifacts/local-install.json'),
  };
}

async function serverFixture(f: Awaited<ReturnType<typeof fixture>>) {
  const dataDir = path.join(f.home, '.vscode-server');
  const serverRoot = path.join(dataDir, 'cli/servers/Stable-test/server');
  await mkdir(path.join(serverRoot, 'bin'), { recursive: true });
  await mkdir(path.join(serverRoot, 'out'));
  await writeFile(
    path.join(serverRoot, 'product.json'),
    JSON.stringify({
      serverApplicationName: 'code-server',
      serverDataFolderName: '.vscode-server',
    }),
  );
  await writeFile(path.join(serverRoot, 'package.json'), JSON.stringify({ version: '1.106.0' }));
  await writeFile(path.join(serverRoot, 'out/server-main.js'), '');
  const serverCli = path.join(
    serverRoot,
    'bin',
    process.platform === 'win32' ? 'code-server.cmd' : 'code-server',
  );
  await writeFile(serverCli, await readFile(f.codePath), { mode: 0o755 });
  return { serverCli, dataDir, extensionsDir: path.join(dataDir, 'extensions') };
}

describe('Unified installer', () => {
  it('requires an explicit operation outside interactive terminals and rejects conflicting options', async () => {
    expect(parseInstallArgs(['--target', 'linux-arm64', '--build-install'])).toEqual({
      target: 'linux-arm64',
      mode: 'build-install',
    });
    expect(parseInstallArgs(['--install-only', '--profile', '']).profile).toBe('');
    expect(parseInstallArgs(['--install-only', '--profile=']).profile).toBe('');
    expect(parseInstallArgs(['--install-only', '--install-to', 'server']).installTo).toBe('server');
    expect(() => parseInstallArgs(['--install-to', 'remote'])).toThrow(/安装位置/);
    expect(() => parseInstallArgs(['--install-only', '--build-install'])).toThrow(/一种操作/);
    expect(() => parseInstallArgs(['--target'])).toThrow(/缺少/);
    expect(() => parseInstallArgs(['--package-only', '--vsix', 'example.vsix'])).toThrow(
      /install-only/,
    );
    await expect(
      chooseInstallOptions({ target: 'auto' }, 'linux-x64', { input: { isTTY: false } }),
    ).rejects.toThrow(/非交互/);
  });

  it('lets interactive users accept the detected Linux ARM64 platform and choose install-only', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = new Writable({
      write(chunk, _encoding, callback) {
        const text = chunk.toString();
        if (text.includes('请选择平台')) queueMicrotask(() => input.write('\n'));
        if (text.includes('请选择操作')) queueMicrotask(() => input.write('2\n'));
        if (text.includes('请选择安装位置')) queueMicrotask(() => input.write('\n'));
        callback();
      },
    });
    try {
      expect(
        await chooseInstallOptions({ target: 'auto' }, 'linux-arm64', { input, output }),
      ).toEqual({ target: 'linux-arm64', mode: 'install-only', installTo: 'desktop' });
    } finally {
      input.destroy();
      output.destroy();
    }
  });

  it.each(['server', 'package-only'])(
    'asks only for the necessary choices when selecting %s',
    async (choice) => {
      const input = Object.assign(new PassThrough(), { isTTY: true });
      const prompts: string[] = [];
      const output = new Writable({
        write(chunk, _encoding, callback) {
          const text = chunk.toString();
          if (text.includes('请选择操作'))
            queueMicrotask(() => input.write(choice === 'server' ? '2\n' : '3\n'));
          if (text.includes('请选择安装位置')) {
            prompts.push(text);
            queueMicrotask(() => input.write('2\n'));
          }
          callback();
        },
      });
      try {
        const result = await chooseInstallOptions({ target: 'linux-arm64' }, 'linux-arm64', {
          input,
          output,
        });
        expect(result).toEqual(
          choice === 'server'
            ? { target: 'linux-arm64', mode: 'install-only', installTo: 'server' }
            : { target: 'linux-arm64', mode: 'package-only' },
        );
        expect(prompts).toHaveLength(choice === 'server' ? 1 : 0);
      } finally {
        input.destroy();
        output.destroy();
      }
    },
  );

  it('automatically installs to Server in ordinary SSH, verifies using the same directories and keeps desktop records separate', async () => {
    const f = await fixture();
    const s = await serverFixture(f);
    await install(
      { mode: 'install-only', codePath: f.codePath, profile: 'Desktop Profile' },
      { ...f, host: 'linux-x64', machine: 'same', log: () => {} },
    );
    const calls: { command: string; args: string[] }[] = [];
    const run = async (command: string, args: string[], options: object) => {
      calls.push({ command, args });
      return runCommand(command, args, options);
    };
    await install(
      { mode: 'install-only', installTo: 'server' },
      {
        ...f,
        host: 'linux-x64',
        machine: 'same',
        env: { ...f.env, SSH_CONNECTION: 'ordinary SSH' },
        run,
        log: () => {},
      },
    );
    expect(calls.every((call) => call.command === s.serverCli)).toBe(true);
    const mutations = calls.filter(
      (call) =>
        call.args.includes('--install-extension') || call.args.includes('--list-extensions'),
    );
    expect(mutations).toHaveLength(2);
    for (const call of mutations) {
      expect(call.args.slice(-4)).toEqual([
        '--server-data-dir',
        s.dataDir,
        '--extensions-dir',
        s.extensionsDir,
      ]);
      expect(call.args).not.toContain('--profile');
    }
    const record = JSON.parse(await readFile(f.record, 'utf8'));
    expect(record).toMatchObject({
      schemaVersion: 3,
      installTo: 'server',
      extensionsDir: s.extensionsDir,
      profile: '',
    });
    expect(record.contexts[JSON.stringify(['linux-x64', 'same', 'desktop'])].profile).toBe(
      'Desktop Profile',
    );
    expect(
      record.contexts[JSON.stringify(['linux-x64', 'same', 'server', s.dataDir])].codePath,
    ).toBe(s.serverCli);
  });

  it('ignores ambiguous legacy remote records when defaulting to desktop in SSH', async () => {
    const f = await fixture();
    const legacy = JSON.stringify(['linux-x64', 'same', 'remote']);
    await writeFile(
      f.record,
      JSON.stringify({
        schemaVersion: 2,
        contexts: { [legacy]: { codePath: f.codePath, profile: 'Old Remote Profile' } },
      }),
    );
    const env: Record<string, string | undefined> = {
      ...f.env,
      PATH: path.dirname(f.codePath),
      SSH_CONNECTION: 'SSH',
    };
    delete env.ALWAYGIT_VSCODE_PROFILE;
    await install(
      { mode: 'install-only', codePath: f.codePath },
      { ...f, host: 'linux-x64', machine: 'same', env, log: () => {} },
    );
    const record = JSON.parse(await readFile(f.record, 'utf8'));
    expect(record).toMatchObject({ installTo: 'desktop', profile: '' });
    expect(record.contexts[legacy].profile).toBe('Old Remote Profile');
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
    await install(
      { target: 'auto', mode: 'install-only', codePath: f.codePath, profile: '工作 Profile' },
      {
        ...f,
        host: 'linux-x64',
        machine: 'test-host',
        log: (message: string) => messages.push(message),
      },
    );
    const record = JSON.parse(await readFile(f.record, 'utf8'));
    expect(record).toMatchObject({
      schemaVersion: 3,
      installTo: 'desktop',
      codePath: f.codePath,
      target: 'linux-x64',
      version: '1.3.0',
      profile: '工作 Profile',
    });
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(record.contexts[JSON.stringify(['linux-x64', 'test-host', 'desktop'])]).toMatchObject({
      codePath: f.codePath,
    });
    expect(messages.at(-1)).toMatch(/已安装并核对/);
    await expect(access(path.join(f.root, 'node_modules'))).rejects.toThrow();
  });

  it.each(['install', 'version'])(
    'does not overwrite a successful record after a failed %s check',
    async (failure) => {
      const f = await fixture();
      const prior = JSON.stringify({
        codePath: 'C:\\Windows\\code.cmd',
        profile: 'Windows Profile',
      });
      await writeFile(f.record, prior);
      const env = {
        ...f.env,
        ...(failure === 'install' ? { MOCK_FAIL_INSTALL: '1' } : { MOCK_VERSION: '1.2.0' }),
      };
      await expect(
        install(
          { target: 'auto', mode: 'install-only', codePath: f.codePath },
          { ...f, env, host: 'linux-x64', log: () => {} },
        ),
      ).rejects.toThrow();
      expect(await readFile(f.record, 'utf8')).toBe(prior);
    },
  );

  it('refuses a foreign host or package before installation', async () => {
    const f = await fixture();
    const calls: string[][] = [];
    const run = async (_command: string, args: string[]) => {
      calls.push(args);
      return args.includes('--version')
        ? '1.106.0'
        : '--install-extension --list-extensions --show-versions';
    };
    await expect(
      install(
        { target: 'linux-arm64', mode: 'build-install' },
        { ...f, host: 'linux-x64', run, log: () => {} },
      ),
    ).rejects.toThrow(/does not cross-compile/);
    expect(calls).toEqual([]);
    await archive(f.vsix, 'linux-arm64');
    await expect(
      install(
        { target: 'auto', mode: 'install-only', codePath: f.codePath },
        { ...f, host: 'linux-x64', run, log: () => {} },
      ),
    ).rejects.toThrow(/target/);
    expect(calls).toEqual([['--help'], ['--version']]);
    await expect(access(f.record)).rejects.toThrow();
  });

  it('refuses unsupported Profiles and allows explicitly clearing a saved desktop Profile in SSH', async () => {
    const f = await fixture();
    const context = JSON.stringify(['linux-x64', 'test-host', 'desktop']);
    await writeFile(
      f.record,
      JSON.stringify({
        schemaVersion: 2,
        contexts: { [context]: { codePath: f.codePath, profile: 'desktop' } },
      }),
    );
    const env = { ...f.env, SSH_CONNECTION: 'test', MOCK_NO_PROFILE: '1' };
    delete (env as Record<string, string | undefined>).ALWAYGIT_VSCODE_PROFILE;
    await expect(
      install(
        { mode: 'install-only', codePath: f.codePath },
        { ...f, env, host: 'linux-x64', machine: 'test-host', log: () => {} },
      ),
    ).rejects.toThrow(/不支持 --profile/);
    await install(
      { mode: 'install-only', codePath: f.codePath, profile: '' },
      { ...f, env, host: 'linux-x64', machine: 'test-host', log: () => {} },
    );
    const record = JSON.parse(await readFile(f.record, 'utf8'));
    expect(record.contexts[context].profile).toBe('');
  });

  it('reuses only the current machine context and preserves records for other machines', async () => {
    const f = await fixture();
    const current = JSON.stringify(['linux-x64', 'current', 'local']);
    const foreign = JSON.stringify(['win32-x64', 'windows', 'local']);
    const contexts = {
      [current]: { codePath: f.codePath, profile: 'Linux' },
      [foreign]: { codePath: 'C:\\code.cmd', profile: 'Windows' },
    };
    await writeFile(f.record, JSON.stringify({ schemaVersion: 2, contexts }));
    delete (f.env as Record<string, string | undefined>).ALWAYGIT_VSCODE_PROFILE;
    await install(
      { mode: 'install-only' },
      { ...f, host: 'linux-x64', machine: 'current', log: () => {} },
    );
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
      return args.includes('--version')
        ? '1.106.0'
        : '--install-extension --list-extensions --show-versions';
    };
    await expect(
      install({ mode: 'package-only' }, { ...f, host: 'linux-x64', run, log: () => {} }),
    ).rejects.toThrow(/npm ci/);
    expect(calls).toEqual([]);
    await mkdir(path.join(f.root, 'node_modules/@vscode/vsce'), { recursive: true });
    await mkdir(path.join(f.root, 'node_modules/node-pty'), { recursive: true });
    await writeFile(path.join(f.root, 'node_modules/@vscode/vsce/vsce'), '');
    await writeFile(path.join(f.root, 'node_modules/node-pty/package.json'), '{}');
    await expect(
      install(
        { mode: 'build-install', codePath: f.codePath },
        { ...f, host: 'linux-x64', run, log: () => {} },
      ),
    ).rejects.toThrow(/mock build failed/);
    expect(calls).toEqual([
      ['--help'],
      ['--version'],
      [path.join(f.root, 'scripts/package.mjs'), '--target', 'linux-x64'],
    ]);
    await expect(access(f.record)).rejects.toThrow();
    calls.length = 0;
    await install(
      { mode: 'package-only' },
      {
        ...f,
        host: 'linux-x64',
        run: async (_command: string, args: string[]) => {
          calls.push(args);
        },
        log: () => {},
      },
    );
    expect(calls).toEqual([[path.join(f.root, 'scripts/package.mjs'), '--target', 'linux-x64']]);
  });

  it.each(['1.106.0', '1.106.1', '1.140.0', '1.106.0-insider'])(
    'accepts compatible VS Code %s CLI output',
    (version) => {
      expect(
        assertCodeCompatibility(`warning\n${version}\ncommit\narm64\n`, '^1.106.0', 'code'),
      ).toBe(version);
    },
  );

  it.each(['1.98.2', '1.105.9', '2.0.0'])('rejects incompatible VS Code %s', (version) => {
    expect(() => assertCodeCompatibility(version, '^1.106.0', '/usr/bin/code')).toThrow(
      /不兼容.*CLI：\/usr\/bin\/code/,
    );
  });

  it('refuses unknown CLI versions and unsupported or missing engine ranges', () => {
    expect(() => assertCodeCompatibility('commit\narm64', '^1.106.0', 'code')).toThrow(/无法读取/);
    expect(() => assertCodeCompatibility('1.106.0', undefined, 'code')).toThrow(/无法校验/);
    expect(() => assertCodeCompatibility('1.106.0', '*', 'code')).toThrow(/无法校验/);
  });

  it.each(['build-install', 'install-only'])(
    'stops %s on old VS Code before building or installing and preserves artifacts',
    async (mode) => {
      const f = await fixture();
      const before = await readFile(f.vsix);
      await writeFile(f.record, '{}');
      const calls: string[][] = [];
      const run = async (_command: string, args: string[]) => {
        calls.push(args);
        return args.includes('--version')
          ? '1.98.2\ncommit\narm64'
          : '--install-extension --list-extensions --show-versions';
      };
      await expect(
        install({ mode, codePath: f.codePath }, { ...f, host: 'linux-x64', run, log: () => {} }),
      ).rejects.toThrow(/1\.98\.2.*\^1\.106\.0/);
      expect(calls).toEqual([['--help'], ['--version']]);
      expect(await readFile(f.vsix)).toEqual(before);
      expect(await readFile(f.record, 'utf8')).toBe('{}');
    },
  );

  it('checks the existing VSIX engine as well as the source manifest before installation', async () => {
    const f = await fixture();
    await archive(f.vsix, 'linux-x64', { engine: '^1.107.0' });
    await expect(
      install(
        { mode: 'install-only', codePath: f.codePath },
        { ...f, host: 'linux-x64', log: () => {} },
      ),
    ).rejects.toThrow(/1\.106\.0.*\^1\.107\.0/);
    await expect(access(f.record)).rejects.toThrow();
  });

  it('quotes Windows batch paths and arguments without exposing shell expansions', () => {
    const invocation = commandInvocation(
      'C:\\Program Files\\Code\\code.cmd',
      ['--profile', '工作 & Profile!'],
      'win32',
      { ComSpec: 'C:\\Windows\\cmd.exe' },
    );
    expect(invocation).toMatchObject({
      command: 'C:\\Windows\\cmd.exe',
      windowsVerbatimArguments: true,
    });
    expect(invocation.args).toEqual([
      '/d',
      '/v:off',
      '/s',
      '/c',
      '""C:\\Program Files\\Code\\code.cmd" "--profile" "工作 & Profile!""',
    ]);
    expect(() => commandInvocation('code.cmd', ['%PATH%'], 'win32')).toThrow(/百分号/);
    expect(() => commandInvocation('code.cmd', ['" & echo unsafe'], 'win32')).toThrow(/双引号/);
    expect(commandInvocation('/bin/code', ['--help'], 'linux').args).toEqual(['--help']);
  });
});
