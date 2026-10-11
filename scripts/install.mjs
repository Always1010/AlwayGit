import { access, readFile, mkdir, writeFile, rename, rm, stat } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeTarget, packageTarget } from './platform-runtime.mjs';
import { inspectInstallPackage } from './install-package.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const targets = ['win32-x64', 'linux-x64', 'linux-arm64', 'win32-arm64', 'darwin-x64', 'darwin-arm64'];
const modes = ['build-install', 'install-only', 'package-only'];
const help = `AlwayGit 统一安装脚本（需要已有 Node.js；不会自动安装依赖）

用法：node scripts/install.mjs [选项]
不指定操作时，在交互终端中选择平台和操作。

  --target auto|<平台>  默认自动识别当前机器；目标必须与当前机器一致
                       平台：${targets.join(', ')}
  --build-install      从源码构建、打包并安装
  --install-only       安装已有包，跳过构建；包身份及版本须与项目一致
  --package-only       只打包，不调用 VS Code
  --vsix <路径>        install-only 的包路径，默认 artifacts/alwaygit.vsix
  --code-path <路径>   VS Code CLI，默认使用当前环境中的 code
  --profile <名称>     VS Code Profile；空字符串恢复默认，CLI 必须支持此参数
  --help               显示帮助

Rock 5B：在连接板子的 VS Code Remote SSH 终端运行本脚本。
选择 linux-arm64 不会自动连接远端，也不会交叉编译。
`;

export function parseInstallArgs(args) {
  const options = { target: 'auto' };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    // PowerShell 5 drops empty native arguments; this spelling preserves a reset.
    if (arg.startsWith('--profile=')) { options.profile = arg.slice('--profile='.length); continue; }
    if (modes.some(mode => arg === `--${mode}`)) {
      if (options.mode) throw new Error('只能指定一种操作：--build-install、--install-only 或 --package-only。');
      options.mode = arg.slice(2);
      continue;
    }
    const keys = { '--target': 'target', '--vsix': 'vsix', '--code-path': 'codePath', '--profile': 'profile' };
    const key = Object.hasOwn(keys, arg) ? keys[arg] : undefined;
    if (!key) throw new Error(`未知参数：${arg}。使用 --help 查看用法。`);
    const value = args[++index];
    if (value === undefined || value.startsWith('--') || (!value && key !== 'profile')) throw new Error(`${arg} 缺少参数值。`);
    options[key] = value;
  }
  if (options.target !== 'auto' && !targets.includes(options.target)) throw new Error(`不支持的平台：${options.target}。`);
  if (options.vsix && options.mode && options.mode !== 'install-only') throw new Error('--vsix 只能与 --install-only 配合使用。');
  return options;
}

export async function chooseInstallOptions(options, host, { input = process.stdin, output = process.stdout } = {}) {
  if (options.mode) return options;
  if (!input.isTTY) throw new Error('非交互终端需要指定 --build-install、--install-only 或 --package-only。');
  const prompt = createInterface({ input, output });
  try {
    if (options.target === 'auto') {
      output.write(`当前平台：${host}\n目标平台：\n  1. 自动识别（${host}，推荐）\n${targets.map((target, index) => `  ${index + 2}. ${target}${target === 'linux-arm64' ? '（Rock 5B）' : ''}`).join('\n')}\n`);
      const selected = (await prompt.question('请选择平台 [1]：')).trim() || '1';
      if (!/^[1-7]$/.test(selected)) throw new Error('平台选择无效。');
      options.target = selected === '1' ? host : targets[Number(selected) - 2];
    }
    // Fail before asking for an operation when the selected platform cannot run here.
    packageTarget(['--target', options.target], host);
    output.write('操作：\n  1. 构建、打包并安装\n  2. 安装已有 VSIX\n  3. 只打包\n');
    const selected = (await prompt.question('请选择操作（1/2/3）：')).trim();
    if (!/^[1-3]$/.test(selected)) throw new Error('操作选择无效，请明确选择 1、2 或 3。');
    options.mode = modes[Number(selected) - 1];
    return options;
  } finally {
    prompt.close();
  }
}

export async function resolveCodeCli(command, env = process.env, platform = process.platform) {
  const candidates = path.isAbsolute(command) || /[/\\]/.test(command)
    ? [path.resolve(command)]
    : (env.PATH ?? '').split(path.delimiter).filter(Boolean).map(directory => path.join(directory.replace(/^"|"$/g, ''), command));
  const extensions = platform === 'win32' && !path.extname(command) ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';')] : [''];
  for (const candidate of candidates) {
    for (const extension of extensions) {
      const filename = candidate + extension;
      try {
        await access(filename, platform === 'win32' ? constants.F_OK : constants.X_OK);
        if ((await stat(filename)).isFile()) return filename;
      } catch (error) {
        if (!['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) throw error;
      }
    }
  }
  throw new Error(`找不到可执行的 VS Code CLI：${command}。请在 VS Code 终端运行，或使用 --code-path 指定。`);
}

export function commandInvocation(command, args, platform = process.platform, env = process.env) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(command)) return { command, args, windowsVerbatimArguments: false };
  // .cmd cannot be spawned directly. Quote every argument, disable delayed expansion,
  // and refuse the characters that could escape quotes or expand environment variables.
  if ([command, ...args].some(value => /["%\r\n\0]/.test(value))) throw new Error('Windows CMD 路径或参数不能包含双引号、百分号或换行；请使用其他路径。');
  const quoted = [command, ...args].map(value => `"${value}"`).join(' ');
  return { command: env.ComSpec || 'cmd.exe', args: ['/d', '/v:off', '/s', '/c', `"${quoted}"`], windowsVerbatimArguments: true };
}

export async function runCommand(command, args, { cwd = projectRoot, env = process.env, capture = false } = {}) {
  const invocation = commandInvocation(command, args, process.platform, env);
  return await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd, env, windowsHide: true, windowsVerbatimArguments: invocation.windowsVerbatimArguments,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '', stderr = '', exceeded = false;
    const collect = (chunk, errorOutput) => {
      if (errorOutput) stderr += chunk; else stdout += chunk;
      if (stdout.length + stderr.length > 8 * 1024 * 1024) { exceeded = true; child.kill(); }
    };
    child.stdout?.on('data', chunk => collect(chunk, false));
    child.stderr?.on('data', chunk => collect(chunk, true));
    child.once('error', reject);
    child.once('close', code => {
      if (exceeded) reject(new Error('CLI 输出超过限制。'));
      else if (code !== 0) reject(new Error(`命令失败（${code ?? '终止'}）：${command}\n${stderr || stdout}`));
      else resolve(stdout);
    });
  });
}

// Install-only has no project dependencies. Support the project's stable caret
// range explicitly and reject unknown formats rather than guessing compatibility.
export function assertCodeCompatibility(output, requirement, cli) {
  const actual = output.split(/\r?\n/).map(line => line.trim()).find(line => /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(line));
  const range = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(requirement ?? '');
  if (!actual) throw new Error(`无法读取 VS Code 版本：${cli}。请确认 --code-path 指向正确的 VS Code CLI。`);
  if (!range) throw new Error(`无法校验 VS Code 版本要求：${requirement ?? '缺失'}。安装已停止。`);
  const version = actual.split(/[.-]/).slice(0, 3).map(Number), minimum = range.slice(1).map(Number);
  const upper = minimum[0] > 0 ? [minimum[0] + 1, 0, 0] : minimum[1] > 0 ? [0, minimum[1] + 1, 0] : [0, 0, minimum[2] + 1];
  const compare = (left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  if (compare(version, minimum) < 0 || compare(version, upper) >= 0) {
    throw new Error(`VS Code ${actual} 与扩展要求 ${requirement} 不兼容（CLI：${cli}）。请先更新该 VS Code；Remote SSH 请在已连接的 VS Code 终端运行脚本，或用 --code-path 指定兼容的 CLI。脚本不会自动升级 VS Code。`);
  }
  return actual;
}

async function readRecord(filename) {
  try { return JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, '')); }
  catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`无法读取安装记录 ${filename}：${error.message}`);
  }
}

async function packageHash(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

export async function install(options, { root = projectRoot, host = nativeTarget(), env = process.env, machine = hostname(), run = runCommand, log = console.log } = {}) {
  if (!modes.includes(options.mode)) throw new Error('请指定安装或打包操作。');
  if (options.vsix && options.mode !== 'install-only') throw new Error('--vsix 只能与 --install-only 配合使用。');
  const target = packageTarget(options.target === 'auto' || !options.target ? [] : ['--target', options.target], host);
  const artifacts = path.join(root, 'artifacts');
  const archive = options.vsix ? path.resolve(options.vsix) : path.join(artifacts, 'alwaygit.vsix');
  const recordPath = path.join(artifacts, 'local-install.json');
  const expected = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  log(`平台：${target}；操作：${options.mode}；安装包：${archive}`);
  let cli, profile, context, records, codeVersion;
  if (options.mode !== 'package-only') {
    records = await readRecord(recordPath);
    let defaultCli;
    try { defaultCli = await resolveCodeCli('code', env); }
    catch { /* An explicit or recorded CLI can still be used without code on PATH. */ }
    const remote = Boolean(env.SSH_CONNECTION || env.VSCODE_AGENT_FOLDER || /[/\\]remote-cli[/\\]/.test(defaultCli ?? ''));
    context = JSON.stringify([host, machine, remote ? 'remote' : 'local']);
    // Legacy records came from the Windows-only updater. Never reuse them on Linux.
    const previous = records.contexts?.[context] ?? (host.startsWith('win32-') && !remote && !records.schemaVersion ? records : {});
    const requestedCli = options.codePath || env.ALWAYGIT_CODE_CLI;
    if (requestedCli) cli = await resolveCodeCli(requestedCli, env);
    else if (remote && defaultCli) cli = defaultCli; // Remote CLI paths change when VS Code Server updates.
    else if (previous.codePath) {
      try { cli = await resolveCodeCli(previous.codePath, env); }
      catch { cli = defaultCli; }
    } else cli = defaultCli;
    if (!cli) throw new Error('找不到 VS Code CLI，请在 VS Code 终端运行或使用 --code-path 指定。');
    profile = Object.hasOwn(options, 'profile') ? options.profile : Object.hasOwn(env, 'ALWAYGIT_VSCODE_PROFILE') ? env.ALWAYGIT_VSCODE_PROFILE : previous.profile;
    const cliHelp = await run(cli, ['--help'], { cwd: root, env, capture: true });
    if (!cliHelp.includes('--install-extension') || !cliHelp.includes('--list-extensions') || !cliHelp.includes('--show-versions')) throw new Error('选定的 CLI 不支持扩展安装及版本核对。');
    if (profile && !/(?:^|\s)--profile(?:\s|=|$)/m.test(cliHelp)) throw new Error('当前 VS Code CLI 不支持 --profile；Remote SSH 请使用当前窗口的 Profile，移除该参数或传入 --profile ""。');
    const versionOutput = await run(cli, ['--version'], { cwd: root, env, capture: true });
    codeVersion = assertCodeCompatibility(versionOutput, expected.engines?.vscode, cli);
    log(`VS Code CLI：${cli}；版本：${codeVersion}；环境：${remote ? '远程' : '本地'}；Profile：${profile || '默认/当前窗口'}`);
  }
  if (options.mode !== 'install-only') {
    try {
      await access(path.join(root, 'node_modules/@vscode/vsce/vsce'));
      await access(path.join(root, 'node_modules/node-pty/package.json'));
    } catch {
      throw new Error('缺少项目依赖。请先在目标机器的 AlwayGit 目录执行 npm ci；脚本不会自动安装依赖或工具链。');
    }
    await run(process.execPath, [path.join(root, 'scripts/package.mjs'), '--target', target], { cwd: root, env });
  }
  if (options.mode === 'package-only') { log(`打包完成：${archive}。`); return; }
  const manifest = await inspectInstallPackage(archive, expected, target);
  assertCodeCompatibility(codeVersion, manifest.engines?.vscode, cli);
  const extensionId = `${manifest.publisher}.${manifest.name}`, version = manifest.version;
  const sha256 = await packageHash(archive);
  const profileArgs = profile ? ['--profile', profile] : [];
  log(`正在安装：${extensionId}@${version}`);
  await run(cli, ['--install-extension', archive, '--force', ...profileArgs], { cwd: root, env });
  const installed = await run(cli, ['--list-extensions', '--show-versions', ...profileArgs], { cwd: root, env, capture: true });
  if (!installed.split(/\r?\n/).some(line => line.trim().toLowerCase() === `${extensionId}@${version}`.toLowerCase())) throw new Error('无法核对已安装的扩展版本，不能报告安装成功。');
  if (await packageHash(archive) !== sha256) throw new Error('安装期间 VSIX 发生变化，不能记录为已验证安装。');
  const record = { codePath: cli, profile: profile || '', extensionId, version, target, sha256, installedAt: new Date().toISOString() };
  await mkdir(artifacts, { recursive: true });
  const temporary = `${recordPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ ...record, schemaVersion: 2, contexts: { ...records.contexts, [context]: record } }, null, 2)}\n`, 'utf8');
    await rename(temporary, recordPath);
  } finally { await rm(temporary, { force: true }); }
  log(`已安装并核对：${extensionId}@${version}。方便时重新加载 VS Code 窗口；脚本不会自动重启。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseInstallArgs(process.argv.slice(2));
    if (options.help) console.log(help);
    else await install(await chooseInstallOptions(options, nativeTarget()));
  } catch (error) {
    console.error(`AlwayGit：${error.message}`);
    process.exitCode = 1;
  }
}
