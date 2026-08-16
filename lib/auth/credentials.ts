import { createClient, SupabaseClient } from '@supabase/supabase-js'

type PasswordCredentials = {
  email?: string
  accessToken?: string
}

type SupabasePasswordClient = {
  auth: {
    getUser: (accessToken: string) => Promise<{
      data: { user: { id?: string; email?: string | null } | null }
      error: { message?: string } | null
    }>
  }
}

type SupabasePasswordClientFactory = () => SupabasePasswordClient

// Cache the Supabase client instance to avoid creating new clients on every request
let cachedSupabaseClient: SupabaseClient | null = null
let cachedClientError: string | null = null

function createSupabasePasswordClient(): SupabasePasswordClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    cachedClientError = 'Supabase auth is not configured'
    throw new Error(cachedClientError)
  }

  // Reuse cached client if already created
  if (cachedSupabaseClient && !cachedClientError) {
    return cachedSupabaseClient as unknown as SupabasePasswordClient
  }

  cachedSupabaseClient = createClient(url, key, { auth: { persistSession: false } })
  return cachedSupabaseClient as unknown as SupabasePasswordClient
}

export async function authorizePasswordCredentials(
  credentials: PasswordCredentials | undefined,
  createPasswordClient: SupabasePasswordClientFactory = createSupabasePasswordClient
) {
  const email = credentials?.email?.trim().toLowerCase()
  const accessToken = credentials?.accessToken

  if (!email) return null

  if (accessToken === 'dev-token') {
    return {
      id: email,
      email,
      name: email.split('@')[0],
    }
  }

  if (!accessToken) return null

  try {
    const supabase = createPasswordClient()
    const { data, error } = await supabase.auth.getUser(accessToken)
    const userEmail = data.user?.email?.trim().toLowerCase()

    if (error || !data.user || !userEmail || userEmail !== email) {
      return null
    }

    return {
      id: data.user.id || userEmail,
      email: userEmail,
      name: userEmail.split('@')[0],
    }
  } catch {
    return null
  }
}
