import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Cross-app SSO handoff from hoilauchay (see AppShell.tsx's "Nhạc" nav link):
// the visitor is already signed in there with an hlc_session token, which we
// verify against hoilauchay's own /api/auth (a plain server-to-server fetch,
// no CORS involved), then log them into MusicWeb under the same email —
// auto-provisioning a Supabase Auth user on first visit since anyone with a
// valid hlc_session is already a vetted hoilauchay member.
const HLC_ORIGIN = process.env.HLC_ORIGIN || 'https://hoilauchay.vercel.app'

export async function GET(req: NextRequest) {
  const appUrl = req.nextUrl.origin
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(`${appUrl}/login`)

  let profile: { email: string; name?: string; picture?: string }
  try {
    const res = await fetch(`${HLC_ORIGIN}/api/auth`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    const data = await res.json()
    if (!res.ok || !data?.ok || !data?.email) throw new Error('invalid hlc session')
    profile = { email: String(data.email).trim().toLowerCase(), name: data.name, picture: data.picture }
  } catch (err) {
    console.warn('[SSO] hoilauchay token verification failed:', err)
    return NextResponse.redirect(`${appUrl}/login?error=SsoInvalid`)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.warn('[SSO] Supabase service role not configured')
    return NextResponse.redirect(`${appUrl}/login?error=SsoUnavailable`)
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Same full-scan lookup already used for Google-account linking in
  // lib/authOptions.ts — kept consistent rather than introducing a second
  // way to find a user by email.
  const { data: listData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  let userId = listData?.users?.find((u) => u.email?.toLowerCase() === profile.email)?.id

  if (!userId) {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: profile.email,
      email_confirm: true,
      user_metadata: { name: profile.name, picture: profile.picture, source: 'hoilauchay-sso' },
    })
    if (createErr || !created?.user) {
      console.warn('[SSO] auto-provision failed:', createErr?.message)
      return NextResponse.redirect(`${appUrl}/login?error=SsoProvisionFailed`)
    }
    userId = created.user.id
  }

  // Same admin.createSession() call already used to mint a Supabase session
  // for a known user id in the Google-linking flow (lib/authOptions.ts).
  const { data: sessionData, error: sessionErr } = await (admin.auth.admin as any).createSession({
    user_id: userId,
  })
  if (sessionErr || !sessionData?.session?.access_token) {
    console.warn('[SSO] session mint failed:', sessionErr?.message)
    return NextResponse.redirect(`${appUrl}/login?error=SsoSessionFailed`)
  }

  const complete = new URL('/sso/complete', appUrl)
  complete.searchParams.set('email', profile.email)
  complete.searchParams.set('accessToken', sessionData.session.access_token)
  return NextResponse.redirect(complete)
}
