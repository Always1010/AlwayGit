import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const statisticsModule = new URL('../scripts/repository-stats.mjs', import.meta.url).href;
const deploymentModule = new URL('../scripts/repository-stats-deploy.mjs', import.meta.url).href;
const { analyzeFiles, compareTags, readSnapshot, renderHtml, renderSvg, summarizeTests, verifySummary } = await import(statisticsModule);
const { checkDeployment } = await import(deploymentModule);

const identity = { tag: 'v1.2.3', commit: 'a'.repeat(40), repository: 'owner/repo', runId: '123' };
const report = {
  success: true, numTotalTests: 5, numPassedTests: 3, numFailedTests: 0,
  testResults: [{ status: 'passed', assertionResults: [
    { status: 'passed', fullName: 'nested suite parameter 1' },
    { status: 'passed', fullName: 'nested suite parameter 2' },
    { status: 'passed', fullName: 'nested suite parameter 3' },
    { status: 'pending', fullName: 'skipped test' },
    { status: 'todo', fullName: 'future test' },
  ] }],
};
const published = (tag: string) => ({ tag_name: tag, draft: false, prerelease: false, published_at: '2026-10-05T00:00:00Z' });

describe('Release repository statistics', () => {
  it('counts runtime test cases, including parameterization, without counting suites or accepting failed/incomplete reports', () => {
    expect(summarizeTests(report)).toEqual({ total: 5, passed: 3, skipped: 1, todo: 1, files: 1 });
    for (const invalid of [{ ...report, success: false }, { ...report, numTotalTests: 6 }, { ...report, numFailedTests: 1 }]) {
      expect(() => summarizeTests(invalid)).toThrow();
    }
    expect(() => summarizeTests({ ...report, testResults: [{ assertionResults: [{ status: 'failed' }] }] })).toThrow();
  });

  it('keeps full file counts while merging source languages and excluding generated, declaration and linked source', () => {
    const files = [
      ['src/main.ts', 30], ['webview/App.tsx', 70], ['scripts/build.mjs', 50], ['scripts/old.cjs', 50],
      ['src/i18n/generated.ts', 10000], ['src/types.d.ts', 1000], ['vendor/copy.ts', 5000],
      ['README.md', 200], ['package-lock.json', 10000], ['.gitignore', 10], ['LICENSE', 10],
      ['docs/image.png', 500], ['src/link.ts', 20], ['docs/文件\t名.md', 50],
    ].map(([file, bytes]) => ({ path: file, bytes, mode: file === 'src/link.ts' ? '120000' : '100644' }));
    const stats = analyzeFiles(files);
    expect(stats.totalFiles).toBe(14);
    expect(stats.fileTypes.reduce((sum: number, entry: { files: number }) => sum + entry.files, 0)).toBe(14);
    expect(stats.sourceFiles).toBe(4);
    expect(stats.languages).toEqual([
      { name: 'JavaScript', files: 2, bytes: 100, percent: 50 },
      { name: 'TypeScript', files: 2, bytes: 100, percent: 50 },
    ]);
    expect(stats.fileTypes).toContainEqual({ name: '.gitignore', files: 1 });
    expect(stats.fileTypes).toContainEqual({ name: '无后缀', files: 1 });
  });

  it('reads committed blob sizes and paths from a tag, ignoring later commits and dirty or untracked files', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'alwaygit-repo-statistics-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8' }).trim();
    try {
      git('init', '--quiet');
      await mkdir(path.join(fixture, 'src'));
      await writeFile(path.join(fixture, 'package.json'), '{"version":"1.2.3"}\n');
      await writeFile(path.join(fixture, 'src/中文 文件.ts'), 'const x = 1;\n');
      git('add', '.');
      const author = ['-c', 'user.name=Statistics test', '-c', 'user.email=statistics@example.invalid', '-c', `core.hooksPath=${path.join(fixture, '.no-hooks')}`];
      git(...author, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
      git(...author, '-c', 'tag.gpgSign=false', 'tag', '-a', 'v1.2.3', '-m', 'fixture');
      const commit = git('rev-parse', 'HEAD');
      await writeFile(path.join(fixture, 'src/中文 文件.ts'), 'dirty text');
      await writeFile(path.join(fixture, 'src/untracked.ts'), 'not in tag');
      const stats = readSnapshot('v1.2.3', fixture);
      expect(stats.commit).toBe(commit);
      expect(stats.totalFiles).toBe(2);
      expect(stats.languages).toEqual([{ name: 'TypeScript', files: 1, bytes: 13, percent: 100 }]);
    } finally {
      if (path.dirname(fixture) !== path.resolve(os.tmpdir()) || !path.basename(fixture).startsWith('alwaygit-repo-statistics-')) throw new Error('Unsafe fixture cleanup path');
      await rm(fixture, { recursive: true, force: true });
    }
  });

  it('binds successful test counts to the exact release tag, commit and original run', () => {
    const summary = { schemaVersion: 1, ...identity, tests: summarizeTests(report) };
    expect(() => verifySummary(summary, identity)).not.toThrow();
    for (const changed of [{ tag: 'v1.2.4' }, { commit: 'b'.repeat(40) }, { runId: '124' }, { repository: 'other/repo' }]) {
      expect(() => verifySummary(summary, { ...identity, ...changed })).toThrow();
    }
    expect(() => verifySummary({ ...summary, tests: { ...summary.tests, total: 6 } }, identity)).toThrow();
    expect(compareTags('v1.10.0', 'v1.9.99')).toBe(1);
    expect(() => compareTags('v1.2.3-beta', 'v1.2.3')).toThrow();
  });

  it('renders deterministic escaped assets and includes all types in the details page', () => {
    const stats = { ...identity, ...analyzeFiles([{ path: 'src/main.ts', mode: '100644', bytes: 100 }]), tests: summarizeTests(report) };
    expect(renderSvg(stats)).toBe(renderSvg(stats));
    expect(renderSvg(stats)).toContain('v1.2.3');
    expect(renderSvg(stats)).toContain('Vitest 测试用例');
    const escaped = { ...stats, fileTypes: [{ name: '<script>&"', files: 1 }] };
    expect(renderSvg(escaped)).toContain('&lt;script&gt;&amp;&quot;');
    expect(renderHtml(escaped)).not.toContain('<script>');
    expect(renderHtml(stats)).toContain('/releases/tag/v1.2.3');
    expect(renderHtml(stats)).toContain('全部文件类型');
  });

  it('checks provenance and all release pages, refuses version rollback, and fails closed on Pages errors', async () => {
    const calls: Array<{ url: string; options: RequestInit }> = [];
    const run = { head_sha: identity.commit, event: 'push', path: '.github/workflows/release.yml' };
    const createRequest = (releases: unknown[], pageStatus = 404, deployed?: unknown, sourceRun = run) => async (url: string | URL, options: RequestInit) => {
      const address = String(url);
      calls.push({ url: address, options });
      let value: unknown;
      let status = 200;
      if (address.includes('/actions/runs/')) value = sourceRun;
      else if (address.includes('/releases/tags/')) value = published(identity.tag);
      else if (address.includes('page=2')) value = [published('v1.10.0')];
      else if (address.includes('/releases?')) value = releases;
      else { status = pageStatus; value = deployed; }
      return { ok: status === 200, status, json: async () => value };
    };
    const opts = { token: 'test-token', siteUrl: 'https://owner.github.io/repo' };
    expect(await checkDeployment(identity, { ...opts, request: createRequest([published(identity.tag)]) })).toMatchObject({ deploy: true });
    const pageCall = calls.find(call => call.url.startsWith(opts.siteUrl))!;
    expect(pageCall.options.headers).toBeUndefined();
    expect(await checkDeployment(identity, { ...opts, request: createRequest(Array.from({ length: 100 }, () => published('v1.0.0'))) })).toMatchObject({ deploy: false });
    expect(await checkDeployment(identity, { ...opts, request: createRequest([published(identity.tag)], 200, { schemaVersion: 1, repository: identity.repository, tag: 'v2.0.0' }) })).toMatchObject({ deploy: false });
    await expect(checkDeployment(identity, { ...opts, request: createRequest([], 503) })).rejects.toThrow('503');
    await expect(checkDeployment(identity, { ...opts, request: createRequest([], 404, undefined, { ...run, head_sha: 'b'.repeat(40) }) })).rejects.toThrow('Release VSIX');
  });
});
