import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, chmod, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { packageTarget, verifyPackageIdentity } from './platform-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const archive = process.argv[2];
if (!archive || process.argv.length > 4) throw new Error('Usage: node scripts/verify-package.mjs <VSIX> [target]');
const target = packageTarget(process.argv[3] ? ['--target', process.argv[3]] : []);
// Use VSCE's ZIP/XML readers, resolved within VSCE rather than relying on hoisting.
const require = createRequire(import.meta.url);
const vsceRequire = createRequire(require.resolve('@vscode/vsce/package.json'));
const yauzl = vsceRequire('yauzl');
const { parseStringPromise } = vsceRequire('xml2js');
const directory = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-vsix-'));
try {
  await new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true }, (error, zip) => {
      if (error) { reject(error); return; }
      const fail = error => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('end', resolve);
      zip.on('entry', entry => {
        if (!['extension.vsixmanifest', 'extension/package.json'].includes(entry.fileName)
          && !entry.fileName.startsWith('extension/dist/')) { zip.readEntry(); return; }
        const destination = path.resolve(directory, entry.fileName);
        const relative = path.relative(directory, destination);
        const mode = entry.externalFileAttributes >>> 16;
        if (relative.startsWith('..') || path.isAbsolute(relative) || (mode & 0o170000) === 0o120000) {
          fail(new Error('Unsafe VSIX entry.')); return;
        }
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        zip.openReadStream(entry, async (error, stream) => {
          if (error) { fail(error); return; }
          try {
            await mkdir(path.dirname(destination), { recursive: true });
            await pipeline(stream, createWriteStream(destination));
            if (process.platform !== 'win32') await chmod(destination, mode & 0o777);
            zip.readEntry();
          } catch (error) { fail(error); }
        });
      });
      zip.readEntry();
    });
  });
  const expected = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(directory, 'extension/package.json'), 'utf8'));
  const xml = await parseStringPromise(await readFile(path.join(directory, 'extension.vsixmanifest'), 'utf8'));
  verifyPackageIdentity(manifest, xml.PackageManifest?.Metadata?.[0]?.Identity?.[0]?.$, expected, target);
  const dist = path.join(directory, 'extension/dist');
  if (process.platform !== 'win32') {
    const { constants } = await import('node:fs');
    const { access } = await import('node:fs/promises');
    await access(path.join(dist, 'askpass.sh'), constants.X_OK);
  }
  const result = await promisify(execFile)(process.execPath, [path.join(root, 'scripts/test-terminal-host.mjs'), path.join(dist, 'terminal-host.cjs')], {
    cwd: directory, windowsHide: true, timeout: 70000,
  });
  process.stdout.write(result.stdout);
  console.log(`Verified VSIX: ${manifest.publisher}.${manifest.name}@${manifest.version} (${target}).`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
