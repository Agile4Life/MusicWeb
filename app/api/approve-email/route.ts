import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import { isAdmin } from '@/lib/accessControl'

const approveRateLimitMap = new Map<string, { count: number; resetAt: number }>()
const APPROVE_WINDOW_MS = 10 * 60 * 1000
const APPROVE_MAX_ATTEMPTS = 10

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = approveRateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    approveRateLimitMap.set(ip, { count: 1, resetAt: now + APPROVE_WINDOW_MS })
    return false
  }
  entry.count += 1
  return entry.count > APPROVE_MAX_ATTEMPTS
}

/**
 * Server-side account approval + auto email confirmation for internal @musicweb.com
 * accounts (or external accounts when invoked by an authenticated Admin).
 */
export async function POST(req: NextRequest) {
  try {
    const clientIp =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown'

    if (isRateLimited(clientIp)) {
      return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
    }

    const body = await req.json()
    const email = String(body?.email || '').trim().toLowerCase()
    if (!email || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
      return NextResponse.json({ ok: false, error: 'invalid_email' }, { status: 400 })
    }

    // Only allow unauthenticated self-confirmation for internal @musicweb.com username accounts
    // (which do not use real email inboxes) as long as they are not reserved admin accounts.
    // Confirming any external email requires an authenticated Admin session.
    const isInternalUsernameEmail = email.endsWith('@musicweb.com') && !isAdmin(email)
    if (!isInternalUsernameEmail) {
      const session = await getServerSession(authOptions).catch(() => null)
      const callerEmail = session?.user?.email?.trim().toLowerCase() || ''
      if (!callerEmail || !isAdmin(callerEmail)) {
        return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 })
      }
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const fallbackKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const key = serviceKey || fallbackKey
    if (!url || !key) {
      return NextResponse.json({ ok: false, error: 'supabase_not_configured' }, { status: 500 })
    }

    const supabase = createClient(url, key, { auth: { persistSession: false } })

    // 1. Persist approval in roles table without overwriting existing role if already present
    const { error: upsertError } = await supabase
      .from('roles')
      .upsert({ email, role: 'user', roleApproved: true }, { onConflict: 'email', ignoreDuplicates: true })

    if (upsertError) {
      console.warn('[APPROVE EMAIL] Upsert failed:', upsertError.message)
    }

    // 2. Auto-confirm the auth user (always verify userId matches email via admin lookup)
    let confirmed = false
    if (serviceKey) {
      const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } })

      let targetUserId = ''
      try {
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

      if (targetUserId) {
        try {
          const { error: confirmErr } = await adminClient.auth.admin.updateUserById(targetUserId, {
            email_confirm: true,
          })
          if (!confirmErr) {
            confirmed = true
          } else {
            console.warn('[APPROVE EMAIL] Auto-confirm failed:', confirmErr.message)
          }
        } catch (err) {
          console.warn('[APPROVE EMAIL] Auto-confirm error:', err)
        }
      }
    }

    return NextResponse.json({ ok: true, confirmed })
  } catch (err: any) {
    console.warn('[APPROVE EMAIL] Error:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 500 })
  }
}
