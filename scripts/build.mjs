import { build, context } from 'esbuild';
import { generate } from './i18n.mjs';
import { mkdir, copyFile, chmod } from 'node:fs/promises';
await generate();
await mkdir('dist', { recursive: true });
await copyFile('src/extension/askpass.cjs', 'dist/askpass.cjs');
await copyFile('src/extension/askpass.sh', 'dist/askpass.sh');
await chmod('dist/askpass.sh', 0o755);
const options = { entryPoints: ['src/extension/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], sourcemap: true };
if (process.argv.includes('--watch')) { const ctx = await context(options); await ctx.watch(); }
else { await build(options); }
