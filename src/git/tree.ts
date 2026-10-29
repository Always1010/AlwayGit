import path from 'node:path';
import { message as localizeMessage } from '../i18n';
import type { RevisionTreeEntry, RevisionTreeListing, RevisionTreeRequest, RevisionTreeSearchPage, RevisionTreeSearchRequest } from '../protocol/tree';
import type { Repository } from '../protocol/types';
import { GitError } from './error';

const MAX_SEARCH_ENTRIES = 100_000;
type Run = (repo: Repository, args: string[], stream?: { onStdout(chunk: Buffer): void }) => Promise<{ stdout: Buffer }>;
type ResolveCommit = (repo: Repository, revision: string) => Promise<string>;

function fixedRevision(value: string): string {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) throw new GitError(localizeMessage('tree.invalidRevision'), 'INVALID_ARGUMENT');
  return value;
}

function treePath(value = ''): string {
  if (!value) return '';
  if (value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value) || path.posix.normalize(value) !== value || value.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new GitError(localizeMessage('tree.invalidPath'), 'INVALID_ARGUMENT');
  }
  return value;
}

function decode(buffer: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new GitError(localizeMessage('tree.invalidEncoding'), 'UNSUPPORTED_PATH_ENCODING'); }
}

function parseRecord(bytes: Buffer, prefix = ''): RevisionTreeEntry {
  const record = decode(bytes);
  const separator = record.indexOf('\t');
  const match = separator >= 0 ? /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40,64}) +(-|\d+)$/.exec(record.slice(0, separator)) : undefined;
  if (!match) throw new GitError(localizeMessage('tree.malformedOutput'), 'PARSE_ERROR');
  const name = record.slice(separator + 1);
  const mode = match[1], gitType = match[2], oid = match[3], rawSize = match[4];
  const type = mode === '160000' ? 'gitlink' : mode === '120000' ? 'symlink' : gitType === 'tree' ? 'tree' : 'blob';
  return { name: path.posix.basename(name), path: prefix ? `${prefix}/${name}` : name, mode, oid, type, ...(rawSize === '-' ? {} : { size: Number(rawSize) }) };
}

function parseEntries(output: Buffer, prefix = ''): RevisionTreeEntry[] {
  const entries: RevisionTreeEntry[] = [];
  let start = 0;
  for (let end = output.indexOf(0, start); end >= 0; end = output.indexOf(0, start)) {
    if (end > start) entries.push(parseRecord(output.subarray(start, end), prefix));
    start = end + 1;
  }
  if (start !== output.length) throw new GitError(localizeMessage('tree.malformedOutput'), 'PARSE_ERROR');
  return entries;
}

export class RevisionTreeReader {
  constructor(private readonly run: Run, private readonly resolveCommit: ResolveCommit) {}

  async list(repo: Repository, request: RevisionTreeRequest): Promise<RevisionTreeListing> {
    const revision = await this.resolveCommit(repo, fixedRevision(request.revision)), selectedPath = treePath(request.path);
    const treeish = selectedPath ? `${revision}:${selectedPath}` : revision;
    if (request.recursive) {
      const entries: RevisionTreeEntry[] = [];
      let remainder = Buffer.alloc(0);
      await this.run(repo, ['ls-tree', '-r', '-t', '-z', '-l', treeish], { onStdout(chunk) {
        const buffer = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
        let start = 0;
        for (let end = buffer.indexOf(0, start); end >= 0; end = buffer.indexOf(0, start)) {
          if (end > start) entries.push(parseRecord(buffer.subarray(start, end), selectedPath));
          start = end + 1;
        }
        remainder = start === buffer.length ? Buffer.alloc(0) : Buffer.from(buffer.subarray(start));
        if (remainder.length > 1024 * 1024) throw new GitError(localizeMessage('tree.malformedOutput'), 'PARSE_ERROR');
      } });
      if (remainder.length) throw new GitError(localizeMessage('tree.malformedOutput'), 'PARSE_ERROR');
      return { revision, path: selectedPath, entries };
    }
    const output = await this.run(repo, ['ls-tree', '-z', '-l', treeish]);
    return { revision, path: selectedPath, entries: parseEntries(output.stdout, selectedPath) };
  }

  async search(repo: Repository, request: RevisionTreeSearchRequest): Promise<RevisionTreeSearchPage> {
    const revision = await this.resolveCommit(repo, fixedRevision(request.revision));
    const query = request.query.trim();
    if (!query) throw new GitError(localizeMessage('tree.searchRequired'), 'INVALID_ARGUMENT');
    const cursor = request.cursor ?? 0, limit = Math.min(200, Math.max(1, request.limit ?? 100));
    const needle = query.toLocaleLowerCase();
    const entries: RevisionTreeEntry[] = [];
    let lastReturned = cursor - 1, more = false, seen = 0, truncated = false, remainder = Buffer.alloc(0);
    const record = (bytes: Buffer) => {
      const index = seen++;
      if (index >= MAX_SEARCH_ENTRIES) { truncated = true; return; }
      const entry = parseRecord(bytes);
      if (index < cursor || more || !entry.path.toLocaleLowerCase().includes(needle)) return;
      if (entries.length === limit) { more = true; return; }
      entries.push(entry); lastReturned = index;
    };
    await this.run(repo, ['ls-tree', '-r', '-t', '-z', '-l', revision], { onStdout(chunk) {
      const buffer = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
      let start = 0;
      for (let end = buffer.indexOf(0, start); end >= 0; end = buffer.indexOf(0, start)) {
        if (end > start) record(buffer.subarray(start, end));
        start = end + 1;
      }
      remainder = start === buffer.length ? Buffer.alloc(0) : Buffer.from(buffer.subarray(start));
      if (remainder.length > 1024 * 1024) throw new GitError(localizeMessage('tree.malformedOutput'), 'PARSE_ERROR');
    } });
    if (remainder.length) throw new GitError(localizeMessage('tree.malformedOutput'), 'PARSE_ERROR');
    return {
      revision,
      query,
      entries,
      ...(more ? { nextCursor: lastReturned + 1 } : {}),
      truncated,
    };
  }
}
