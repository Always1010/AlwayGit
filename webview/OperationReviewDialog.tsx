import { useState } from 'react';
import type { OperationReview } from '../src/protocol/types';
import { useWorkbench } from './store';
import { useTranslation } from './i18n';
import { Button, Modal } from './ui';

export function OperationReviewDialog({ edit }: { edit(path: string): void }) {
  const state = useWorkbench(), pending = state.operationReview!, t = useTranslation();
  const [acknowledged, setAcknowledged] = useState(false);
  const flagged = pending.review.files.filter(file=>file.lines.length||file.skipped), warnings = !!flagged.length;
  const close = () => useWorkbench.setState({ operationReview: undefined });
  const inspect = (path?: string) => {
    close(); state.selectWorking();
    const file = path ?? pending.review.files[0]?.path;
    if (file) state.selectFile({ kind: 'change', area: 'staged', path: file });
    state.setLayout({ diffCollapsed: false });
  };
  const skipped = (reason: OperationReview['files'][number]['skipped']) => ({
    binary: t('Binary file: not scanned','二进制文件：未扫描'), large: t('Over 2 MiB: not scanned','超过 2 MiB：未扫描'),
    encoding: t('Unsupported text encoding: not scanned','不支持的文本编码：未扫描'), submodule: t('Submodule: not scanned','子模块：未扫描'),
    limit: t('Inspection size limit reached: not scanned','已达检查大小上限：未扫描'),
  }[reason!]);
  async function confirm() {
    if (state.repoId !== pending.repoId) { close(); return; }
    await state.execute({ ...pending.action, reviewToken: pending.review.token });
  }
  return <Modal title={t('Inspect Staged Result','检查暂存结果')} busy={state.busy} onClose={close} footer={<>
    <Button icon="arrow-left" disabled={state.busy} onClick={()=>inspect()}>{t('Return to Review','返回检查')}</Button>
    <Button className={warnings?'danger':'primary'} disabled={state.busy||warnings&&!acknowledged} onClick={()=>void confirm()}>{warnings?t('Continue Anyway','仍然继续'):t('Confirm & Continue','确认并继续')}</Button>
  </>}>
    <p>{state.snapshot?.repository.name} · {state.snapshot?.branch} · {pending.review.kind}</p>
    <p>{t('Git will use the staged content. Editing a file does not update its staged version; save and stage your final result before continuing.','Git 使用的是暂存内容。编辑文件不会自动更新暂存版本；继续前请保存并暂存最终结果。')}</p>
    <p className={warnings?'warning-text':'muted'} role="status">{warnings?t('Possible conflict markers or files that could not be scanned need your review.','发现疑似冲突标记或未能扫描的文件，请检查。'):t('No common conflict markers found in the staged changed text files. This does not verify content correctness.','已扫描的暂存变更文本中未发现常见冲突标记；这不代表内容正确。')}</p>
    <div className="operation-review-files">{pending.review.files.map(file=><div className="operation-review-file" key={file.path}>
      <div><strong>{file.path}</strong>{file.lines.length>0&&<span className="warning-text">{t('Possible markers at lines: ','疑似标记行：')}{file.lines.join(', ')}{file.more&&t(' (first 100 shown)','（仅显示前 100 处）')}</span>}{file.skipped&&<span className="warning-text">{skipped(file.skipped)}</span>}</div>
      <Button className="icon-only" icon="diff" disabled={state.busy} title={t('Review staged content','检查暂存内容')} aria-label={`${t('Review staged content','检查暂存内容')}: ${file.path}`} onClick={()=>inspect(file.path)}/>
      <Button className="icon-only" icon="edit" disabled={state.busy} title={t('Edit in VS Code, then save and stage','在 VS Code 中编辑，然后保存并暂存')} aria-label={`${t('Edit in VS Code','在 VS Code 中编辑')}: ${file.path}`} onClick={()=>{inspect(file.path);edit(file.path);}}/>
    </div>)}</div>
    {warnings&&<label className="form-checkbox"><input type="checkbox" checked={acknowledged} onChange={event=>setAcknowledged(event.target.checked)}/>{t('I reviewed these warnings and intend to keep this staged content, including any literal markers.','我已检查以上提示，确认保留当前暂存内容（包括需要保留的标记文本）。')}</label>}
  </Modal>;
}
