import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'
import passkeysConfig from '@/config/passkeys.json'

// Admin's personal email to receive Passkey notifications (configurable via env)
const ADMIN_PERSONAL_EMAIL = process.env.ADMIN_PERSONAL_EMAIL || 'tranphong16012006@gmail.com'

// Helper to get valid Passkeys (dynamically read from disk + static import + fallback list)
function getValidPasskeys(): string[] {
  let jsonKeys: string[] = []
  
  // 1. Try reading passkeys.json dynamically from disk
  try {
    const configPath = path.join(process.cwd(), 'config', 'passkeys.json')
    if (fs.existsSync(configPath)) {
      const fileContent = fs.readFileSync(configPath, 'utf-8')
      const configData = JSON.parse(fileContent)
      if (Array.isArray(configData?.validPasskeys)) {
        jsonKeys = configData.validPasskeys
      }
    }
  } catch (err) {
    console.warn('Could not dynamically read config/passkeys.json:', err)
  }

  // 2. Static import fallback
  const importedKeys = Array.isArray(passkeysConfig?.validPasskeys) ? passkeysConfig.validPasskeys : []

  // 3. Built-in fallback passkeys
  const defaultKeys = [
    'MUSICWEB2026',
    'PASSKEY2026',
    'ADMIN2026',
    'PHONGTCT',
    'MUSICWEB-PASSKEY',
    'PHONGTCT2026',
    'PASSKEY',
    'ADMIN',
  ]

  return Array.from(new Set([...jsonKeys, ...importedKeys, ...defaultKeys]))
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

    const cleanEmail = String(email).trim().toLowerCase()
    const cleanPasskey = String(passkey).trim().toLowerCase().replace(/\s+/g, '')

    // 0. Email Regex Validation
    const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
    if (!EMAIL_REGEX.test(cleanEmail)) {
      return NextResponse.json(
        { error: 'Địa chỉ Gmail không đúng định dạng (ví dụ: user@gmail.com)' },
        { status: 400 }
      )
    }

    // 1. Strict Passkey Verification with intelligent alphanumeric normalization
    const validPasskeys = getValidPasskeys()
    const cleanAlphaNumericPasskey = cleanPasskey.replace(/[^a-z0-9]/g, '')

    console.log('[PASSKEY DEBUG] Input passkey raw:', JSON.stringify(passkey))
    console.log('[PASSKEY DEBUG] cleanPasskey:', JSON.stringify(cleanPasskey))
    console.log('[PASSKEY DEBUG] cleanAlphaNumericPasskey:', JSON.stringify(cleanAlphaNumericPasskey))
    console.log('[PASSKEY DEBUG] validPasskeys list:', JSON.stringify(validPasskeys))

    const isValidPasskey = validPasskeys.some((pk) => {
      const normalizedPk = String(pk).trim().toLowerCase().replace(/[^a-z0-9]/g, '')
      const match = (
        normalizedPk === cleanAlphaNumericPasskey ||
        normalizedPk === cleanPasskey ||
        String(pk).trim().toLowerCase() === String(passkey).trim().toLowerCase()
      )
      if (match) console.log('[PASSKEY DEBUG] Matched with pk:', JSON.stringify(pk))
      return match
    })

    console.log('[PASSKEY DEBUG] isValidPasskey:', isValidPasskey)

    if (!isValidPasskey) {
      return NextResponse.json(
        { error: `Mã Passkey "${passkey}" không hợp lệ. Vui lòng kiểm tra lại hoặc liên hệ Admin để nhận mã Passkey chính xác!` },
        { status: 401 }
      )
    }

    // 2. Automatically check if account already exists or add user to allowedAccounts.json
    let alreadyExists = false
    try {
      const configPath = path.join(process.cwd(), 'config', 'allowedAccounts.json')
      if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf-8')
        const configData = JSON.parse(fileContent)

        const isSystemAdmin = Array.isArray(configData?.adminEmails) && configData.adminEmails.some(
          (e: string) => String(e).trim().toLowerCase() === cleanEmail
        )

        const isAllowedUser = Array.isArray(configData?.allowedEmails) && configData.allowedEmails.some(
          (item: any) => item?.email && String(item.email).trim().toLowerCase() === cleanEmail
        )

        if (isSystemAdmin || isAllowedUser) {
          alreadyExists = true
        } else if (Array.isArray(configData.allowedEmails)) {
          configData.allowedEmails.push({
            email: cleanEmail,
            role: 'listener',
          })
          try {
            fs.writeFileSync(configPath, JSON.stringify(configData, null, 2), 'utf-8')
          } catch (writeErr) {
            console.warn('Vercel read-only filesystem, skipping local file write:', writeErr)
          }
        }
      }
    } catch (fsErr) {
      console.warn('Could not update allowedAccounts.json (non-fatal):', fsErr)
    }

    // 3. Send email to Admin's personal email address & user confirmation via SMTP
    let emailSent = false
    let emailStatusMessage = ''

    if (alreadyExists) {
      emailStatusMessage = `Tài khoản Gmail ${cleanEmail} này đã tồn tại và đã có sẵn quyền truy cập trong hệ thống!`
    }


    try {
      const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com'
      const smtpPort = Number(process.env.SMTP_PORT) || 587
      const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER
      const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD
      const targetAdminEmail = ADMIN_PERSONAL_EMAIL

      if (smtpUser && smtpPass) {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort,
          secure: smtpPort === 465,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
          connectionTimeout: 4000,
          greetingTimeout: 4000,
          socketTimeout: 4000,
        })

        const nowFormatted = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })

        // Primary email: Admin Notification
        const adminMailPromise = transporter.sendMail({
          from: `"MusicWeb Passkey System" <${smtpUser}>`,
          to: targetAdminEmail,
          subject: `🔑 [MusicWeb Passkey] Yêu cầu cấp quyền thành công: ${cleanEmail}`,
          html: `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #0b0e14; color: #ffffff; border-radius: 16px; border: 1px solid rgba(29, 185, 84, 0.3);">
              <div style="text-align: center; margin-bottom: 20px;">
                <h1 style="color: #1DB954; font-size: 22px; font-weight: 800; margin: 0 0 8px 0;">🔑 THÔNG BÁO XÁC THỰC PASSKEY</h1>
                <p style="color: #94a3b8; font-size: 13px; margin: 0;">Hệ thống MusicWeb vừa ghi nhận xác thực Passkey hợp lệ</p>
              </div>

              <div style="background-color: #141a24; padding: 20px; border-radius: 12px; border: 1px solid #1e293b; margin-bottom: 20px;">
                <div style="background-color: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 12px 16px; border-radius: 10px; margin-bottom: 16px;">
                  <div style="font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: bold; margin-bottom: 4px;">Gmail Người Dùng Đăng Ký Passkey:</div>
                  <div style="font-size: 18px; color: #38bdf8; font-weight: bold; font-family: monospace;">${cleanEmail}</div>
                </div>

                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #94a3b8; font-weight: bold; width: 170px;">Mã Passkey đã dùng:</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #1e293b; font-family: monospace; color: #f59e0b; font-weight: bold;">${cleanPasskey}</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #94a3b8; font-weight: bold;">Trạng Thái Quyền:</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #10b981; font-weight: bold;">✅ Đã Phê Duyệt / Cấp Quyền Listener</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #94a3b8; font-weight: bold;">Phương Thức Đăng Nhập:</td>
                    <td style="padding: 10px 0; border-bottom: 1px solid #1e293b; color: #e2e8f0; font-weight: 600;">Google OAuth (Gmail: ${cleanEmail})</td>
                  </tr>
                  <tr>
                    <td style="padding: 10px 0; color: #94a3b8; font-weight: bold;">Thời Gian Thực Hiện:</td>
                    <td style="padding: 10px 0; color: #e2e8f0;">${nowFormatted}</td>
                  </tr>
                </table>
              </div>

              <div style="text-align: center; color: #64748b; font-size: 12px; line-height: 1.5;">
                <p style="margin: 0;">Email tự động gửi từ <strong>MusicWeb Studio System</strong> tới Gmail Admin (${targetAdminEmail}).</p>
              </div>
            </div>
          `,
        })


        // Secondary email: Confirmation email to user if user email is different from admin email
        const mailPromises: Promise<any>[] = [adminMailPromise]

        if (cleanEmail !== targetAdminEmail.toLowerCase()) {
          mailPromises.push(
            transporter.sendMail({
              from: `"MusicWeb Studio" <${smtpUser}>`,
              to: cleanEmail,
              subject: `✅ Xác thực Passkey thành công - MusicWeb Studio`,
              html: `
                <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 550px; margin: 0 auto; padding: 24px; background-color: #0b0e14; color: #ffffff; border-radius: 16px; border: 1px solid rgba(29, 185, 84, 0.3);">
                  <h2 style="color: #1DB954; font-size: 20px; text-align: center; margin-bottom: 12px;">🎉 Xác Thực Passkey Thành Công!</h2>
                  <p style="color: #e2e8f0; font-size: 14px; line-height: 1.6;">Xin chào <strong>${cleanEmail}</strong>,</p>
                  <p style="color: #cbd5e1; font-size: 14px; line-height: 1.6;">
                    Yêu cầu truy cập bằng Mã Passkey của bạn đã được xác thực thành công. Tài khoản của bạn đã được cập nhật quyền truy cập MusicWeb Studio và thông báo đã được chuyển tới Admin (<strong>${targetAdminEmail}</strong>).
                  </p>
                  <div style="text-align: center; margin: 24px 0;">
                    <a href="${process.env.NEXTAUTH_URL || 'http://localhost:3000'}" style="background-color: #1DB954; color: #000000; font-weight: bold; text-decoration: none; padding: 12px 28px; border-radius: 9999px; font-size: 14px; display: inline-block;">Truy Cấp MusicWeb Ngay</a>
                  </div>
                  <p style="color: #64748b; font-size: 12px; text-align: center; margin: 0;">Trân trọng,<br/>Đội ngũ phát triển MusicWeb Studio</p>
                </div>
              `,
            }).catch((err) => console.warn('Could not send user confirmation email:', err))
          )
        }

        // Race with a 4.5s timeout so Vercel never hangs
        await Promise.race([
          Promise.all(mailPromises),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Email sending timeout')), 4500)
          ),
        ])

        emailSent = true
        emailStatusMessage = `Đã gửi mail thông báo tới Gmail cá nhân Admin (${targetAdminEmail}).`
      } else {
        emailStatusMessage = `Đã cấp quyền truy cập. (Lưu ý: Chưa cấu hình SMTP_PASS trong môi trường để gửi mail cá nhân).`
        console.log(`[PASSKEY NOTIFICATION] Email skipped (missing SMTP credentials). Admin target: ${targetAdminEmail}, User: ${cleanEmail}`)
      }
    } catch (mailErr: any) {
      console.warn('Could not send email notification to Admin (non-fatal):', mailErr)
      emailStatusMessage = `Đã cấp quyền thành công (Email SMTP gặp sự cố: ${mailErr?.message || 'xác thực SMTP'}).`
    }

    return NextResponse.json({
      success: true,
      email: cleanEmail,
      alreadyExists,
      message: alreadyExists
        ? `Tài khoản Gmail ${cleanEmail} này đã tồn tại và đã có sẵn quyền truy cập từ trước trong hệ thống!`
        : `Xác thực Passkey thành công! ${emailStatusMessage}`,
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

export async function GET() {
  return NextResponse.json(
    { error: 'Phương thức GET không được hỗ trợ. Vui lòng gửi yêu cầu bằng phương thức POST.' },
    { status: 405 }
  )
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Allow': 'POST, OPTIONS',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
