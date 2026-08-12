import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * Server-side persistent account approval + auto email confirmation.
 * Accepts either:
 *   - { email, userId } — confirm by known userId (fast, used on registration)
 *   - { email }         — look up userId via admin API then confirm (used on login retry)
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
    const { error: upsertError } = await supabase
      .from('roles')
      .upsert({ email, role: 'user', roleApproved: true }, { onConflict: 'email' })

    if (upsertError) {
      console.warn('[APPROVE EMAIL] Upsert failed:', upsertError.message)
    }

    // 2. Auto-confirm the auth user (requires service role key)
    let confirmed = false
    if (serviceKey) {
      const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } })

      // Resolve userId: use provided one, or look up by email
      let targetUserId = userId || ''
      if (!targetUserId) {
        try {
          // List users filtered by email to find the userId
          const { data: listData, error: listErr } = await adminClient.auth.admin.listUsers({
            page: 1,
            perPage: 1000,
          })
          if (!listErr && listData?.users) {
            const found = listData.users.find(
              (u) => u.email?.trim().toLowerCase() === email
            )
            if (found) targetUserId = found.id
          }
        } catch (err) {
          console.warn('[APPROVE EMAIL] User lookup failed (non-fatal):', err)
        }
      }

      if (targetUserId) {
        try {
          const { error: confirmErr } = await adminClient.auth.admin.updateUserById(targetUserId, {
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
      } else {
        console.warn('[APPROVE EMAIL] Could not resolve userId for:', email)
      }
    }

    return NextResponse.json({ ok: true, confirmed })
  } catch (err: any) {
    console.warn('[APPROVE EMAIL] Error:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 })
  }
}
