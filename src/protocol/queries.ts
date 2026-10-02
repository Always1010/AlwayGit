const categories = { history: 'history', details: 'details', stashDetails: 'details', compare: 'details', diffPreview: 'diff', cherryPickCheck: 'cherryPickCheck' } as const;
export type ReadQueryCategory = typeof categories[keyof typeof categories];
export function readQueryCategory(method: string): ReadQueryCategory | undefined {
  return Object.prototype.hasOwnProperty.call(categories, method) ? categories[method as keyof typeof categories] : undefined;
}
