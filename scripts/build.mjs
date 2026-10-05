import { build, context } from 'esbuild';
import { generate } from './i18n.mjs';
import { mkdir, copyFile, chmod, cp } from 'node:fs/promises';
await generate();
await mkdir('dist', { recursive: true });
await copyFile('src/extension/askpass.cjs', 'dist/askpass.cjs');
await copyFile('src/extension/askpass.sh', 'dist/askpass.sh');
await chmod('dist/askpass.sh', 0o755);
// Native PTY binaries must stay outside the JS bundle. Include the installed platform's runtime.
await cp('node_modules/node-pty', 'dist/terminal-runtime/node-pty', { recursive: true,
  filter: source => !/(?:^|[\\/])(?:src|test|node_modules|\.github)(?:[\\/]|$)/.test(source.replace(/^node_modules[\\/]node-pty/, '')) });
const options = { entryPoints: ['src/extension/extension.ts'], outfile: 'dist/extension.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], sourcemap: true };
const terminalOptions = { ...options, entryPoints: ['src/extension/terminal-host.ts'], outfile: 'dist/terminal-host.cjs' };
const launcherOptions = { entryPoints: ['webview/launcher.tsx'], outfile: 'dist/launcher/launcher.js', bundle: true, platform: 'browser', format: 'iife', target: 'chrome128', jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' } };
if (process.argv.includes('--watch')) { const contexts = await Promise.all([context(options), context(terminalOptions), context(launcherOptions)]); for (const ctx of contexts) await ctx.watch(); }
else { await Promise.all([build(options), build(terminalOptions), build(launcherOptions)]); }
