import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

export async function updateSession(request: NextRequest) {
  const isAuthPage =
    request.nextUrl.pathname.startsWith('/login') ||
    request.nextUrl.pathname.startsWith('/register') ||
    request.nextUrl.pathname.startsWith('/reset-password')

  const isNextAuthRoute =
    request.nextUrl.pathname.startsWith('/api/auth') ||
    request.nextUrl.pathname.startsWith('/api/passkey-request') ||
    request.nextUrl.pathname.startsWith('/auth/callback')

  // Never block NextAuth API routes, Passkey API, or auth callback
  if (isNextAuthRoute) {
    return NextResponse.next({ request })
  }

  let isLoggedIn = false
  let supabaseResponse = NextResponse.next({ request })

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

    if (!supabaseUrl || !supabaseKey) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required in production')
      }
      console.warn('[Middleware] Supabase credentials not configured, authentication may fail')
    }

    const supabase = createServerClient(
      supabaseUrl || 'https://placeholder.supabase.co',
      supabaseKey || 'placeholder-anon-key',
      {
        cookieOptions: {
          maxAge: 60 * 60 * 24 * 365,
          path: '/',
          sameSite: 'lax',
        },
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => {
              request.cookies.set({ name, value, ...options })
            })
            supabaseResponse = NextResponse.next({ request })
            cookiesToSet.forEach(({ name, value, options }) => {
              supabaseResponse.cookies.set(name, value, options)
            })
          },
        },
      }
    )

    const {
      data: { user: supabaseUser },
    } = await supabase.auth.getUser()

    let nextAuthToken = null
    try {
      const authSecret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET
      if (!authSecret && process.env.NODE_ENV === 'production') {
        console.error('[Middleware] NEXTAUTH_SECRET or AUTH_SECRET is required in production')
      }
      nextAuthToken = await getToken({
        req: request,
        secret: authSecret || 'musicweb_nextauth_secret_key_84920482910_phongtct_dev_only',
      })
    } catch (e) {
      console.warn('NextAuth getToken failed in middleware:', e)
    }

    isLoggedIn = !!supabaseUser || !!nextAuthToken
  } catch (err) {
    console.error('Middleware auth check error:', err)
    isLoggedIn = false
  }

  const isApiRoute = request.nextUrl.pathname.startsWith('/api/')
  const isLocalHost =
    request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1'

  // Require login before viewing ANY application page (bypass on localhost dev test)
  if (!isLoggedIn && !isAuthPage && !isApiRoute && !isLocalHost) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
