import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const ADMIN_PERSONAL_EMAIL = process.env.ADMIN_PERSONAL_EMAIL || 'tranphong16012006@gmail.com'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const username: string = String(body?.username || '').trim()
    const password: string = String(body?.password || '')
    const realEmail: string = String(body?.realEmail || '').trim().toLowerCase()

    // --- Validation ---
    if (!username || !password) {
      return NextResponse.json({ ok: false, error: 'Vui lòng nhập đầy đủ tên tài khoản và mật khẩu' }, { status: 400 })
    }
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return NextResponse.json(
        { ok: false, error: 'Tên tài khoản chỉ được chứa chữ cái, số và dấu gạch dưới (3–30 ký tự)' },
        { status: 400 }
      )
    }
    if (password.length < 6) {
      return NextResponse.json({ ok: false, error: 'Mật khẩu phải có ít nhất 6 ký tự' }, { status: 400 })
    }
    if (realEmail && !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(realEmail)) {
      return NextResponse.json({ ok: false, error: 'Gmail liên kết không đúng định dạng' }, { status: 400 })
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !serviceKey) {
      return NextResponse.json(
        { ok: false, error: 'Server chưa cấu hình SUPABASE_SERVICE_ROLE_KEY. Vui lòng liên hệ Admin.' },
        { status: 500 }
      )
    }

    const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } })

    // Internal Supabase email for this username
    const authEmail = `${username.toLowerCase()}@musicweb.com`

    // --- Check if username already taken (case-insensitive) ---
    const existingRes = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const isUsernameTaken = existingRes.data?.users?.some((u) => {
      const uEmail = u.email?.toLowerCase() ?? ''
      const uUsername = u.user_metadata?.username?.toLowerCase() ?? ''
      return uEmail === authEmail.toLowerCase() || uUsername === username.toLowerCase()
    })

    if (isUsernameTaken) {
      return NextResponse.json(
        { ok: false, error: 'Tên tài khoản này đã được sử dụng. Vui lòng chọn tên khác!' },
        { status: 409 }
      )
    }

    // --- Check if realEmail already linked to another account ---
    if (realEmail) {
      const alreadyLinked = existingRes.data?.users?.some(
        (u) => u.user_metadata?.real_email?.toLowerCase() === realEmail.toLowerCase()
      )
      if (alreadyLinked) {
        return NextResponse.json(
          { ok: false, error: 'Gmail này đã được liên kết với một tài khoản khác!' },
          { status: 409 }
        )
      }
    }

    // --- Create Supabase Auth user via Admin API (email_confirm: true = no confirmation needed) ---
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        username,
        real_email: realEmail || null,
      },
    })

    if (createError) {
      const msg = createError.message?.toLowerCase() ?? ''
      if (msg.includes('already') || msg.includes('duplicate')) {
        return NextResponse.json({ ok: false, error: 'Tên tài khoản này đã được sử dụng!' }, { status: 409 })
      }
      return NextResponse.json({ ok: false, error: createError.message }, { status: 400 })
    }

    const userId = createData.user.id

    // --- Upsert into roles table ---
    await adminClient
      .from('roles')
      .upsert({ email: authEmail, role: 'user', roleApproved: true }, { onConflict: 'email' })

    // --- Notify admin (fire-and-forget with error logging) ---
    notifyAdmin(username, authEmail, realEmail).catch((err) => {
      console.warn('[REGISTER NOTIFY] Error sending notification email:', err?.message || err)
    })

    return NextResponse.json({ ok: true, authEmail, userId, username })
  } catch (err: any) {
    console.error('[REGISTER API] Unexpected error:', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Lỗi máy chủ' }, { status: 500 })
  }
}

async function notifyAdmin(username: string, authEmail: string, realEmail?: string) {
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER
  const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD
  if (!smtpUser || !smtpPass) return

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: smtpUser, pass: smtpPass },
    connectionTimeout: 4000,
    greetingTimeout: 4000,
    socketTimeout: 4000,
  })

  const now = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })

  await Promise.race([
    transporter.sendMail({
      from: `"MusicWeb Studio" <${smtpUser}>`,
      to: ADMIN_PERSONAL_EMAIL,
      subject: `🎵 [MusicWeb] Tài khoản mới: ${username}`,
      html: `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;background:#0b0e14;color:#fff;border-radius:18px;border:1px solid rgba(29,185,84,0.25);">
          <h1 style="color:#1DB954;font-size:20px;font-weight:800;margin:0 0 16px;">🎵 Tài Khoản Mới Đăng Ký</h1>
          <div style="background:#141a24;padding:18px;border-radius:12px;border:1px solid #1e293b;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:8px 0;border-bottom:1px solid #1e293b;color:#94a3b8;width:160px;">Tên tài khoản:</td><td style="padding:8px 0;border-bottom:1px solid #1e293b;color:#1DB954;font-weight:700;font-family:monospace;">${username}</td></tr>
              ${realEmail ? `<tr><td style="padding:8px 0;border-bottom:1px solid #1e293b;color:#94a3b8;">Gmail liên kết:</td><td style="padding:8px 0;border-bottom:1px solid #1e293b;color:#38bdf8;font-family:monospace;">${realEmail}</td></tr>` : ''}
              <tr><td style="padding:8px 0;color:#94a3b8;">Thời gian:</td><td style="padding:8px 0;color:#e2e8f0;">${now}</td></tr>
            </table>
          </div>
          <p style="color:#64748b;font-size:12px;text-align:center;margin:16px 0 0;">Thông báo tự động từ <strong>MusicWeb Studio System</strong></p>
        </div>
      `,
    }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4500)),
  ])
}
