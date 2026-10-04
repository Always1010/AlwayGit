import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { GitAction, Repository } from '../src/protocol/types';
import { confirmAction } from '../src/application/confirm';

const host = vi.hoisted(()=>({ warning:vi.fn(), documents:[] as {isDirty:boolean;uri:{scheme:string;fsPath:string}}[] }));
vi.mock('vscode',()=>({window:{showWarningMessage:host.warning},workspace:{get textDocuments(){return host.documents;}}}));
const repo:Repository={id:'repo',root:path.resolve('test-repo'),commonDir:path.resolve('test-repo/.git'),name:'Test'};
beforeEach(()=>{host.warning.mockReset();host.documents=[];});
describe('operation confirmation',()=>{
  it('distinguishes local-only, remote-only and combined Tag deletion', async () => {
    await confirmAction(repo,{type:'tag.delete',name:'v1',expectedOid:'a'.repeat(40)},'zh-CN');
    expect(host.warning.mock.calls[0][0]).toContain('不会修改任何远端仓库');
    host.warning.mockClear();
    await confirmAction(repo,{type:'tag.delete',name:'v1',remote:'origin',expectedRemoteOid:'a'.repeat(40),expectedDestination:'b'.repeat(64)},'zh-CN');
    expect(host.warning.mock.calls[0][0]).toContain('从远端 origin 删除标签 v1');
    host.warning.mockClear();
    await confirmAction(repo,{type:'tag.delete',name:'v1',expectedOid:'a'.repeat(40),remote:'origin',expectedRemoteOid:'a'.repeat(40),expectedDestination:'b'.repeat(64)},'zh-CN');
    expect(host.warning.mock.calls[0][0]).toContain('删除本地标签 v1，并从远端 origin 删除');
  });
  it('explains saved disk content only for selected unstaged files with dirty editors', async () => {
    host.documents=[{isDirty:true,uri:{scheme:'file',fsPath:path.join(repo.root,'same.txt')}}];
    await confirmAction(repo,{type:'commit',message:'selected',files:[{path:'same.txt',area:'unstaged'}]},'zh-CN');
    expect(host.warning).toHaveBeenCalledWith(expect.stringContaining('最新已保存的磁盘内容'),{modal:true},'使用磁盘内容');
    host.warning.mockClear();
    expect(await confirmAction(repo,{type:'commit',message:'other',files:[{path:'other.txt',area:'unstaged'}]},'zh-CN')).toBe(true);
    expect(host.warning).not.toHaveBeenCalled();
  });
  it('distinguishes keeping staged content from discarding all staged and unstaged changes', async () => {
    await confirmAction(repo, { type: 'discard', paths: ['a.txt'] }, 'zh-CN');
    expect(host.warning.mock.calls[0][0]).toContain('已暂存的更改会保留');
    await confirmAction(repo, { type: 'discard', paths: ['a.txt'], mode: 'all', planToken: 'checked' }, 'zh-CN');
    expect(host.warning.mock.calls[1][0]).toContain('全部暂存和未暂存更改');
  });
  it('shows the frozen branch and HEAD in the native Reset confirmation', async () => {
    const expectedHead = 'a'.repeat(40);
    await confirmAction(repo, { type: 'reset', mode: 'hard', target: 'b'.repeat(40), expectedBranch: 'main', expectedHead }, 'zh-CN');
    expect(host.warning.mock.calls[0][0]).toContain(`当前分支：main · HEAD：${expectedHead}`);
  });
  it('names the known Abort restore target without promising full restoration',async()=>{
    const originalHead='a'.repeat(40),operation={kind:'merge' as const,conflicts:1,canContinue:false,canAbort:true,canSkip:false,originalHead};
    expect(await confirmAction(repo,{type:'operation.abort',kind:'merge'},'zh-CN',operation)).toBe(false);
    expect(host.warning).toHaveBeenCalledWith(expect.stringContaining(originalHead),{modal:true,detail:`仓库：${repo.root}`},'继续');
    expect(host.warning.mock.calls[0][0]).toContain('操作前已有的本地修改可能影响完整恢复');
    host.warning.mockResolvedValue('继续');
    expect(await confirmAction(repo,{type:'operation.abort',kind:'merge'},'zh-CN',operation)).toBe(true);
  });
  it.each([{type:'commit',message:'Reviewed'},{type:'operation.continue',kind:'merge'}] satisfies GitAction[])('warns about unsaved editor changes before $type',async action=>{
    host.documents=[{isDirty:true,uri:{scheme:'file',fsPath:path.join(repo.root,'same.txt')}}];
    expect(await confirmAction(repo,action,'zh-CN')).toBe(false);
    expect(host.warning).toHaveBeenCalledWith(expect.stringContaining('Git 提交的是磁盘上已暂存的内容'),{modal:true},'使用暂存内容');
    host.warning.mockResolvedValue('使用暂存内容');
    expect(await confirmAction(repo,action,'zh-CN')).toBe(true);
  });
});
