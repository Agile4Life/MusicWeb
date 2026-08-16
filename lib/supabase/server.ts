import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`${name} environment variable is required`)
    }
    console.warn(`[Supabase] ${name} not set, using placeholder (development only)`)
    return `placeholder-${name.toLowerCase()}`
  }
  return value
}

export async function createClient() {
  const cookieStore = await cookies()

  const cookieOptions = {
    maxAge: 60 * 60 * 24 * 365, // 1 year session persistence
    path: '/',
    sameSite: 'lax' as const,
  }

  const supabaseUrl = getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL')
  const supabaseKey = getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')

  return createServerClient(
    supabaseUrl,
    supabaseKey,
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
