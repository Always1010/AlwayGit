import type { PublishedRef, PushResult } from '../protocol/types';
import { hostingRepository, refWebUrl, releaseWebUrl, remoteRequestUrl } from '../protocol/hosting';
import { redactSecrets } from '../application/logging';

/** Git's stable --porcelain output records the actual destination and each remote ref. */
export function parsePushResult(stdout: string, stderr: string, code: number, remote?: string, localBranch?: string, configuredDestinations: string[] = []): PushResult {
  const destinations: PushResult['destinations'] = [];
  const key = (url: string) => hostingRepository(url)?.url ?? url.replace(/\\/g, '/').replace(/\/$/, '');
  const reported = new Set<string>();
  let destination: PushResult['destinations'][number] | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const target = /^To (.*)$/.exec(line);
    if (target) {
      const raw = target[1], repository = hostingRepository(raw);
      reported.add(key(raw));
      destination = { label: repository?.label ?? redactSecrets(raw), ...(repository ? { repository } : {}), refs: [] };
      destinations.push(destination); continue;
    }
    const match = /^([ *=+!\-])\t([^\t]*):(refs\/(heads|tags)\/(.+))\t/.exec(line);
    if (!destination || !match) continue;
    const kind = match[4] === 'heads' ? 'branch' : 'tag', name = match[5];
    if (!localBranch && kind === 'branch' && match[2].startsWith('refs/heads/')) localBranch = match[2].slice('refs/heads/'.length);
    const status: PublishedRef['status'] = match[1] === '*' ? 'published' : match[1] === '=' ? 'up-to-date' : match[1] === '-' ? 'deleted' : match[1] === '!' ? 'rejected' : 'updated';
    destination.refs.push({ kind, name, status });
  }
  for (const url of configuredDestinations) if (!reported.has(key(url))) {
    const repository = hostingRepository(url);
    destinations.push({ label: repository?.label ?? redactSecrets(url), repository, refs: [], unconfirmed: true });
  }
  for (const destination of destinations) {
    const repository = destination.repository; if (!repository) continue;
    const branches = destination.refs.filter(ref => ref.kind === 'branch' && !['deleted', 'rejected'].includes(ref.status));
    for (const ref of destination.refs) {
      if (['deleted', 'rejected'].includes(ref.status)) continue;
      const requestUrl = ref.kind === 'branch' ? remoteRequestUrl(`${stdout}\n${stderr}`, repository, ref.name, branches.length === 1) : undefined;
      if (requestUrl && !repository.provider) repository.provider = 'gitlab';
      ref.url = refWebUrl(repository, ref.kind, ref.name);
      ref.requestUrl = requestUrl;
      if (requestUrl) ref.requestKind = /\/(?:pull|merge_requests)\/\d+$/.test(new URL(requestUrl).pathname) ? 'view' : 'create';
      if (ref.kind === 'tag') ref.releaseUrl = releaseWebUrl(repository, ref.name);
    }
  }
  const changed = destinations.some(destination => destination.refs.some(ref => ['published', 'updated', 'deleted'].includes(ref.status)));
  return { kind: 'push', outcome: code ? changed ? 'partial' : 'error' : 'success', remote, localBranch, destinations,
    ...(code ? { error: redactSecrets(stderr.trim() || stdout.trim()) } : {}), output: redactSecrets(`${stdout}\n${stderr}`).trim().slice(0, 16000) };
}

/** Preserve each destination's confirmed refs across a sequence of Tag commands. */
export function combinePushResults(results: PushResult[], remote: string, failures: string[] = []): PushResult {
  const destinations = new Map<string, PushResult['destinations'][number]>();
  for (const result of results) for (const destination of result.destinations) {
    const key = destination.repository?.url ?? destination.label;
    const previous = destinations.get(key);
    if (previous) {
      previous.refs.push(...destination.refs);
      if (destination.unconfirmed) previous.unconfirmed = true;
    } else destinations.set(key, { ...destination, refs: [...destination.refs] });
  }
  const failed = failures.length > 0 || results.some(result => result.outcome !== 'success');
  const confirmed = [...destinations.values()].some(destination => destination.refs.some(ref => !['rejected', 'deleted'].includes(ref.status)));
  const errors = [...new Set([...failures, ...results.flatMap(result => result.error ? [result.error] : [])])].map(redactSecrets);
  return { kind: 'push', remote, outcome: failed ? confirmed ? 'partial' : 'error' : 'success', destinations: [...destinations.values()],
    ...(errors.length ? { error: errors.join('\n') } : {}), output: results.map(result => result.output).filter(Boolean).join('\n').slice(0, 16000) };
}
