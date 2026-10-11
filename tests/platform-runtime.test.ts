import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { nativeTarget, packageTarget, copyTerminalRuntime, verifyPackageIdentity } = await import(new URL('../scripts/platform-runtime.mjs', import.meta.url).href);

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

  it('removes stale native files and foreign prebuilds, then refuses an unusable copied runtime', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-runtime-test-'));
    try {
      const source = path.join(directory, 'source'), destination = path.join(directory, 'runtime');
      await Promise.all(['source/prebuilds/win32-x64', 'source/prebuilds/linux-arm64', 'runtime/build/Release'].map(folder => mkdir(path.join(directory, folder), { recursive: true })));
      await writeFile(path.join(destination, 'build/Release/pty.node'), 'stale');
      await writeFile(path.join(source, 'index.js'), 'module.exports = {};');
      await expect(copyTerminalRuntime(source, destination, 'linux-arm64')).rejects.toThrow(/cannot create/);
      expect(await readdir(path.join(destination, 'prebuilds'))).toEqual(['linux-arm64']);
      await expect(readdir(path.join(destination, 'build/Release'))).rejects.toThrow();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
