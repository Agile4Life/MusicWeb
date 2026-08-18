export function shouldCommitGlobalSearch(query: string, key: string) {
  return key === 'Enter' && query.trim().length > 0
}

export function shouldRedirectToHomeOnSearch(pathname: string) {
  return pathname !== '/' && pathname !== '/soundcloud'
}
