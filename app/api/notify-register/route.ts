import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

const ADMIN_PERSONAL_EMAIL = process.env.ADMIN_PERSONAL_EMAIL || process.env.SMTP_USER || ''

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = String(body?.email || '').trim().toLowerCase()
    const username = String(body?.username || '').trim()

    if (!email) {
      return NextResponse.json({ ok: false, error: 'missing_email' }, { status: 400 })
    }

    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com'
    const smtpPort = Number(process.env.SMTP_PORT) || 587
    const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER
    const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD

    if (!smtpUser || !smtpPass) {
      console.warn('[NOTIFY REGISTER] SMTP credentials not configured — skipping email.')
      return NextResponse.json({ ok: true, skipped: true })
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 4000,
      greetingTimeout: 4000,
      socketTimeout: 4000,
    })

    const nowFormatted = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    const displayName = username || email

    await Promise.race([
      transporter.sendMail({
        from: `"MusicWeb Studio" <${smtpUser}>`,
        to: ADMIN_PERSONAL_EMAIL,
        subject: `🎵 [MusicWeb] Tài khoản mới vừa đăng ký: ${displayName}`,
        html: `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;padding:28px;background:#0b0e14;color:#fff;border-radius:18px;border:1px solid rgba(29,185,84,0.25);">
            <div style="text-align:center;margin-bottom:24px;">
              <h1 style="color:#1DB954;font-size:22px;font-weight:800;margin:0 0 6px;">🎵 Tài Khoản Mới Đăng Ký</h1>
              <p style="color:#94a3b8;font-size:13px;margin:0;">MusicWeb vừa có thành viên mới tham gia</p>
            </div>

            <div style="background:#141a24;padding:20px;border-radius:14px;border:1px solid #1e293b;margin-bottom:20px;">
              <div style="background:rgba(29,185,84,0.1);border:1px solid rgba(29,185,84,0.3);padding:14px 18px;border-radius:12px;margin-bottom:16px;">
                <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.05em;margin-bottom:6px;">Email Đăng Ký:</div>
                <div style="font-size:18px;color:#1DB954;font-weight:800;font-family:monospace;">${email}</div>
              </div>

              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                ${username ? `
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-weight:700;width:170px;">Tên Tài Khoản:</td>
                  <td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#e2e8f0;font-weight:600;">${username}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-weight:700;">Phương Thức:</td>
                  <td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#e2e8f0;">Đăng ký tài khoản + mật khẩu</td>
                </tr>
                <tr>
                  <td style="padding:10px 0;color:#94a3b8;font-weight:700;">Thời Gian:</td>
                  <td style="padding:10px 0;color:#e2e8f0;">${nowFormatted}</td>
                </tr>
              </table>
            </div>

            <p style="color:#64748b;font-size:12px;text-align:center;margin:0;">
              Thông báo tự động từ <strong>MusicWeb Studio System</strong> gửi tới <strong>${ADMIN_PERSONAL_EMAIL}</strong>.
            </p>
          </div>
        `,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('email_timeout')), 4500)
      ),
    ])

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.warn('[NOTIFY REGISTER] Email send failed (non-fatal):', err?.message)
    return NextResponse.json({ ok: false, error: err?.message || 'error' }, { status: 200 })
  }
}
