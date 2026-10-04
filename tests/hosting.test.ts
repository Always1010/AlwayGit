import { describe, expect, it } from 'vitest';
import { hostingRepository, refWebUrl, requestWebUrl, remoteRequestUrl, safeWebUrl } from '../src/protocol/hosting';
import { externalUrlSchema } from '../src/protocol/validation';
import { parsePushResult } from '../src/git/push-result';

describe('Hosting links and Push results', () => {
  it('normalizes HTTPS, SSH and nested GitLab repositories without copying credentials', () => {
    for (const url of ['git@github.com:acme/repo.git', 'ssh://git@github.com/acme/repo.git', 'https://user:token@github.com/acme/repo.git?token=secret']) {
      expect(hostingRepository(url)).toEqual({url:'https://github.com/acme/repo',label:'github.com/acme/repo',provider:'github'});
    }
    expect(hostingRepository('git@gitlab.com:group/subgroup/project.git')?.url).toBe('https://gitlab.com/group/subgroup/project');
    expect(hostingRepository('git@company-alias:acme/repo.git')).toBeUndefined();
    expect(hostingRepository('https://company.example/acme/repo.git')?.provider).toBeUndefined();
  });
  it('encodes branch names, supports GitHub forks, and does not infer fork IDs on GitLab', () => {
    const source=hostingRepository('https://github.com/fork/repo')!,target=hostingRepository('https://github.com/acme/repo')!;
    expect(refWebUrl(source,'branch','feature/中文')).toBe('https://github.com/fork/repo/tree/feature%2F%E4%B8%AD%E6%96%87');
    expect(requestWebUrl(source,'feature/login','release/1.x',target)).toBe('https://github.com/acme/repo/compare/release%2F1.x...fork%3Afeature%2Flogin?expand=1');
    expect(requestWebUrl(source,'main','main')).toBeUndefined();
    expect(requestWebUrl(hostingRepository('https://gitlab.com/fork/repo')!,'topic','main',hostingRepository('https://gitlab.com/acme/repo')!)).toBeUndefined();
  });
  it('accepts only matching remote creation links and HTTPS browser actions', () => {
    const repo=hostingRepository('git@gitlab.com:group/repo.git')!;
    const valid='https://gitlab.com/group/repo/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fx';
    expect(remoteRequestUrl(`remote: ${valid}`,repo,'feature/x')).toBe(valid);
    expect(remoteRequestUrl(`remote: ${valid}`,repo,'other')).toBeUndefined();
    expect(remoteRequestUrl(valid.replace('/group/repo/','/wrong/repo/'),repo,'feature/x')).toBeUndefined();
    expect(remoteRequestUrl(valid+'&access_token=secret',repo,'feature/x')).toBeUndefined();
    const selfHosted=valid.replace('gitlab.com','git.company.example');
    const result=parsePushResult('To https://git.company.example/group/repo.git\n*\trefs/heads/topic:refs/heads/feature/x\t[new branch]',selfHosted,0);
    expect(result.destinations[0].repository?.provider).toBe('gitlab');
    expect(result.destinations[0].refs[0].requestUrl).toBe(selfHosted);
    const existing=parsePushResult('To https://gitlab.com/group/repo.git\n \trefs/heads/topic:refs/heads/topic\t123..456','remote: https://gitlab.com/group/repo/-/merge_requests/12',0);
    expect(existing.destinations[0].refs[0]).toMatchObject({requestKind:'view',requestUrl:'https://gitlab.com/group/repo/-/merge_requests/12'});
    for(const url of ['javascript:alert(1)','file:///C:/secret','https://user:secret@github.com/acme/repo','http://github.com/acme/repo']) {
      expect(safeWebUrl(url)).toBeUndefined();expect(externalUrlSchema.safeParse({url}).success).toBe(false);
    }
  });
  it('reports actual remote refs and partial outcomes for multiple push destinations', () => {
    const output='To git@github.com:acme/repo.git\n*\trefs/heads/topic:refs/heads/release/x\t[new branch]\n=\trefs/tags/v1:refs/tags/v1\t[up to date]\nTo https://gitlab.com/group/repo.git\n!\trefs/heads/topic:refs/heads/release/x\t[remote rejected]\nDone\n';
    const result=parsePushResult(output,'remote: rejected by policy',1,'publish','topic');
    expect(result.outcome).toBe('partial');expect(result.destinations).toHaveLength(2);
    expect(result.destinations[0].refs[0]).toMatchObject({name:'release/x',status:'published',url:'https://github.com/acme/repo/tree/release%2Fx'});
    expect(result.destinations[0].refs[1]).toMatchObject({kind:'tag',status:'up-to-date',releaseUrl:'https://github.com/acme/repo/releases/new?tag=v1'});
    expect(result.destinations[1].refs[0]).toMatchObject({status:'rejected'});
    expect(result.destinations[1].refs[0].url).toBeUndefined();
    expect(parsePushResult('','authentication failed',128).outcome).toBe('error');
  });
  it('preserves successful Push results and later valid links after a malformed remote compare URL', () => {
    const stdout='To git@github.com:acme/repo.git\n*\trefs/heads/topic:refs/heads/feature/x\t[new branch]';
    const malformed='remote: https://github.com/acme/repo/compare/%';
    const result=parsePushResult(stdout,malformed,0);
    expect(result.outcome).toBe('success');
    expect(result.destinations[0].refs[0]).toMatchObject({name:'feature/x',status:'published',url:'https://github.com/acme/repo/tree/feature%2Fx'});
    expect(result.destinations[0].refs[0].requestUrl).toBeUndefined();
    const valid='https://github.com/acme/repo/compare/main...feature%2Fx?expand=1';
    const withValid=parsePushResult(stdout,`${malformed}\nremote: ${valid}`,0);
    expect(withValid.outcome).toBe('success');
    expect(withValid.destinations[0].refs[0]).toMatchObject({status:'published',requestKind:'create',requestUrl:valid});
  });
});
