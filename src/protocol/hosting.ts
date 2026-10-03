import type { HostingRepository, PublishedRef } from './types';

export function safeWebUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || /[\u0000-\u0020]/.test(value)) return;
    if ([...url.searchParams.keys()].some(key => /(?:token|password|authorization|secret)/i.test(key))) return;
    return url.href;
  } catch { return; }
}

/** Only public known hosts get platform routes; unknown HTTPS hosts get a repository link. */
export function hostingRepository(value: string): HostingRepository | undefined {
  let url: URL;
  try {
    const scp = /^(?:[^/@:\s]+@)?(github\.com|gitlab\.com):(.+)$/.exec(value);
    url = new URL(scp ? `https://${scp[1]}/${scp[2]}` : value);
    if (url.protocol === 'ssh:' && ['github.com', 'gitlab.com'].includes(url.hostname) && (!url.port || url.port === '22')) {
      url = new URL(`https://${url.hostname}${url.pathname}`);
    }
    if (url.protocol !== 'https:') return;
    url.username = ''; url.password = ''; url.search = ''; url.hash = '';
    url.pathname = url.pathname.replace(/\.git\/?$/, '').replace(/\/$/, '');
    const parts = url.pathname.slice(1).split('/');
    if (parts.length < 2 || parts.some(part => !part || ['.', '..'].includes(decodeURIComponent(part)))) return;
    const provider = !url.port && url.hostname === 'github.com' && parts.length === 2 ? 'github'
      : !url.port && url.hostname === 'gitlab.com' ? 'gitlab' : undefined;
    return { url: url.href.replace(/\/$/, ''), label: `${url.host}${url.pathname}`, ...(provider ? { provider } : {}) };
  } catch { return; }
}

export function refWebUrl(repository: HostingRepository, kind: PublishedRef['kind'], name: string): string | undefined {
  if (!repository.provider) return;
  const ref = encodeURIComponent(name);
  return repository.provider === 'github' ? `${repository.url}/tree/${ref}` : `${repository.url}/-/tree/${ref}`;
}

export function requestWebUrl(source: HostingRepository, branch: string, base?: string, destination = source): string | undefined {
  if (!source.provider || source.provider !== destination.provider || new URL(source.url).host !== new URL(destination.url).host || branch === base && source.url === destination.url) return;
  if (source.provider === 'github') {
    const owner = new URL(source.url).pathname.split('/')[1];
    const head = source.url === destination.url ? branch : `${decodeURIComponent(owner)}:${branch}`;
    return `${destination.url}/compare/${base ? `${encodeURIComponent(base)}...` : ''}${encodeURIComponent(head)}?expand=1`;
  }
  // Fork project IDs require the API; a provider-supplied URL can still be used directly.
  if (source.url !== destination.url) return;
  const params = new URLSearchParams({ 'merge_request[source_branch]': branch });
  if (base) params.set('merge_request[target_branch]', base);
  return `${source.url}/-/merge_requests/new?${params}`;
}

export function releaseWebUrl(repository: HostingRepository, tag: string): string | undefined {
  return repository.provider === 'github' ? `${repository.url}/releases/new?${new URLSearchParams({ tag })}` : undefined;
}

export function remoteRequestUrl(output: string, repository: HostingRepository, branch: string, allowExisting = false): string | undefined {
  for (const match of output.matchAll(/https:\/\/[^\s<>"']+/g)) {
    const value = safeWebUrl(match[0]); if (!value) continue;
    const url = new URL(value), repo = new URL(repository.url);
    if (url.origin !== repo.origin || !url.pathname.startsWith(`${repo.pathname}/`)) continue;
    const route = url.pathname.slice(repo.pathname.length);
    if (allowExisting && (repository.provider === 'github' && /^\/pull\/\d+$/.test(route) || repository.provider !== 'github' && /^\/-\/merge_requests\/\d+$/.test(route))) return value;
    if (repository.provider === 'github' && route.startsWith('/compare/')) {
      const compare = decodeURIComponent(route.slice('/compare/'.length));
      if (compare === branch || compare.endsWith(`...${branch}`)) return value;
    }
    if (repository.provider !== 'github' && route === '/-/merge_requests/new' && url.searchParams.get('merge_request[source_branch]') === branch) return value;
  }
}
