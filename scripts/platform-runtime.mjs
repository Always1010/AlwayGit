import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const targets = new Set(['win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']);

export function nativeTarget(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  if (!targets.has(target)) throw new Error(`Unsupported build platform: ${target}.`);
  if (platform === 'linux' && platform === process.platform && !process.report.getReport().header.glibcVersionRuntime) {
    throw new Error('Linux packages require glibc; Alpine/musl builds are not supported.');
  }
  return target;
}

export function packageTarget(args, host = nativeTarget()) {
  if (args.length && (args.length !== 2 || args[0] !== '--target')) {
    throw new Error('Usage: node scripts/package.mjs [--target <platform-architecture>]');
  }
  const target = args[1] ?? host;
  if (target !== host) throw new Error(`Build ${target} on a ${target} machine; this machine is ${host}. --target does not cross-compile node-pty.`);
  return target;
}

/** Replace the runtime entirely: an earlier native build must never survive a copy. */
export async function copyTerminalRuntime(source, destination, target = nativeTarget()) {
  await rm(destination, { recursive: true, force: true });
  await cp(source, destination, { recursive: true, filter: entry => {
    const relative = path.relative(source, entry).split(path.sep);
    if (relative.some(part => ['src', 'test', 'node_modules', '.github'].includes(part))) return false;
    return relative[0] !== 'prebuilds' || relative.length < 2 || relative[1] === target;
  } });
  // Loading from the copy also catches missing native files and incompatible binaries.
  const runtime = createRequire(import.meta.url)(path.resolve(destination));
  if (typeof runtime.spawn !== 'function') throw new Error('The copied node-pty runtime cannot create a terminal.');
}
