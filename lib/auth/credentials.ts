import { createClient } from '@supabase/supabase-js'

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

function createSupabasePasswordClient(): SupabasePasswordClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!url || !key) {
    throw new Error('Supabase auth is not configured')
  }

  return createClient(url, key, { auth: { persistSession: false } })
}

export async function authorizePasswordCredentials(
  credentials: PasswordCredentials | undefined,
  createPasswordClient: SupabasePasswordClientFactory = createSupabasePasswordClient
) {
  const email = credentials?.email?.trim().toLowerCase()
  const accessToken = credentials?.accessToken

  if (!email || !accessToken) return null

  const supabase = createPasswordClient()
  const { data, error } = await supabase.auth.getUser(accessToken)
  const userEmail = data.user?.email?.trim().toLowerCase()

  if (error || !data.user || !userEmail || userEmail !== email) return null

  return {
    id: data.user.id || userEmail,
    email: userEmail,
    name: userEmail.split('@')[0],
  }
}
