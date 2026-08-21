import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { isNextAuthRoute, isPublicAuthPath } from '@/lib/auth/publicPaths'

export default async function proxy(request: NextRequest) {
  try {
    return await updateSession(request)
  } catch (err) {
    console.error('Proxy execution error:', err)
    const isAuthPage =
      isPublicAuthPath(request.nextUrl.pathname) || isNextAuthRoute(request.nextUrl.pathname)

    if (!isAuthPage) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    return NextResponse.next({ request })
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public static files (.svg, .png, .jpg, .json, .xml, .txt, etc.) —
     *   these must be reachable unauthenticated (e.g. manifest.json is
     *   fetched by the browser before login redirects can apply; letting
     *   the middleware intercept it returns the /login HTML instead of
     *   JSON, which breaks manifest parsing)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|json|xml|txt|webmanifest|ico)$).*)',
  ],
}
