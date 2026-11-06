import { createHash } from 'node:crypto';
import { message as localizeMessage, translate } from '../i18n/index';
import { hostingRepository } from '../protocol/hosting';
import { remoteNameProblem, remoteUrlProblem } from '../protocol/remote';
import type { GitAction, PushResult, RemoteLinks, RemoteTags, Repository } from '../protocol/types';
import { gitToken as token } from './arguments';
import { GitError, GitTerminationError } from './error';
import type { BoundRemote, GitRun } from './execution';
import { parsePushResult } from './push-result';
import { mapGitQueries } from './query-map';

interface RemoteDependencies {
  run: GitRun;
  text(repo: Repository, args: string[]): Promise<string>;
  oid(repo: Repository, revision: string): Promise<string>;
  optionalConfig(repo: Repository, key: string): Promise<string | undefined>;
  refName(repo: Repository, name: string): Promise<string>;
}

/** All process execution uses GitService's runner; mutations stay in its write queue. */
export class RemoteOperations {
  constructor(private readonly git: RemoteDependencies) {}
  async remoteDestination(
    repo: Repository,
    remote: string,
    requireSingle = false,
  ): Promise<string> {
    const urls = (
      await this.git.text(repo, ['remote', 'get-url', '--push', '--all', token(remote, 'remote')])
    )
      .split('\n')
      .filter(Boolean);
    if (requireSingle && urls.length !== 1)
      throw new GitError(
        localizeMessage('service.thisRemoteHasMultiplePushDestinationsSelectARemote'),
        'MULTIPLE_PUSH_DESTINATIONS',
      );
    // The UI only receives a fingerprint; URLs may contain authentication secrets.
    return createHash('sha256').update(JSON.stringify(urls)).digest('hex');
  }
  async remoteReadDestination(repo: Repository, remote: string): Promise<string> {
    const url = await this.git.text(repo, ['remote', 'get-url', token(remote, 'remote')]);
    return createHash('sha256').update(url).digest('hex');
  }
  async remoteTags(
    repo: Repository,
    remote: string,
    expectedDestination: string,
  ): Promise<RemoteTags> {
    const configured = (await this.git.text(repo, ['remote'])).split('\n');
    if (!configured.includes(token(remote, 'remote')))
      throw new GitError(
        localizeMessage('service.unknownRemote', { destination: remote }),
        'INVALID_ARGUMENT',
      );
    const url = await this.git.text(repo, ['remote', 'get-url', remote]);
    const destination = createHash('sha256').update(url).digest('hex');
    if (destination !== expectedDestination)
      throw new GitError(localizeMessage('tags.remoteChanged'), 'OPERATION_CHANGED');
    const pushUrls = (await this.git.text(repo, ['remote', 'get-url', '--push', '--all', remote]))
      .split('\n')
      .filter(Boolean);
    // Query the captured read address, never a moving remote configuration.
    const output = (
      await this.git.run(repo, ['ls-remote', '--tags', '--refs', '--', url], false, undefined, {
        silent: true,
        env: { GIT_ASKPASS: '', SSH_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never' },
      })
    ).stdout.toString('utf8');
    if ((await this.remoteReadDestination(repo, remote)) !== destination)
      throw new GitError(localizeMessage('tags.remoteChanged'), 'OPERATION_CHANGED');
    const refs: Record<string, string> = {};
    for (const line of output.split('\n').filter(Boolean)) {
      const match = /^([a-f0-9]{40}|[a-f0-9]{64})\t(refs\/tags\/[^\s]+)$/.exec(line);
      if (!match)
        throw new GitError(localizeMessage('service.malformedGitStatusOutput'), 'PARSE_ERROR');
      refs[match[2]] = match[1];
    }
    return {
      remote,
      destination,
      separatePush: pushUrls.length !== 1 || pushUrls[0] !== url,
      refs,
      checkedAt: Date.now(),
    };
  }
  async confirmRemoteDestination(
    repo: Repository,
    remote: string,
    expected?: string,
  ): Promise<BoundRemote> {
    token(remote, 'remote');
    const urls = (await this.git.text(repo, ['remote', 'get-url', '--push', '--all', remote]))
      .split('\n')
      .filter(Boolean);
    if (urls.length !== 1)
      throw new GitError(
        localizeMessage('service.thisRemoteHasMultiplePushDestinationsSelectARemote'),
        'MULTIPLE_PUSH_DESTINATIONS',
      );
    const actual = createHash('sha256').update(JSON.stringify(urls)).digest('hex');
    if (!expected || actual !== expected)
      throw new GitError(
        localizeMessage('service.theRemotePushDestinationIsMissingOrChangedRefresh'),
        'OPERATION_CHANGED',
      );
    // Reset before replacing this multi-valued key. Appending alone would push
    // to both the newly configured server and the confirmed one.
    const configOverrides: [string, string][] = [
      [`remote.${remote}.pushurl`, ''],
      [`remote.${remote}.pushurl`, urls[0]],
    ];
    const bound = { remote, url: urls[0], configOverrides };
    const resolved = await this.git.run(
      repo,
      ['remote', 'get-url', '--push', '--all', remote],
      false,
      undefined,
      { configOverrides, boundRemote: bound },
    );
    // Only remove Git's final line ending. On older Git, the empty pushurl
    // remains a destination; trim() would hide it when no pushurl was set.
    if (resolved.stdout.toString('utf8').replace(/\r?\n$/, '') !== urls[0])
      throw new GitError(
        localizeMessage('service.cannotBindRemoteDestination'),
        'REMOTE_BINDING_UNSUPPORTED',
      );
    return bound;
  }
  confirmedRemoteOid(value: string | undefined): string {
    if (value === undefined)
      throw new GitError(
        localizeMessage('service.theConfirmedRemoteBranchVersionIsMissingRefreshAnd'),
        'OPERATION_CHANGED',
      );
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})?$/.test(value))
      throw new GitError(
        localizeMessage('service.invalidConfirmedRemoteBranchVersion'),
        'INVALID_ARGUMENT',
      );
    return value;
  }
  async remoteLinks(repo: Repository, remote?: string, branch?: string): Promise<RemoteLinks> {
    if (!remote && branch) {
      const name = await this.git.refName(repo, branch);
      remote =
        (await this.git.optionalConfig(repo, `branch.${name}.pushRemote`)) ??
        (await this.git.optionalConfig(repo, 'remote.pushDefault')) ??
        (await this.git.optionalConfig(repo, `branch.${name}.remote`));
    }
    if (!remote || remote === '.') {
      const remotes = (await this.git.text(repo, ['remote'])).split('\n').filter(Boolean);
      remote = remotes.length === 1 ? remotes[0] : undefined;
    }
    if (!remote) return { repositories: [] };
    const urls = await this.git.text(repo, [
      'remote',
      'get-url',
      '--push',
      '--all',
      token(remote, 'remote'),
    ]);
    const head = await this.git.run(
      repo,
      ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`],
      true,
    );
    const name = head.stdout.toString('utf8').trim();
    return {
      repositories: urls.split('\n').flatMap((value) => {
        const repository = hostingRepository(value);
        return repository ? [repository] : [];
      }),
      ...(name.startsWith(remote + '/') ? { defaultBranch: name.slice(remote.length + 1) } : {}),
    };
  }
  async push(
    repo: Repository,
    args: string[],
    remote?: string,
    branch?: string,
    bound?: BoundRemote,
  ): Promise<PushResult> {
    const configured =
      !bound && remote
        ? await this.git.run(
            repo,
            ['remote', 'get-url', '--push', '--all', token(remote, 'remote')],
            true,
          )
        : undefined;
    const output = await this.git.run(
      repo,
      ['push', '--porcelain', ...args.slice(1)],
      true,
      undefined,
      bound ? { configOverrides: bound.configOverrides, boundRemote: bound } : {},
    );
    const result = parsePushResult(
      output.stdout.toString('utf8'),
      output.stderr.toString('utf8'),
      output.code,
      remote,
      branch,
      bound
        ? [bound.url]
        : configured?.code === 0
          ? configured.stdout.toString('utf8').trim().split('\n').filter(Boolean)
          : [],
    );
    if (output.code) {
      const error = new GitError(
        result.error || translate('en', 'service.gitExitedWithStatus', { code: output.code }),
        result.outcome === 'partial' ? 'PARTIAL_FAILURE' : 'GIT_FAILED',
        output.stdout.toString('utf8'),
        output.stderr.toString('utf8'),
      );
      error.pushResult = result;
      throw error;
    }
    return result;
  }
  async pushBranch(
    repo: Repository,
    action: Extract<GitAction, { type: 'push' }>,
  ): Promise<PushResult> {
    let boundRemote: BoundRemote | undefined;
    const remote = (value?: string) => (value ? [token(value, 'remote')] : []);
    if (action.forceWithLease && (!action.remote || !action.branch || !action.remoteBranch))
      throw new GitError(
        localizeMessage('service.selectExplicitLocalAndRemoteBranchesThenReopenThe'),
        'OPERATION_CHANGED',
      );
    const branch = action.branch ? await this.git.refName(repo, action.branch) : undefined;
    let destination = action.remote;
    if (action.remoteBranch && !branch)
      throw new GitError(
        localizeMessage('service.selectALocalBranchBeforeChoosingARemoteBranch'),
        'INVALID_ARGUMENT',
      );
    if (branch) {
      await this.git.oid(repo, `refs/heads/${branch}`);
      if (!destination) {
        const configured = await this.git.run(
          repo,
          ['config', '--get', `branch.${branch}.remote`],
          true,
        );
        if (configured.code > 1)
          throw new GitError(configured.stderr.toString('utf8'), 'GIT_FAILED');
        destination = configured.stdout.toString('utf8').trim();
        if (!destination) {
          const remotes = (await this.git.text(repo, ['remote'])).split('\n').filter(Boolean);
          if (remotes.length !== 1)
            throw new GitError(
              localizeMessage('service.selectARemoteBeforePushingThisBranch'),
              'INVALID_ARGUMENT',
            );
          destination = remotes[0];
        }
      }
    }
    const remoteBranch = branch
      ? await this.git.refName(repo, action.remoteBranch ?? branch)
      : undefined;
    const setUpstream = branch && (action.setUpstream ?? true);
    const lease = action.forceWithLease ? this.confirmedRemoteOid(action.expectedOid) : undefined;
    if (action.forceWithLease)
      boundRemote = await this.confirmRemoteDestination(
        repo,
        destination!,
        action.expectedDestination,
      );
    const args = [
      'push',
      action.followTags ? '--follow-tags' : '--no-follow-tags',
      ...(setUpstream ? ['--set-upstream'] : []),
      ...(lease !== undefined ? [`--force-with-lease=refs/heads/${remoteBranch}:${lease}`] : []),
      ...remote(destination),
      ...(branch ? [`refs/heads/${branch}:refs/heads/${remoteBranch}`] : []),
    ];
    return this.push(repo, args, destination, action.branch, boundRemote);
  }
  async add(repo: Repository, action: Extract<GitAction, { type: 'remote.add' }>): Promise<void> {
    const name = action.name.trim(),
      url = action.url.trim();
    if (remoteNameProblem(name))
      throw new GitError(
        localizeMessage('service.enterARemoteNameWithoutSpacesSuchAsOrigin'),
        'INVALID_REMOTE_NAME',
      );
    if (remoteUrlProblem(url))
      throw new GitError(localizeMessage('service.enterARepositoryURL'), 'INVALID_REMOTE_URL');
    const configured = (await this.git.text(repo, ['remote'])).split('\n').filter(Boolean);
    if (configured.includes(name))
      throw new GitError(
        localizeMessage('service.remoteAlreadyExists', { name: name }),
        'REMOTE_EXISTS',
      );
    await this.git.run(repo, ['remote', 'add', name, url]);
  }
  async deleteBranches(
    repo: Repository,
    action: Extract<GitAction, { type: 'remote.delete' }>,
  ): Promise<void> {
    const destination = token(action.remote, 'remote'),
      configured = (await this.git.text(repo, ['remote'])).split('\n').filter(Boolean);
    if (!configured.includes(destination))
      throw new GitError(
        localizeMessage('service.unknownRemote', { destination: destination }),
        'INVALID_ARGUMENT',
      );
    const branches = await mapGitQueries([...new Set(action.branches)], (name) =>
      this.git.refName(repo, name),
    );
    if (!branches.length)
      throw new GitError(
        localizeMessage('service.selectAtLeastOneRemoteBranch'),
        'INVALID_ARGUMENT',
      );
    for (const branch of branches)
      this.confirmedRemoteOid(
        Object.hasOwn(action.expectedOids ?? {}, branch) ? action.expectedOids![branch] : undefined,
      );
    const bound = await this.confirmRemoteDestination(
      repo,
      destination,
      action.expectedDestination,
    );
    const failures: string[] = [];
    let deleted = 0;
    for (const branch of branches) {
      try {
        await this.git.run(
          repo,
          [
            'push',
            '--no-follow-tags',
            `--force-with-lease=refs/heads/${branch}:${action.expectedOids![branch]}`,
            destination,
            `:refs/heads/${branch}`,
          ],
          false,
          undefined,
          { configOverrides: bound.configOverrides, boundRemote: bound },
        );
        deleted++;
      } catch (error) {
        if (
          error instanceof GitTerminationError ||
          (error instanceof GitError && error.code === 'ABORTED')
        )
          throw error;
        failures.push(
          `${destination}/${branch}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (failures.length)
      throw new GitError(
        localizeMessage('service.remoteBranchEsDeletedFailed', {
          deleted: deleted,
          count: failures.length,
          value: failures.join('\n'),
        }),
        'PARTIAL_FAILURE',
      );
    return;
  }
}
