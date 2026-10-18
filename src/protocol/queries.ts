const categories = { revisionTreeSearch: 'revisionTreeSearch', conflictDetails: 'conflictDetails', prepareInteractiveRebase: 'interactiveRebase', branchComparison: 'branchComparison', worktreeOverview: 'worktreeOverview', inspectDetails: 'inspectionDetails', reflog: 'reflog', isolatedDiffPreview: 'isolatedDiff', isolatedDiffPage: 'isolatedDiffPage', history: 'history', details: 'details', stashDetails: 'details', compare: 'details', diffPreview: 'diff', diffPage: 'diffPage', cherryPickCheck: 'cherryPickCheck', remoteTags: 'remoteTags' } as const;
export type ReadQueryCategory = typeof categories[keyof typeof categories];
export function readQueryCategory(method: string): ReadQueryCategory | undefined {
  return Object.prototype.hasOwnProperty.call(categories, method) ? categories[method as keyof typeof categories] : undefined;
}
