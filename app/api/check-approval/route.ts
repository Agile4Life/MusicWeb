import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

/**
 * Server-side approval check for email+password login and the AuthGuard.
 * Combines the bundled config allowlist (config/allowedAccounts.json) with the
 * server-persistent Supabase `roles` table (passkey/register approvals).
 */
export async function GET(req: NextRequest) {
  try {
    const email = req.nextUrl.searchParams.get('email')?.trim().toLowerCase()
    if (!email) {
      return NextResponse.json({ approved: false }, { status: 400 })
    }

    // 1. Bundled config allowlist
    let allowAll = false
    const allowedList: string[] = []
    try {
      const configPath = path.join(process.cwd(), 'config', 'allowedAccounts.json')
      if (fs.existsSync(configPath)) {
        const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        if (data.allowAllAsListeners) allowAll = true
        if (Array.isArray(data.adminEmails)) {
          data.adminEmails.forEach((e: string) => allowedList.push(String(e).trim().toLowerCase()))
        }
        if (Array.isArray(data.allowedEmails)) {
          data.allowedEmails.forEach((item: any) => {
            if (item?.email) allowedList.push(String(item.email).trim().toLowerCase())
          })
        }
      }
    } catch {}

    if (allowAll || allowedList.includes(email)) {
      return NextResponse.json({ approved: true })
    }

    // 2. Supabase roles table (server-persistent approval from passkey/register)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (supabaseUrl && adminKey) {
      const rolesRes = await fetch(
        `https://${supabaseUrl.replace('https://', '')}/rest/v1/roles?email=eq.${encodeURIComponent(email)}&select=roleApproved`,
        {
          headers: {
            apikey: adminKey,
            Authorization: `Bearer ${adminKey}`,
          },
          cache: 'no-store',
        }
      )
      if (rolesRes.ok) {
        const rows = await rolesRes.json()
        if (Array.isArray(rows) && rows.length > 0 && rows[0].roleApproved === true) {
          return NextResponse.json({ approved: true })
        }
      }
    }

    return NextResponse.json({ approved: false })
  } catch (err) {
    console.warn('[CHECK APPROVAL] Error:', err)
    return NextResponse.json({ approved: false }, { status: 500 })
  }
}
