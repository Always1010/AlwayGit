import { mkdtemp, mkdir, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { nativeTarget, packageTarget, copyTerminalRuntime, verifyPackageIdentity, verifyPackageContents, releaseReadme } = await import(new URL('../scripts/platform-runtime.mjs', import.meta.url).href);

async function fixtureFile(root: string, file: string, contents = 'fixture') {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), contents);
}

describe('Native extension packaging', () => {
  it('accepts VSCE-generated platform metadata and refuses mislabeled, stale or UI-only packages', async () => {
    const require = createRequire(import.meta.url);
    const vsceRequire = createRequire(require.resolve('@vscode/vsce/package.json'));
    const { ManifestProcessor, toVsixManifest } = vsceRequire('./out/package.js');
    const { parseStringPromise } = vsceRequire('xml2js');
    const manifest = { name: 'alwaygit', publisher: 'alwaygit-dev', version: '1.3.0', main: './dist/extension.cjs', engines: { vscode: '^1.106.0' }, extensionKind: ['workspace'] };
    const xml = await parseStringPromise(await toVsixManifest({ ...new ManifestProcessor(manifest, { target: 'linux-arm64' }).vsix, assets: [] }));
    const identity = xml.PackageManifest.Metadata[0].Identity[0].$;
    expect(() => verifyPackageIdentity(manifest, identity, manifest, 'linux-arm64')).not.toThrow();
    expect(() => verifyPackageIdentity(manifest, identity, manifest, 'linux-x64')).toThrow(/target/);
    expect(() => verifyPackageIdentity(manifest, { ...identity, Version: '1.2.0' }, manifest, 'linux-arm64')).toThrow(/XML identity/);
    expect(() => verifyPackageIdentity({ ...manifest, version: '1.2.0' }, identity, manifest, 'linux-arm64')).toThrow(/version/);
    expect(() => verifyPackageIdentity({ ...manifest, extensionKind: ['ui'] }, identity, manifest, 'linux-arm64')).toThrow(/workspace/);
  });

  it('rejects cross-platform labels and unsupported hosts before packaging', () => {
    expect(packageTarget([], 'linux-arm64')).toBe('linux-arm64');
    expect(() => packageTarget(['--target', 'linux-arm64'], 'win32-x64')).toThrow(/does not cross-compile/);
    expect(() => packageTarget(['--target'], 'linux-x64')).toThrow(/Usage/);
    expect(() => nativeTarget('linux', 'ia32')).toThrow(/Unsupported/);
  });

  it.each(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'win32-x64', 'win32-arm64'])('retains a complete %s runtime without stale, foreign or development files', async target => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-runtime-test-'));
    try {
      const source = path.join(directory, 'source'), destination = path.join(directory, 'runtime');
      const windows = target.startsWith('win32');
      const binaries = windows ? ['conpty.node', 'conpty_console_list.node', 'pty.node', 'winpty-agent.exe', 'winpty.dll', 'conpty/conpty.dll', 'conpty/OpenConsole.exe'] : target.startsWith('darwin-') ? ['pty.node', 'spawn-helper'] : ['pty.node'];
      const nativeFolder = windows ? `prebuilds/${target}` : 'build/Release';
      await fixtureFile(destination, 'build/Release/pty.node', 'stale');
      await fixtureFile(source, 'package.json', '{"main":"lib/index.js"}');
      await fixtureFile(source, 'LICENSE');
      await fixtureFile(source, 'deps/winpty/LICENSE');
      await fixtureFile(source, 'lib/index.js', 'exports.spawn = () => {};');
      await fixtureFile(source, 'lib/worker/conoutSocketWorker.js');
      await fixtureFile(source, 'lib/conpty_console_list_agent.js');
      for (const file of binaries) await fixtureFile(source, `${nativeFolder}/${file}`, 'selected');
      // A complete source build wins over the prebuild; an incomplete build falls back.
      await fixtureFile(source, windows ? 'build/Release/conpty/conpty.dll' : `prebuilds/${target}/pty.node`, 'unselected');
      if (target.startsWith('darwin-')) await fixtureFile(source, `prebuilds/${target}/spawn-helper`, 'unselected');
      const foreignTarget = windows ? 'linux-arm64' : 'win32-x64';
      for (const file of ['lib/index.test.js', 'lib/index.js.map', 'typings/node-pty.d.ts', 'scripts/post-install.js', 'deps/winpty/misc/test.cc', 'third_party/conpty/win10-arm64/conpty.dll', `prebuilds/${foreignTarget}/pty.node`, `${nativeFolder}/pty.pdb`]) await fixtureFile(source, file);
      await copyTerminalRuntime(source, destination, target);
      expect(await readdir(path.join(destination, 'prebuilds'))).toEqual([target]);
      expect(await readFile(path.join(destination, `prebuilds/${target}/pty.node`), 'utf8')).toBe('selected');
      const copied = (await readdir(destination, { recursive: true })).map(file => file.split(path.sep).join('/'));
      expect(copied).toContain('lib/worker/conoutSocketWorker.js');
      expect(copied).not.toContain('lib/index.test.js');
      expect(copied.includes(`prebuilds/${target}/spawn-helper`)).toBe(target.startsWith('darwin-'));
      expect(copied.some(file => /\.pdb$|\.map$|third_party|typings|scripts|misc/.test(file))).toBe(false);
      if (windows) expect(copied).toContain('deps/winpty/LICENSE');
      await expect(readdir(path.join(destination, 'build/Release'))).rejects.toThrow();
      await rm(path.join(source, nativeFolder, 'pty.node'));
      if (!windows) await rm(path.join(source, `prebuilds/${target}/pty.node`));
      await expect(copyTerminalRuntime(source, destination, target)).rejects.toThrow(/No complete/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64'])('validates the %s release allowlist and required native files', async target => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-release-test-'));
    try {
      const require = createRequire(import.meta.url);
      const vsceRequire = createRequire(require.resolve('@vscode/vsce/package.json'));
      const { listFiles, ReadmeProcessor } = vsceRequire('./out/package.js');
      const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
      await fixtureFile(directory, 'package.json', JSON.stringify(manifest));
      await fixtureFile(directory, '.vscodeignore', await readFile(new URL('../.vscodeignore', import.meta.url), 'utf8'));
      const runtime = 'dist/terminal-runtime/node-pty/';
      const required = ['README.md', 'package.nls.json', 'package.nls.zh-cn.json', 'media/alwaygit.svg', 'dist/extension.cjs', 'dist/terminal-host.cjs', 'dist/askpass.cjs', 'dist/askpass.sh', 'dist/launcher/launcher.js', 'dist/launcher/launcher.css', 'dist/webview/index.html', 'dist/webview/assets/index-fixture.js', 'dist/webview/assets/figure-01-fixture.png', `${runtime}package.json`, `${runtime}LICENSE`, `${runtime}lib/index.js`, `${runtime}prebuilds/${target}/pty.node`];
      if (target.startsWith('darwin-')) required.push(`${runtime}prebuilds/${target}/spawn-helper`);
      const excluded = ['docs/ISSUES.md', 'docs/images/user-manual/figure-01.png', '.github/workflows/release.yml', 'new-development-file.txt', 'README.zh-CN.md', 'dist/extension.cjs.map', 'dist/extension-tests.cjs', `${runtime}prebuilds/linux-arm64/pty.pdb`, `${runtime}scripts/post-install.js`, `${runtime}third_party/conpty/win10-arm64/conpty.dll`];
      for (const file of [...required, ...excluded]) await fixtureFile(directory, file);
      const files: string[] = await listFiles({ cwd: directory, dependencies: false });
      expect(files.sort()).toEqual(['package.json', ...required].sort());
      const packaged = files.map(file => `extension/${file === 'README.md' ? 'readme.md' : file}`);
      expect(() => verifyPackageContents(packaged, target)).not.toThrow();
      for (const leak of [...excluded, `${runtime}lib/terminal.test.js`, `${runtime}prebuilds/win32-x64/pty.node`]) {
        expect(() => verifyPackageContents([...packaged, `extension/${leak}`], target)).toThrow(/Unexpected/);
      }
      expect(() => verifyPackageContents([...packaged, packaged[0]], target)).toThrow(/Duplicate/);
      expect(() => verifyPackageContents(packaged.filter(file => !file.endsWith('/pty.node')), target)).toThrow(/Missing/);
      if (target.startsWith('darwin-')) {
        expect(() => verifyPackageContents(packaged.filter(file => !file.endsWith('/spawn-helper')), target)).toThrow(/Missing/);
      } else {
        expect(() => verifyPackageContents([...packaged, `extension/${runtime}prebuilds/${target}/spawn-helper`], target)).toThrow(/Unexpected/);
      }
      const readmePath = 'artifacts/.release-readme.md';
      const releaseText = releaseReadme(await readFile(new URL('../README.md', import.meta.url), 'utf8'));
      await fixtureFile(directory, readmePath, releaseText);
      const withReadme: string[] = await listFiles({ cwd: directory, dependencies: false, readmePath });
      expect(withReadme).toContain(readmePath);
      expect(withReadme).not.toContain('README.md');
      const processor = new ReadmeProcessor(manifest, { readmePath, rewriteRelativeLinks: false });
      const readme = await processor.onFile({ path: `extension/${readmePath}`, contents: Buffer.from(releaseText) });
      const text = readme.contents.toString();
      expect(readme.path).toBe('extension/readme.md');
      expect(text).toContain('https://always1010.github.io/AlwayGit/repository-stats.en.svg');
      expect(text).toContain('(https://github.com/Always1010/AlwayGit/blob/main/docs/USER_MANUAL.en.md#section-01-01)');
      expect(text).toContain('(https://github.com/Always1010/AlwayGit/blob/main/README.zh-CN.md)');
      expect(text).not.toMatch(/\]\((?:docs\/|README\.zh-CN\.md|AGENTS\.md)/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
