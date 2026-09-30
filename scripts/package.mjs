import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifacts = join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const fixed = join(artifacts, 'alwaygit.vsix');
const versioned = join(artifacts, `alwaygit-${version}.vsix`);
const temporary = join(artifacts, `.alwaygit-${process.pid}.vsix`);

async function exists(path) {
  try { await stat(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

try {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'node_modules/@vscode/vsce/vsce'), 'package', '--allow-missing-repository', '--skip-license', '--no-dependencies', '--no-rewrite-relative-links', '--out', temporary], { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`VSIX packaging failed (${code ?? 'terminated'}).`)));
  });
  const prior = await exists(fixed) ? fixed : await exists(versioned) ? versioned : undefined;
  if (prior) await copyFile(prior, join(artifacts, 'alwaygit-previous.vsix'));
  await copyFile(temporary, versioned);
  await rename(temporary, fixed);
  console.log(`Ready: ${fixed} (version ${version})`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await rm(temporary, { force: true });
}
