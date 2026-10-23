export type AuthRedirectRouter = {
  replace: (href: string) => void
  refresh: () => void
}

export function safeAuthReturnTo(value?: string | null): '/' | '/spotify-lab' {
  return value === '/spotify-lab' ? '/spotify-lab' : '/'
}

export function scheduleAuthRedirect(router: AuthRedirectRouter, delayMs: number, returnTo?: string | null) {
  return globalThis.setTimeout(() => {
    router.replace(safeAuthReturnTo(returnTo))
    router.refresh()
  }, delayMs)
}
