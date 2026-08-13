export function shouldCommitGlobalSearch(query: string, key: string) {
  return key === 'Enter' && query.trim().length > 0
}
