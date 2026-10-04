import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const languageByExtension = new Map([
  ['.ts', 'TypeScript'], ['.tsx', 'TypeScript'],
  ['.js', 'JavaScript'], ['.jsx', 'JavaScript'], ['.mjs', 'JavaScript'], ['.cjs', 'JavaScript'],
  ['.css', 'CSS'], ['.html', 'HTML'], ['.ps1', 'PowerShell'], ['.sh', 'Shell'],
]);
const colors = ['#3178c6', '#e2b93b', '#9467d7', '#e66a48', '#4a9e90', '#789044'];
const xml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const count = value => Number(value).toLocaleString('en-US');
const percentage = value => value > 0 && value < 0.1 ? '<0.1%' : `${value.toFixed(1)}%`;
const git = (args, cwd = root, encoding = 'utf8') => execFileSync('git', args, { cwd, encoding, maxBuffer: 32 * 1024 * 1024 });

export function validateTag(tag) {
  if (!stableTag.test(tag)) throw new Error(`Expected a stable version tag vMAJOR.MINOR.PATCH, received ${tag}.`);
  return tag.slice(1);
}

export function compareTags(left, right) {
  validateTag(left);
  validateTag(right);
  const a = left.slice(1).split('.').map(BigInt);
  const b = right.slice(1).split('.').map(BigInt);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function summarizeTests(report) {
  if (report.success !== true || !Array.isArray(report.testResults)) throw new Error('Only successful Vitest JSON reports can be published.');
  const tests = { total: 0, passed: 0, skipped: 0, todo: 0, files: report.testResults.length };
  for (const file of report.testResults) {
    if (!Array.isArray(file.assertionResults) || file.status === 'failed') throw new Error('Incomplete or failed Vitest test file.');
    for (const assertion of file.assertionResults) {
      const field = { passed: 'passed', pending: 'skipped', skipped: 'skipped', todo: 'todo' }[assertion.status];
      if (!field) throw new Error(`Unsupported or unsuccessful test status: ${assertion.status}.`);
      tests[field]++;
      tests.total++;
    }
  }
  if (!tests.total || tests.total !== report.numTotalTests || tests.passed !== report.numPassedTests || report.numFailedTests !== 0) {
    throw new Error('Vitest report totals do not match individual test cases, or no tests were collected.');
  }
  return tests;
}

export function analyzeFiles(files) {
  const types = new Map();
  const languages = new Map();
  let sourceFiles = 0;
  for (const file of files) {
    const basename = path.posix.basename(file.path);
    const extension = path.posix.extname(basename).toLowerCase();
    const type = extension || (basename.startsWith('.') ? basename : '无后缀');
    types.set(type, (types.get(type) ?? 0) + 1);
    // Count all tracked files above; language analysis only includes authored source blobs.
    if (file.mode !== '100644' && file.mode !== '100755') continue;
    if (/^(?:node_modules|dist|artifacts|vendor|coverage)\//.test(file.path)
      || file.path === 'src/i18n/generated.ts' || /(?:^|\/)generated\//.test(file.path)
      || /\.(?:d\.ts|generated\.[^.]+|min\.[^.]+)$/.test(file.path)) continue;
    const language = languageByExtension.get(extension);
    if (!language) continue;
    sourceFiles++;
    const entry = languages.get(language) ?? { name: language, files: 0, bytes: 0 };
    entry.files++;
    entry.bytes += file.bytes;
    languages.set(language, entry);
  }
  const languageBytes = [...languages.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  return {
    totalFiles: files.length,
    sourceFiles,
    languageBytes,
    languages: [...languages.values()].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name)).map(entry => ({
      ...entry, percent: languageBytes ? entry.bytes / languageBytes * 100 : 0,
    })),
    fileTypes: [...types].map(([name, files]) => ({ name, files })).sort((a, b) => b.files - a.files || a.name.localeCompare(b.name)),
  };
}

export function readSnapshot(ref, cwd = root) {
  const commit = git(['rev-parse', '--verify', `${ref}^{commit}`], cwd).trim();
  const manifest = JSON.parse(git(['show', `${commit}:package.json`], cwd));
  const tree = git(['ls-tree', '-r', '-l', '-z', commit], cwd);
  const files = tree.split('\0').filter(Boolean).map(record => {
    const match = /^(\d+) (blob|commit) ([a-f\d]+)\s+(\d+|-)\t([\s\S]+)$/.exec(record);
    if (!match) throw new Error('Unexpected git ls-tree output.');
    if (match[2] !== 'blob') throw new Error('Submodules need an explicit file-count policy before publishing statistics.');
    return { mode: match[1], bytes: Number(match[4]), path: match[5] };
  });
  return { commit, manifest, ...analyzeFiles(files) };
}

export function verifySummary(summary, { tag, commit, repository, runId }) {
  if (summary.schemaVersion !== 1 || summary.tag !== tag || summary.commit !== commit
    || summary.repository !== repository || String(summary.runId) !== String(runId)) {
    throw new Error('Test summary does not belong to the requested tag, commit, repository and release run.');
  }
  const tests = summary.tests;
  if (!tests || !['total', 'passed', 'skipped', 'todo', 'files'].every(field => Number.isSafeInteger(tests[field]) && tests[field] >= 0)
    || !tests.total || !tests.files || tests.passed + tests.skipped + tests.todo !== tests.total) {
    throw new Error('Invalid test summary counts.');
  }
}

export function renderSvg(stats) {
  const types = stats.fileTypes.slice(0, 8);
  if (stats.fileTypes.length > 8) types.push({ name: '其他', files: stats.fileTypes.slice(8).reduce((sum, entry) => sum + entry.files, 0) });
  const languageRows = Math.max(1, Math.ceil(stats.languages.length / 2));
  const typesTop = 298 + languageRows * 30;
  const height = typesTop + types.length * 34 + 108;
  const text = (x, y, value, className = '') => `<text x="${x}" y="${y}" class="${className}">${xml(value)}</text>`;
  let cursor = 32;
  const segments = stats.languages.map((entry, index) => {
    const width = entry.percent / 100 * 736;
    const rect = `<rect x="${cursor}" y="242" width="${width}" height="14" fill="${colors[index % colors.length]}"/>`;
    cursor += width;
    return rect;
  }).join('');
  const legend = stats.languages.map((entry, index) => {
    const x = 32 + index % 2 * 368;
    const y = 283 + Math.floor(index / 2) * 30;
    return `<circle cx="${x + 5}" cy="${y - 5}" r="5" fill="${colors[index % colors.length]}"/>`
      + text(x + 19, y, `${entry.name} ${percentage(entry.percent)} · ${count(entry.files)} 文件`);
  }).join('') || text(32, 283, '该版本没有纳入语言统计的源码');
  const largest = Math.max(1, ...types.map(entry => entry.files));
  const rows = types.map((entry, index) => {
    const y = typesTop + 39 + index * 34;
    return text(32, y, entry.name, 'mono')
      + `<rect x="168" y="${y - 15}" width="520" height="18" rx="4" class="track"/>`
      + `<rect x="168" y="${y - 15}" width="${entry.files / largest * 520}" height="18" rx="4" fill="#3178c6"/>`
      + text(716, y, count(entry.files), 'number');
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${height}" viewBox="0 0 800 ${height}" role="img" aria-labelledby="title description">
<title id="title">AlwayGit ${xml(stats.tag)} 发布版本代码分析</title>
<desc id="description">${xml(`版本 ${stats.tag}，跟踪文件 ${stats.totalFiles}，Vitest 用例 ${stats.tests.total}。语言按自有源码字节数，文件类型按 Git 跟踪文件数统计。`)}</desc>
<style>
text{font:15px "Segoe UI","Microsoft YaHei",sans-serif;fill:#26354a}.muted{fill:#56677c;font-size:13px}.heading{font-size:18px;font-weight:600}.value{font-size:32px;font-weight:700}.mono{font-family:Consolas,monospace}.number{text-anchor:end;font-weight:600}.panel{fill:#f2f5fa}.track{fill:#e7edf5}
</style>
<rect x="1" y="1" width="798" height="${height - 2}" rx="16" fill="#fff" stroke="#d7e0ec"/>
${text(32, 40, 'AlwayGit · 发布版本代码分析', 'heading')}
${text(32, 69, stats.tag, 'mono')}${text(450, 69, `Commit ${stats.commit.slice(0, 12)}`, 'muted mono')}
<rect x="32" y="90" width="352" height="106" rx="10" class="panel"/>
<rect x="400" y="90" width="368" height="106" rx="10" class="panel"/>
${text(50, 116, 'Git 跟踪文件总数', 'muted')}${text(50, 157, count(stats.totalFiles), 'value')}
${text(50, 180, `自有源码 ${count(stats.sourceFiles)} 文件 · ${stats.languages.length} 种语言`, 'muted')}
${text(418, 116, 'Vitest 测试用例', 'muted')}${text(418, 157, count(stats.tests.total), 'value')}
${text(418, 180, `通过 ${count(stats.tests.passed)} · 跳过 ${count(stats.tests.skipped)} · 待实现 ${count(stats.tests.todo)}`, 'muted')}
${text(32, 226, '语言占比 · 按自有源码字节数', 'heading')}${segments}${legend}
${text(32, typesTop, '文件类型 · 按文件数量', 'heading')}${rows}
${text(32, height - 48, '统计该 Tag 的 Git 快照；生成代码仅计入文件分析。', 'muted')}
${text(32, height - 25, '测试来自该次发布的 Vitest 运行；不包含桌面 / UI 测试。', 'muted')}
</svg>\n`;
}

export function renderHtml(stats) {
  const table = (heading, columns, rows) => `<section><h2>${heading}</h2><div class="table"><table><thead><tr>${columns.map(value => `<th>${xml(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${xml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  const releaseUrl = `https://github.com/${stats.repository}/releases/tag/${encodeURIComponent(stats.tag)}`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AlwayGit ${xml(stats.tag)} 代码分析</title>
<style>body{max-width:900px;margin:40px auto;padding:0 20px;font:16px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:#26354a;background:#fff}a{color:#2465a9}img{width:100%;height:auto}.table{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 14px;border-bottom:1px solid #d7e0ec}th{background:#f2f5fa}code{overflow-wrap:anywhere}footer{margin:32px 0;color:#56677c}</style></head>
<body><h1>AlwayGit · 发布版本代码分析</h1><p><a href="${xml(releaseUrl)}">${xml(stats.tag)} Release</a> · Commit <code>${xml(stats.commit)}</code></p>
<img src="repository-stats.svg" alt="${xml(`AlwayGit ${stats.tag} 语言、文件和测试统计`)}">
${table('语言分析', ['语言', '源码文件数', '源码字节数', '占比'], stats.languages.map(entry => [entry.name, count(entry.files), count(entry.bytes), percentage(entry.percent)]))}
${table('全部文件类型', ['类型', '文件数量'], stats.fileTypes.map(entry => [entry.name, count(entry.files)]))}
${table('Vitest 测试用例', ['总数', '通过', '跳过', '待实现', '测试文件'], [[stats.tests.total, stats.tests.passed, stats.tests.skipped, stats.tests.todo, stats.tests.files].map(count)])}
<footer>文件来自该 Tag 的 Git 快照，包括配置、文档、图片及生成代码，不包括依赖安装与构建产物。语言按自有源码字节数统计，包含源码、测试与维护脚本；排除声明文件、已识别的生成代码、第三方代码、数据与文档。JSON、Markdown、SVG 不归入编程语言；TypeScript 合并 .ts/.tsx，JavaScript 合并 .js/.jsx/.mjs/.cjs。测试复用该次发布的 Vitest 报告，参数化用例分别计数，分组不计数，不代表覆盖率或桌面/UI 验证。图卡显示主要类型，表格列出全部类型。</footer>
</body></html>\n`;
}

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!args[index].startsWith('--') || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error('Options require --name value pairs.');
    result[args[index].slice(2)] = args[index + 1];
  }
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const [command, ...rest] = args;
  const opts = options(rest);
  const version = validateTag(opts.tag);
  const snapshot = readSnapshot(command === 'summarize-tests' ? 'HEAD' : opts.tag);
  if (snapshot.manifest.version !== version) throw new Error('Tag and package.json versions do not match.');
  if (!opts.repository || !/^[\w.-]+\/[\w.-]+$/.test(opts.repository) || !/^\d+$/.test(opts['run-id'] ?? '')) throw new Error('Expected repository owner/name and numeric release run ID.');
  const identity = { tag: opts.tag, commit: snapshot.commit, repository: opts.repository, runId: opts['run-id'] };
  if (command === 'summarize-tests') {
    const report = JSON.parse(await readFile(opts.report, 'utf8'));
    const summary = { schemaVersion: 1, ...identity, tests: summarizeTests(report) };
    await mkdir(path.dirname(opts.output), { recursive: true });
    await writeFile(opts.output, JSON.stringify(summary, null, 2) + '\n');
    return summary;
  }
  if (command !== 'generate') throw new Error('Expected summarize-tests or generate.');
  const summary = JSON.parse(await readFile(opts.summary, 'utf8'));
  verifySummary(summary, identity);
  const { manifest: _manifest, ...analysis } = snapshot;
  const stats = { schemaVersion: 1, ...identity, ...analysis, tests: summary.tests };
  await mkdir(opts.output, { recursive: true });
  await writeFile(path.join(opts.output, 'repository-stats.svg'), renderSvg(stats));
  await writeFile(path.join(opts.output, 'index.html'), renderHtml(stats));
  await writeFile(path.join(opts.output, 'repository-stats.json'), JSON.stringify(stats, null, 2) + '\n');
  await writeFile(path.join(opts.output, '.nojekyll'), '');
  console.log(`${stats.tag}: ${stats.totalFiles} files, ${stats.languages.length} languages, ${stats.tests.total} Vitest test cases.`);
  return stats;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
