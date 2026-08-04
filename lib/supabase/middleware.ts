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
    request.nextUrl.pathname.startsWith('/auth/callback')

  // Never block NextAuth API routes or auth callback
  if (isNextAuthRoute) {
    return NextResponse.next({ request })
  }

  let isLoggedIn = false
  let supabaseResponse = NextResponse.next({ request })

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mjpibwmproussfevtqbp.supabase.co',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_mT97L0yZZOXReH-6ToCWGg_cpryfNgs',
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
      nextAuthToken = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'musicweb_nextauth_secret_key_84920482910_phongtct',
      })
    } catch (e) {
      console.warn('NextAuth getToken failed in middleware:', e)
    }

    isLoggedIn = !!supabaseUser || !!nextAuthToken
  } catch (err) {
    console.error('Middleware auth check error:', err)
    isLoggedIn = false
  }

  // Require login before viewing ANY application page
  if (!isLoggedIn && !isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
