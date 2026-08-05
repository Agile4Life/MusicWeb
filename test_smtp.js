const nodemailer = require('nodemailer')
const fs = require('fs')
const path = require('path')

// Manually load .env.local
const envPath = path.join(__dirname, '.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  envContent.split('\n').forEach(line => {
    const parts = line.split('=')
    if (parts.length >= 2 && !line.trim().startsWith('#')) {
      const key = parts[0].trim()
      const val = parts.slice(1).join('=').trim()
      process.env[key] = val
    }
  })
}

async function testSmtp() {
  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com'
  const smtpPort = Number(process.env.SMTP_PORT) || 587
  const smtpUser = process.env.SMTP_USER || 'tranphong16012006@gmail.com'
  const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || ''
  const adminEmail = process.env.ADMIN_PERSONAL_EMAIL || 'tranphong16012006@gmail.com'

  console.log('=== TEST SMTP GMAIL CONFIGURATION ===')
  console.log('Host:', smtpHost)
  console.log('Port:', smtpPort)
  console.log('User:', smtpUser)
  console.log('Pass Status:', smtpPass ? 'OK (Password configured)' : '❌ MISSING (Mật khẩu ứng dụng SMTP_PASS bị trống!)')
  console.log('Target Email:', adminEmail)

  if (!smtpPass) {
    console.log('\n❌ NGUYÊN NHÂN CHƯA NHẬN ĐƯỢC MAIL THẬT:')
    console.log('Biến môi trường SMTP_PASS trong .env.local hiện đang BỊ TRỐNG!')
    console.log('Để Gmail chấp nhận gửi mail qua Nodemailer, bạn cần điền Mật khẩu ứng dụng 16 ký tự vào SMTP_PASS.\n')
    return
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    })

    console.log('\nĐang thử gửi mail tới', adminEmail, '...')
    const info = await transporter.sendMail({
      from: `"MusicWeb Passkey System" <${smtpUser}>`,
      to: adminEmail,
      subject: `🔑 [TEST SMTP] Kiểm thử gửi mail Passkey thành công`,
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #0b0e14; color: #ffffff; border-radius: 12px;">
          <h2 style="color: #1DB954;">🔑 Test Gmail SMTP Thành Công!</h2>
          <p>Email này xác nhận hệ thống SMTP của MusicWeb đã gửi mail thành công tới Gmail cá nhân của bạn: <strong>${adminEmail}</strong>.</p>
        </div>
      `,
    })

    console.log('✅ THÀNH CÔNG! Đã gửi mail thành công!')
    console.log('Message ID:', info.messageId)
  } catch (err) {
    console.error('❌ LỖI GỬI MAIL SMTP:', err.message || err)
  }
}

testSmtp()
