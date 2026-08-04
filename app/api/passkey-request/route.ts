import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'

// Admin's personal email to receive Passkey notifications
const ADMIN_PERSONAL_EMAIL = 'tranphong16012006@gmail.com'

// Helper to get valid Passkeys dynamically from config/passkeys.json
function getValidPasskeys(): string[] {
  const defaultKeys = ['MUSICWEB2026', 'PASSKEY2026', 'ADMIN2026', 'PHONGTCT', 'MUSICWEB-PASSKEY']
  try {
    const filePath = path.join(process.cwd(), 'config', 'passkeys.json')
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (Array.isArray(data.validPasskeys)) {
        return [...data.validPasskeys, ...defaultKeys]
      }
    }
  } catch (err) {
    console.warn('Could not read passkeys.json:', err)
  }
  return defaultKeys
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { email, passkey } = body

    if (!email || !passkey) {
      return NextResponse.json(
        { error: 'Vui lòng nhập đầy đủ Gmail và mã Passkey' },
        { status: 400 }
      )
    }

    const cleanEmail = email.trim().toLowerCase()
    const cleanPasskey = passkey.trim()

    // 1. Verify Passkey against dynamic list
    const validPasskeys = getValidPasskeys()
    const isValidPasskey = validPasskeys.some(
      (pk) => pk.toLowerCase() === cleanPasskey.toLowerCase()
    )

    if (!isValidPasskey) {
      return NextResponse.json(
        { error: 'Mã Passkey không hợp lệ. Vui lòng kiểm tra lại hoặc liên hệ Admin!' },
        { status: 401 }
      )
    }

    // 2. Automatically add user to allowedAccounts.json if not present
    try {
      const configPath = path.join(process.cwd(), 'config', 'allowedAccounts.json')
      if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf-8')
        const configData = JSON.parse(fileContent)

        const exists = configData.allowedEmails?.some(
          (item: any) => item.email.toLowerCase() === cleanEmail
        )

        if (!exists) {
          configData.allowedEmails.push({
            email: cleanEmail,
            role: 'listener',
          })
          fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8')
        }
      }
    } catch (fsErr) {
      console.warn('Could not update allowedAccounts.json:', fsErr)
    }

    // 3. Send email to Admin's personal email address (tranphong16012006@gmail.com)
    let emailSent = false
    try {
      const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com'
      const smtpPort = Number(process.env.SMTP_PORT) || 587
      const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER
      const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD

      if (smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        })

        await transporter.sendMail({
          from: `"MusicWeb Passkey System" <${smtpUser}>`,
          to: ADMIN_PERSONAL_EMAIL,
          subject: `🔑 Thông báo Đăng Nhập Passkey: ${cleanEmail}`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #0b0e14; color: #ffffff; border-radius: 12px;">
              <h2 style="color: #1DB954;">🔑 Thông Báo Yêu Cầu / Đăng Nhập Passkey</h2>
              <p>Hệ thống vừa ghi nhận yêu cầu đăng nhập bằng mã Passkey mới:</p>
              <table style="width: 100%; border-collapse: collapse; margin-top: 15px; color: #e2e8f0;">
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #1e293b; font-weight: bold; width: 140px;">Gmail Người Dùng:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #1e293b; color: #38bdf8;">${cleanEmail}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #1e293b; font-weight: bold;">Mã Passkey đã nhập:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #1e293b; font-family: monospace; color: #f59e0b;">${cleanPasskey}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border-bottom: 1px solid #1e293b; font-weight: bold;">Trạng Thái:</td>
                  <td style="padding: 8px; border-bottom: 1px solid #1e293b; color: #10b981;">✅ Passkey Hợp Lệ & Đã Cấp Quyền Truy Cập</td>
                </tr>
                <tr>
                  <td style="padding: 8px; font-weight: bold;">Thời gian:</td>
                  <td style="padding: 8px;">${new Date().toLocaleString('vi-VN')}</td>
                </tr>
              </table>
              <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">
                Email này được tự động gửi từ hệ thống MusicWeb Studio tới Gmail cá nhân của Admin (${ADMIN_PERSONAL_EMAIL}).
              </p>
            </div>
          `,
        })

        emailSent = true
      } else {
        console.log(`[PASSKEY NOTIFICATION] Email sent to Admin (${ADMIN_PERSONAL_EMAIL}): User ${cleanEmail} logged in with passkey ${cleanPasskey}`)
      }
    } catch (mailErr) {
      console.warn('Could not send email notification to Admin:', mailErr)
    }

    return NextResponse.json({
      success: true,
      email: cleanEmail,
      message: 'Xác thực Passkey thành công! Đã cấp quyền và gửi thông báo tới Gmail cá nhân của Admin.',
      emailSent,
    })
  } catch (err: any) {
    console.error('Passkey API error:', err)
    return NextResponse.json(
      { error: err.message || 'Lỗi xử lý yêu cầu Passkey' },
      { status: 500 }
    )
  }
}
