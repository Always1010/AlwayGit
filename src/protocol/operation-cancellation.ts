import type { GitAction } from './types';

/** Local destructive actions need individual interruption policies before opting in. */
export function canCancelAction(action: GitAction): boolean {
  return (
    [
      'fetch',
      'pull',
      'push',
      'tag.push',
      'remote.delete',
      'lfs.fetch',
      'lfs.fetchHistorical',
      'lfs.pull',
      'lfs.push',
    ].includes(action.type) ||
    (action.type === 'tag.create' && !!action.pushRemote) ||
    (action.type === 'tag.delete' && !!action.remote)
  );
}

/** Pull's conservative warning covers a phase change while confirmation is open. */
export function cancellationRisk(action?: GitAction) {
  if (!action) return 'cancellation.refreshRisk' as const;
  if (action.type === 'pull' || action.type === 'lfs.pull') return 'cancellation.pullRisk' as const;
  if (
    action.type === 'fetch' ||
    action.type === 'lfs.fetch' ||
    action.type === 'lfs.fetchHistorical'
  )
    return 'cancellation.fetchRisk' as const;
  if (action.type === 'tag.create' || action.type === 'tag.delete')
    return 'cancellation.tagRisk' as const;
  return 'cancellation.pushRisk' as const;
}
