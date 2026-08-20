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

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!anonKey) {
    console.warn('[SSO] Supabase anon key not configured')
    return NextResponse.redirect(`${appUrl}/login?error=SsoUnavailable`)
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  try {
    // Auto-provision on first visit — anyone with a valid hlc_session is
    // already a vetted hoilauchay member. createUser() no-ops into an
    // "already registered" error for a returning user, which is fine: we
    // only need the account to exist before minting a session below.
    const { error: createErr } = await admin.auth.admin.createUser({
      email: profile.email,
      email_confirm: true,
      user_metadata: { name: profile.name, picture: profile.picture, source: 'hoilauchay-sso' },
    })
    if (createErr && !/already.*registered|already.*exists/i.test(createErr.message || '')) {
      console.warn('[SSO] auto-provision failed:', createErr.message)
      return NextResponse.redirect(`${appUrl}/login?error=SsoProvisionFailed`)
    }

    // generateLink()+verifyOtp() is Supabase's documented way to mint a real
    // session server-side for a known email without a password — unlike
    // admin.createSession() (used elsewhere in this codebase for Google
    // account linking), this is public API, not an `as any`-cast internal
    // method, so it's the more reliable choice for a flow that has to work
    // every time rather than being a best-effort enhancement.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: profile.email,
    })
    const hashedToken = linkData?.properties?.hashed_token
    if (linkErr || !hashedToken) {
      console.warn('[SSO] generateLink failed:', linkErr?.message)
      return NextResponse.redirect(`${appUrl}/login?error=SsoSessionFailed`)
    }

    const anon = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } })
    const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'magiclink',
    })
    if (verifyErr || !verifyData?.session?.access_token) {
      console.warn('[SSO] verifyOtp failed:', verifyErr?.message)
      return NextResponse.redirect(`${appUrl}/login?error=SsoSessionFailed`)
    }

    const complete = new URL('/sso/complete', appUrl)
    complete.searchParams.set('email', profile.email)
    complete.searchParams.set('accessToken', verifyData.session.access_token)
    return NextResponse.redirect(complete)
  } catch (err) {
    console.error('[SSO] Supabase admin call threw:', err)
    return NextResponse.redirect(`${appUrl}/login?error=SsoSessionFailed`)
  }
}
