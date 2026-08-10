import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Server-side persistent account approval + auto email confirmation.
 * 1. Upserts the email into the Supabase `roles` table (roleApproved = true) so the
 *    NextAuth signIn callback accepts the account from ANY browser/device.
 * 2. Auto-confirms the Supabase Auth user (email_confirm = true) when a service-role
 *    key is configured, so a freshly registered account can log in immediately
 *    without clicking an email confirmation link.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body?.email || '').trim().toLowerCase()
    const userId = String(body?.userId || '').trim()
    if (!email || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
      return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 })
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const fallbackKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const key = serviceKey || fallbackKey
    if (!url || !key) {
      return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 500 })
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } })

    // 1. Persist approval in roles table
    const { error } = await supabase
      .from('roles')
      .upsert({ email, role: 'user', roleApproved: true }, { onConflict: 'email' })

    if (error) {
      console.warn('[APPROVE EMAIL] Upsert failed:', error.message)
    }

    // 2. Auto-confirm the newly registered auth user (requires service role key)
    let confirmed = false
    if (serviceKey && userId) {
      try {
        const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } })
        const { error: confirmErr } = await adminClient.auth.admin.updateUserById(userId, {
          email_confirm: true,
        })
        if (!confirmErr) {
          confirmed = true
          console.log('[APPROVE EMAIL] Auto-confirmed email for:', email)
        } else {
          console.warn('[APPROVE EMAIL] Auto-confirm failed:', confirmErr.message)
        }
      } catch (err) {
        console.warn('[APPROVE EMAIL] Auto-confirm error:', err)
      }
    }

    return NextResponse.json({ ok: true, confirmed })
  } catch (err: any) {
    console.warn('[APPROVE EMAIL] Error:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 })
  }
}
