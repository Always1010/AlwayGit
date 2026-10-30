import { cp, rm, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const targets = new Set([
  'win32-x64',
  'win32-arm64',
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
]);

/** The release README links to repository docs while retaining the existing SVG card. */
export function releaseReadme(contents) {
  return contents.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (match, image, label, link) => {
    if (/^[a-z][a-z\d+.-]*:/i.test(link) || link.startsWith('#')) return match;
    const base = image
      ? 'https://github.com/Always1010/AlwayGit/raw/main/'
      : 'https://github.com/Always1010/AlwayGit/blob/main/';
    return `${image}[${label}](${base}${path.posix.normalize(link)})`;
  });
}

export function nativeTarget(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;
  if (!targets.has(target)) throw new Error(`Unsupported build platform: ${target}.`);
  if (
    platform === 'linux' &&
    platform === process.platform &&
    !process.report.getReport().header.glibcVersionRuntime
  ) {
    throw new Error('Linux packages require glibc; Alpine/musl builds are not supported.');
  }
  return target;
}

export function packageTarget(args, host = nativeTarget()) {
  if (args.length && (args.length !== 2 || args[0] !== '--target')) {
    throw new Error('Usage: node scripts/package.mjs [--target <platform-architecture>]');
  }
  const target = args[1] ?? host;
  if (target !== host)
    throw new Error(
      `Build ${target} on a ${target} machine; this machine is ${host}. --target does not cross-compile node-pty.`,
    );
  return target;
}

export function verifyPackageIdentity(manifest, identity, expected, target) {
  for (const field of ['publisher', 'name', 'version']) {
    if (manifest[field] !== expected[field])
      throw new Error(`Packaged ${field} differs from the project.`);
  }
  if (identity?.TargetPlatform !== target) throw new Error(`VSIX target does not match ${target}.`);
  if (
    identity.Id !== expected.name ||
    identity.Publisher !== expected.publisher ||
    identity.Version !== expected.version
  ) {
    throw new Error('VSIX XML identity differs from the project.');
  }
  if (manifest.extensionKind?.length !== 1 || manifest.extensionKind[0] !== 'workspace')
    throw new Error('VSIX must run in the workspace extension host.');
}

export function nativeRuntimeFiles(target) {
  if (!targets.has(target)) throw new Error(`Unsupported build platform: ${target}.`);
  return target.startsWith('win32-')
    ? [
        'conpty.node',
        'conpty_console_list.node',
        'pty.node',
        'winpty-agent.exe',
        'winpty.dll',
        'conpty/conpty.dll',
        'conpty/OpenConsole.exe',
      ]
    : // node-pty only builds and uses spawn-helper on macOS; Linux uses forkpty.
      target.startsWith('darwin-')
      ? ['pty.node', 'spawn-helper']
      : ['pty.node'];
}

function runtimeFileAllowed(relative, target) {
  return (
    ['package.json', 'LICENSE', 'deps/winpty/LICENSE'].includes(relative) ||
    (/^lib\/(?:[\w.-]+\/)*[\w.-]+\.js$/.test(relative) && !/\.(?:test|spec)\.js$/.test(relative)) ||
    nativeRuntimeFiles(target).some((file) => relative === `prebuilds/${target}/${file}`)
  );
}

const releaseFiles = [
  'package.json',
  'readme.md',
  'package.nls.json',
  'package.nls.zh-cn.json',
  'media/alwaygit.svg',
  'dist/extension.cjs',
  'dist/terminal-host.cjs',
  'dist/askpass.cjs',
  'dist/askpass.sh',
  'dist/launcher/launcher.js',
  'dist/launcher/launcher.css',
  'dist/webview/index.html',
];

/** Reject release leaks and missing entry points before replacing the fixed VSIX. */
export function verifyPackageContents(files, target) {
  const runtimePrefix = 'dist/terminal-runtime/node-pty/';
  const seen = new Set();
  for (const file of files) {
    if (seen.has(file)) throw new Error(`Duplicate VSIX entry: ${file}.`);
    seen.add(file);
    if (['extension.vsixmanifest', '[Content_Types].xml'].includes(file)) continue;
    const relative = file.startsWith('extension/') ? file.slice('extension/'.length) : '';
    if (
      releaseFiles.includes(relative) ||
      (/^dist\/webview\/assets\/[\w.-]+\.(?:js|css|ttf|png)$/.test(relative) &&
        !/\.(?:test|spec)\.js$/.test(relative)) ||
      (relative.startsWith(runtimePrefix) &&
        runtimeFileAllowed(relative.slice(runtimePrefix.length), target))
    )
      continue;
    throw new Error(`Unexpected release file: ${file}.`);
  }
  const required = [
    ...releaseFiles,
    `${runtimePrefix}package.json`,
    `${runtimePrefix}LICENSE`,
    `${runtimePrefix}lib/index.js`,
    ...nativeRuntimeFiles(target).map((file) => `${runtimePrefix}prebuilds/${target}/${file}`),
  ];
  if (target.startsWith('win32-'))
    required.push(
      `${runtimePrefix}deps/winpty/LICENSE`,
      `${runtimePrefix}lib/worker/conoutSocketWorker.js`,
      `${runtimePrefix}lib/conpty_console_list_agent.js`,
    );
  for (const file of required) {
    if (!seen.has(`extension/${file}`)) throw new Error(`Missing release file: ${file}.`);
  }
}

async function isFile(file) {
  try {
    return (await stat(file)).isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/** Copy one complete native layout plus runtime JS; never retain a stale build. */
export async function copyTerminalRuntime(source, destination, target = nativeTarget()) {
  const nativeFiles = nativeRuntimeFiles(target);
  // Respect node-pty's Release preference, then fall back to target prebuilds.
  let nativeDirectory;
  for (const directory of ['build/Release', `prebuilds/${target}`]) {
    if (
      (
        await Promise.all(nativeFiles.map((file) => isFile(path.join(source, directory, file))))
      ).every(Boolean)
    ) {
      nativeDirectory = path.join(source, directory);
      break;
    }
  }
  if (!nativeDirectory) throw new Error(`No complete node-pty runtime for ${target}.`);
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const file of [
    'package.json',
    'LICENSE',
    ...(target.startsWith('win32-') ? ['deps/winpty/LICENSE'] : []),
  ]) {
    await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
    await cp(path.join(source, file), path.join(destination, file));
  }
  await cp(path.join(source, 'lib'), path.join(destination, 'lib'), {
    recursive: true,
    filter: async (entry) => {
      const relative = path.relative(source, entry).split(path.sep).join('/');
      return (await stat(entry)).isDirectory() || runtimeFileAllowed(relative, target);
    },
  });
  const nativeDestination = path.join(destination, 'prebuilds', target);
  for (const file of nativeFiles) {
    await mkdir(path.dirname(path.join(nativeDestination, file)), { recursive: true });
    await cp(path.join(nativeDirectory, file), path.join(nativeDestination, file));
  }
  // Loading from the copy also catches missing native files and incompatible binaries.
  const runtime = createRequire(import.meta.url)(path.resolve(destination));
  if (typeof runtime.spawn !== 'function')
    throw new Error('The copied node-pty runtime cannot create a terminal.');
}
