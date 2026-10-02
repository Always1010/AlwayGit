import type { Repository } from './types';

// Git and VS Code can spell the same Windows path with different case/separators.
export const pathKey = (value: string) => {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//') ? normalized.toLowerCase() : normalized;
};
export const repositoryGroupKey = (repo: Repository): string => pathKey(repo.commonDir);
export interface RepositoryGroup { key: string; name: string; repository: Repository; members: Repository[]; collectionId?: string }

/** Group display entries without changing working-directory IDs or action targets. */
export function groupRepositories(repositories: Repository[], activeId?: string): RepositoryGroup[] {
  const groups = new Map<string, Repository[]>();
  for (const repo of repositories) {
    const key = repositoryGroupKey(repo), members = groups.get(key);
    if (members) members.push(repo); else groups.set(key, [repo]);
  }
  return [...groups].map(([key, members]) => {
    const mainRoot = members.find(repo => repo.mainRoot)?.mainRoot;
    const main = mainRoot && members.find(repo => pathKey(repo.root) === pathKey(mainRoot));
    const representative = main || members[0];
    const repository = members.find(repo => repo.id === activeId) ?? representative;
    const name = mainRoot?.replace(/\\/g, '/').replace(/\/+$/, '').split('/').at(-1) || representative.name;
    const collectionId = members.find(repo => repo.collectionId)?.collectionId;
    return { key, name, repository, members, ...(collectionId ? { collectionId } : {}) };
  });
}
