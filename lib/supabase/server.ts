import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()

  const cookieOptions = {
    maxAge: 60 * 60 * 24 * 365, // 1 year session persistence
    path: '/',
    sameSite: 'lax' as const,
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      'placeholder-anon-key',
    {
      cookieOptions,
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              const opts = {
                ...options,
                maxAge: options?.maxAge || 60 * 60 * 24 * 365,
                path: '/',
                sameSite: 'lax' as const,
              }
              cookieStore.set(name, value, opts)
            })
          } catch {
            // Called from Server Component, ignore error
          }
        },
      },
    }
  )
}
