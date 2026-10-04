import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareTags, validateTag } from './repository-stats.mjs';

export async function checkDeployment(stats, { token, siteUrl, request = fetch }) {
  validateTag(stats.tag);
  const api = async endpoint => {
    const response = await request(`https://api.github.com/repos/${stats.repository}/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub API ${endpoint}: HTTP ${response.status}.`);
    return response.json();
  };
  // The retained summary must originate from the tag-triggered release workflow,
  // not an unrelated run with a similarly named artifact.
  const run = await api(`actions/runs/${stats.runId}`);
  if (run.head_sha !== stats.commit || run.event !== 'push' || run.path?.split('@')[0] !== '.github/workflows/release.yml') {
    throw new Error('Test summary provenance does not match a tag-triggered Release VSIX run.');
  }
  const release = await api(`releases/tags/${encodeURIComponent(stats.tag)}`);
  if (release.draft || release.prerelease || !release.published_at) throw new Error('Statistics require a published stable Release.');
  let newest = stats.tag;
  for (let page = 1; ; page++) {
    const releases = await api(`releases?per_page=100&page=${page}`);
    for (const candidate of releases) {
      if (candidate.draft || candidate.prerelease || !candidate.published_at) continue;
      try { validateTag(candidate.tag_name); } catch { continue; }
      if (compareTags(candidate.tag_name, newest) > 0) newest = candidate.tag_name;
    }
    if (releases.length < 100) break;
  }
  if (newest !== stats.tag) return { deploy: false, reason: `${stats.tag} is older than published Release ${newest}; keeping the newer version.` };
  const url = new URL('repository-stats.json', siteUrl.replace(/\/?$/, '/'));
  if (url.protocol !== 'https:') throw new Error('Pages URL must use HTTPS.');
  // Do not send the GitHub API token to the public Pages host.
  const deployedResponse = await request(url, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
  if (deployedResponse.ok) {
    const deployed = await deployedResponse.json();
    if (deployed.schemaVersion !== 1 || deployed.repository !== stats.repository) throw new Error('Existing Pages content belongs to a different statistics site.');
    if (compareTags(deployed.tag, stats.tag) > 0) return { deploy: false, reason: `Pages already displays ${deployed.tag}; refusing to replace it with ${stats.tag}.` };
  } else if (deployedResponse.status !== 404) {
    throw new Error(`Could not verify existing Pages statistics: HTTP ${deployedResponse.status}.`);
  }
  return { deploy: true, reason: `Publishing statistics for ${stats.tag}.` };
}

async function main() {
  const [statsPath, siteUrl] = process.argv.slice(2);
  if (!statsPath || !siteUrl || !process.env.GH_TOKEN) throw new Error('Usage: GH_TOKEN=… node scripts/repository-stats-deploy.mjs <statistics.json> <Pages base URL>');
  const stats = JSON.parse(await readFile(statsPath, 'utf8'));
  const decision = await checkDeployment(stats, { token: process.env.GH_TOKEN, siteUrl });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `deploy=${decision.deploy}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${decision.reason}\n`);
  console.log(decision.reason);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
