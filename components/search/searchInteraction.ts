export function shouldCommitGlobalSearch(query: string, key: string) {
  return key === 'Enter' && query.trim().length > 0
}

export function shouldRedirectToHomeOnSearch(pathname: string) {
  return pathname !== '/' && pathname !== '/soundcloud'
}

/**
 * Determines whether the mobile search row should remain visually open based on
 * explicit user interaction or scroll distance.
 */
export function shouldKeepSearchOpenOnScroll(isSearchOpen: boolean, scrollProgress: number): boolean {
  return isSearchOpen || scrollProgress > 0.1
}

/**
 * Determines whether an outside click/tap should close the mobile search overlay.
 * When search was explicitly opened, has no typed query, and the page is near top (< 0.2 scroll progress),
 * tapping outside should close the search bar and restore the top bar.
 */
export function shouldCloseSearchOnOutsideClick(
  isSearchOpen: boolean,
  hasQuery: boolean,
  scrollProgress: number,
): boolean {
  return isSearchOpen && !hasQuery && scrollProgress < 0.2
}

