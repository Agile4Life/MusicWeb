import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Server-side persistent account approval.
 * Upserts the email into the Supabase `roles` table (roleApproved = true) so the
 * NextAuth signIn callback accepts the account from ANY browser/device — not just
 * the browser that originally entered the passkey.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body?.email || '').trim().toLowerCase()
    if (!email || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
      return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 })
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) {
      return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 500 })
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const { error } = await supabase
      .from('roles')
      .upsert({ email, role: 'user', roleApproved: true }, { onConflict: 'email' })

    if (error) {
      console.warn('[APPROVE EMAIL] Upsert failed:', error.message)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    console.log('[APPROVE EMAIL] Approved server-side:', email)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.warn('[APPROVE EMAIL] Error:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 })
  }
}
