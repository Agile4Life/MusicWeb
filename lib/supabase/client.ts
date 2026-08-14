import { createBrowserClient } from '@supabase/ssr'

declare global {
  // eslint-disable-next-line no-var
  var __supabaseBrowserClient: ReturnType<typeof createBrowserClient> | undefined
}

export function createClient() {
  const cookieOptions = {
    maxAge: 60 * 60 * 24 * 365,
    path: '/',
    sameSite: 'lax' as const,
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    'placeholder-anon-key'

  if (typeof window === 'undefined') {
    // Server: luôn tạo instance mới, không cache (đúng như cũ)
    return createBrowserClient(url, key, { cookieOptions })
  }

  // Browser: cache trên `globalThis` thay vì module-level `let`
  // để sống sót qua các lần Fast Refresh / HMR re-evaluate module trong dev mode
  if (!globalThis.__supabaseBrowserClient) {
    globalThis.__supabaseBrowserClient = createBrowserClient(url, key, { cookieOptions })
  }

  return globalThis.__supabaseBrowserClient
}
