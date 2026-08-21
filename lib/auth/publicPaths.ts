// Pages a visitor may hit before they have a NextAuth/Supabase session.
// /sso/complete is the second hop of hoilauchay SSO: /api/sso mints a
// token then redirects here. If this path is treated as an app page, the
// session gate rewrites it to /login while keeping ?email=&accessToken=,
// and the login form ignores those params — so the handoff dies.
export function isPublicAuthPath(pathname: string): boolean {
  return (
    pathname.startsWith('/login') ||
    pathname.startsWith('/register') ||
    pathname.startsWith('/reset-password') ||
    pathname.startsWith('/sso')
  )
}

export function isNextAuthRoute(pathname: string): boolean {
  return (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/passkey-request') ||
    pathname.startsWith('/auth/callback')
  )
}
