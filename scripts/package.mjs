import { mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
await mkdir('artifacts', { recursive: true });
const child = spawn(process.execPath, ['node_modules/@vscode/vsce/vsce', 'package', '--allow-missing-repository', '--skip-license', '--no-dependencies', '--no-rewrite-relative-links', '--out', 'artifacts/alwaygit-0.1.0.vsix'], { stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('close', code => { process.exitCode = code ?? 1; });
