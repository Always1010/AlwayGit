import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { GitAction, Repository } from '../src/protocol/types';
import { confirmAction } from '../src/application/confirm';

const host = vi.hoisted(()=>({ warning:vi.fn(), documents:[] as {isDirty:boolean;uri:{scheme:string;fsPath:string}}[] }));
vi.mock('vscode',()=>({window:{showWarningMessage:host.warning},workspace:{get textDocuments(){return host.documents;}}}));
const repo:Repository={id:'repo',root:path.resolve('test-repo'),commonDir:path.resolve('test-repo/.git'),name:'Test'};
beforeEach(()=>{host.warning.mockReset();host.documents=[];});
describe('operation confirmation',()=>{
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
