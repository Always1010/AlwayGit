import { access, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

async function executable(filename, platform) {
  try {
    await access(filename, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return (await stat(filename)).isFile();
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return false;
    throw error;
  }
}

export async function cliCandidates(command, env, platform) {
  const paths =
    path.isAbsolute(command) || /[/\\]/.test(command)
      ? [path.resolve(command)]
      : (env.PATH ?? '')
          .split(path.delimiter)
          .filter(Boolean)
          .map((directory) => path.join(directory.replace(/^"|"$/g, ''), command));
  const suffixes =
    platform === 'win32' && !path.extname(command)
      ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')]
      : [''];
  const found = [];
  for (const filename of paths)
    for (const suffix of suffixes) {
      if (await executable(filename + suffix, platform)) found.push(filename + suffix);
    }
  return [...new Set(found)];
}

async function serverMetadata(root, platform) {
  try {
    const product = JSON.parse(await readFile(path.join(root, 'product.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    // Recognize Microsoft's server layout, not an unrelated executable called code-server.
    if (
      product.serverApplicationName !== 'code-server' ||
      !/^\.vscode-server(?:-insiders)?$/.test(product.serverDataFolderName) ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version ?? '')
    )
      return;
    await access(path.join(root, 'out/server-main.js'));
    const codePath = path.join(
      root,
      'bin',
      platform === 'win32' ? 'code-server.cmd' : 'code-server',
    );
    if (!(await executable(codePath, platform))) return;
    return { root, codePath, version: manifest.version, dataFolder: product.serverDataFolderName };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code) || error instanceof SyntaxError)
      return;
    throw error;
  }
}

async function serverForCli(filename, platform) {
  let directory = path.dirname(await realpath(filename));
  for (let level = 0; level < 4; level++) {
    const metadata = await serverMetadata(directory, platform);
    if (metadata) return metadata;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}

async function isServerCli(filename, platform) {
  const resolved = await realpath(filename);
  return (
    /[/\\]remote-cli[/\\]/.test(resolved) ||
    /^code-server(?:\.(?:cmd|bat|exe))?$/i.test(path.basename(resolved)) ||
    Boolean(await serverForCli(filename, platform))
  );
}

async function directories(root) {
  try {
    return (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return [];
    throw error;
  }
}

const versionParts = (value) => value.split(/[.-]/).slice(0, 3).map(Number);
const compareVersions = (left, right) => {
  const a = versionParts(left),
    b = versionParts(right);
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
};

async function probe(candidate, { run, root, env, host, checkVersion }) {
  const options = { cwd: root, env: candidate.cliEnv ?? env, capture: true, timeoutMs: 15000 };
  const help = await run(candidate.codePath, ['--help'], options);
  if (
    !['--install-extension', '--list-extensions', '--show-versions'].every((flag) =>
      help.includes(flag),
    )
  ) {
    throw new Error(`选定的 CLI 不支持扩展安装及版本核对：${candidate.codePath}`);
  }
  const versionOutput = await run(candidate.codePath, ['--version'], options);
  if (
    !versionOutput.split(/\r?\n/).some((line) => /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(line.trim()))
  ) {
    throw new Error(`无法读取 VS Code 版本：${candidate.codePath}。`);
  }
  if (candidate.serverDataDir) {
    const arch = versionOutput
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => ['arm64', 'x64', 'arm'].includes(line));
    if (arch && arch !== host.split('-').at(-1))
      throw new Error(`VS Code Server 架构 ${arch} 与当前机器 ${host} 不匹配。`);
    if (!help.includes('--server-data-dir') || !help.includes('--extensions-dir')) {
      throw new Error('VS Code Server CLI 不支持明确指定数据目录和扩展目录，无法保证安装位置。');
    }
    checkVersion?.(versionOutput, candidate.codePath);
  }
  return { ...candidate, help, versionOutput };
}

export async function resolveInstallTarget(
  installTo,
  { requestedCli, previous = {}, env, home, platform, host, run, root, checkVersion },
) {
  if (!['desktop', 'server'].includes(installTo))
    throw new Error(`不支持的安装位置：${installTo}。`);
  const context = { env, home, platform, host, run, root, checkVersion };
  const explicit = requestedCli ? (await cliCandidates(requestedCli, env, platform))[0] : undefined;
  if (requestedCli && !explicit) throw new Error(`找不到可执行的 VS Code CLI：${requestedCli}。`);

  if (installTo === 'desktop') {
    const cliEnv = { ...env };
    for (const key of [
      'VSCODE_IPC_HOOK_CLI',
      'VSCODE_CLIENT_COMMAND',
      'VSCODE_CLIENT_COMMAND_CWD',
      'VSCODE_CLI_AUTHORITY',
      'VSCODE_AGENT_FOLDER',
    ])
      delete cliEnv[key];
    if (explicit && (await isServerCli(explicit, platform)))
      throw new Error(
        '选择了桌面 VS Code，但指定的 CLI 属于 VS Code Server。请使用 --install-to server。',
      );
    const recorded = previous.codePath ? await cliCandidates(previous.codePath, env, platform) : [];
    const known =
      platform === 'linux'
        ? ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code']
        : platform === 'darwin'
          ? ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code']
          : [
              env.LOCALAPPDATA &&
                path.join(env.LOCALAPPDATA, 'Programs/Microsoft VS Code/bin/code.cmd'),
              env.ProgramFiles && path.join(env.ProgramFiles, 'Microsoft VS Code/bin/code.cmd'),
            ].filter(Boolean);
    const candidates = explicit
      ? [explicit]
      : [...recorded, ...(await cliCandidates('code', env, platform)), ...known];
    for (const codePath of [...new Set(candidates)]) {
      if ((await executable(codePath, platform)) && !(await isServerCli(codePath, platform))) {
        return probe({ codePath, installTo, cliArgs: [], cliEnv }, context);
      }
    }
    throw new Error(
      '找不到当前机器的桌面 VS Code。可选择 --install-to server；脚本不会自动切换安装位置。',
    );
  }

  const dataDirectory = (metadata) =>
    path.resolve(env.VSCODE_AGENT_FOLDER || path.join(home, metadata.dataFolder));
  const asCandidate = (metadata, dataDir = dataDirectory(metadata)) => ({
    ...metadata,
    installTo,
    serverDataDir: dataDir,
    extensionsDir: path.join(dataDir, 'extensions'),
    cliArgs: ['--server-data-dir', dataDir, '--extensions-dir', path.join(dataDir, 'extensions')],
  });
  if (explicit) {
    const metadata = await serverForCli(explicit, platform);
    if (!metadata)
      throw new Error('选择了 VS Code Server，但指定的 CLI 不属于可识别的官方 Server 安装。');
    return probe(asCandidate(metadata), context);
  }

  // A live VS Code terminal identifies its server through its own PATH. Plain SSH
  // alone is deliberately not treated as a VS Code session.
  if (env.VSCODE_IPC_HOOK_CLI || env.VSCODE_CLIENT_COMMAND) {
    for (const filename of await cliCandidates('code', env, platform)) {
      const metadata = await serverForCli(filename, platform);
      if (metadata) return probe(asCandidate(metadata), context);
    }
  }

  const dataDirs = [
    ...new Set(
      [
        env.VSCODE_AGENT_FOLDER,
        path.join(home, '.vscode-server'),
        path.join(home, '.vscode-server-insiders'),
      ]
        .filter(Boolean)
        .map((value) => path.resolve(value)),
    ),
  ];
  for (const dataDir of dataDirs) {
    const roots = [
      ...(await directories(path.join(dataDir, 'bin'))),
      ...(await directories(path.join(dataDir, 'cli/servers'))).map((directory) =>
        path.join(directory, 'server'),
      ),
    ];
    const candidates = (
      await Promise.all(roots.map((directory) => serverMetadata(directory, platform)))
    )
      .filter(Boolean)
      .sort(
        (a, b) => compareVersions(b.version, a.version) || a.codePath.localeCompare(b.codePath),
      );
    for (const metadata of candidates) {
      try {
        return await probe(
          asCandidate(
            metadata,
            env.VSCODE_AGENT_FOLDER ? path.resolve(env.VSCODE_AGENT_FOLDER) : dataDir,
          ),
          context,
        );
      } catch (error) {
        context.lastError = error;
      }
    }
  }
  throw new Error(
    `找不到可用的官方 VS Code Server。请先通过 VS Code Remote SSH 连接这台机器以准备 Server；脚本不会自动安装 Server 或切换到桌面版。${context.lastError ? `\n${context.lastError.message}` : ''}`,
  );
}
