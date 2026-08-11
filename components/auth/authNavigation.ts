export type AuthRedirectRouter = {
  replace: (href: string) => void
  refresh: () => void
}

export function scheduleAuthRedirect(router: AuthRedirectRouter, delayMs: number) {
  return globalThis.setTimeout(() => {
    router.replace('/')
    router.refresh()
  }, delayMs)
}
