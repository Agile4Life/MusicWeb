import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const cookieOptions = {
    maxAge: 60 * 60 * 24 * 365, // 1 year session persistence
    path: '/',
    sameSite: 'lax' as const,
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions,
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            const opts = {
              ...options,
              maxAge: options?.maxAge || 60 * 60 * 24 * 365,
              path: '/',
              sameSite: 'lax' as const,
            }
            request.cookies.set({ name, value, ...opts })
          })

          supabaseResponse = NextResponse.next({
            request,
          })

          cookiesToSet.forEach(({ name, value, options }) => {
            const opts = {
              ...options,
              maxAge: options?.maxAge || 60 * 60 * 24 * 365,
              path: '/',
              sameSite: 'lax' as const,
            }
            supabaseResponse.cookies.set(name, value, opts)
          })
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isAuthPage =
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/register') ||
    request.nextUrl.pathname.startsWith('/reset-password')

  const isNextAuthRoute =
    request.nextUrl.pathname.startsWith('/api/auth') ||
    request.nextUrl.pathname.startsWith('/auth/callback')

  // Never block NextAuth API routes or auth callback
  if (isNextAuthRoute) {
    return supabaseResponse
  }

  // Require login before viewing ANY application page
  if (!user && !isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // If already logged in, redirect away from login/register to main home page
  if (user && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
