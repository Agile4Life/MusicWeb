import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import { authorizePasswordCredentials } from '@/lib/auth/credentials'
import nodemailer from 'nodemailer'

const ADMIN_PERSONAL_EMAIL = process.env.ADMIN_PERSONAL_EMAIL || 'tranphong16012006@gmail.com'

// Validate required environment variables in production
function validateRequiredEnv(): void {
  if (process.env.NODE_ENV === 'production') {
    const missing: string[] = []
    if (!process.env.GOOGLE_CLIENT_ID) missing.push('GOOGLE_CLIENT_ID')
    if (!process.env.GOOGLE_CLIENT_SECRET) missing.push('GOOGLE_CLIENT_SECRET')
    if (!process.env.NEXTAUTH_SECRET && !process.env.AUTH_SECRET) missing.push('NEXTAUTH_SECRET or AUTH_SECRET')
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`)
    }
  }
}

// Validate env on module load (only once per server instance)
validateRequiredEnv()

async function sendNewGoogleLoginNotification(email: string, name?: string | null) {
  try {
    const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com'
    const smtpPort = Number(process.env.SMTP_PORT) || 587
    const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER
    const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD
    if (!smtpUser || !smtpPass) return

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

    await Promise.race([
      transporter.sendMail({
        from: `"MusicWeb Studio" <${smtpUser}>`,
        to: ADMIN_PERSONAL_EMAIL,
        subject: `🔵 [MusicWeb] Người dùng mới đăng nhập Google: ${email}`,
        html: `
          <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:580px;margin:0 auto;padding:28px;background:#0b0e14;color:#fff;border-radius:18px;border:1px solid rgba(56,189,248,0.25);">
            <div style="text-align:center;margin-bottom:24px;">
              <h1 style="color:#38bdf8;font-size:22px;font-weight:800;margin:0 0 6px;">🔵 Lần Đầu Đăng Nhập Google</h1>
              <p style="color:#94a3b8;font-size:13px;margin:0;">Có tài khoản mới lần đầu truy cập MusicWeb bằng Google OAuth</p>
            </div>

            <div style="background:#141a24;padding:20px;border-radius:14px;border:1px solid #1e293b;margin-bottom:20px;">
              <div style="background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.3);padding:14px 18px;border-radius:12px;margin-bottom:16px;">
                <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.05em;margin-bottom:6px;">Gmail Đăng Nhập:</div>
                <div style="font-size:18px;color:#38bdf8;font-weight:800;font-family:monospace;">${email}</div>
              </div>

              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                ${name ? `
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-weight:700;width:170px;">Tên Hiển Thị:</td>
                  <td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#e2e8f0;font-weight:600;">${name}</td>
                </tr>` : ''}
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-weight:700;">Phương Thức:</td>
                  <td style="padding:10px 0;border-bottom:1px solid #1e293b;color:#e2e8f0;">Google OAuth (Đăng nhập lần đầu)</td>
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
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4500)),
    ])
    console.log('[AUTH SIGNIN] ✅ New Google login notification sent to admin for:', email)
  } catch (err: any) {
    console.warn('[AUTH SIGNIN] Email notification failed (non-fatal):', err?.message)
  }
}

export const authOptions: NextAuthOptions = {
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? (() => {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('GOOGLE_CLIENT_ID environment variable is required in production')
        }
        return 'YOUR_GOOGLE_CLIENT_ID_HERE'
      })(),
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? (() => {
        if (process.env.NODE_ENV === 'production') {
          throw new Error('GOOGLE_CLIENT_SECRET environment variable is required in production')
        }
        return 'YOUR_GOOGLE_CLIENT_SECRET_HERE'
      })(),
      authorization: {
        params: {
          prompt: 'select_account',
          access_type: 'offline',
          response_type: 'code',
        },
      },
    }),

    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        accessToken: { label: 'Supabase Access Token', type: 'text' },
      },
      async authorize(credentials) {
        return authorizePasswordCredentials(credentials)
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        const cleanEmail = user?.email?.trim().toLowerCase()
        if (!cleanEmail) return '/login?error=UnapprovedAccount'

        // Check Supabase roles table to detect first-time login
        let isFirstTime = true
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

        if (supabaseUrl && adminKey) {
          try {
            const rolesRes = await fetch(
              `${supabaseUrl}/rest/v1/roles?email=eq.${encodeURIComponent(cleanEmail)}&select=email`,
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
              if (Array.isArray(rows) && rows.length > 0) {
                isFirstTime = false
              }
            }
          } catch (err) {
            console.warn('[AUTH SIGNIN] Supabase roles check failed (non-fatal):', err)
          }

          // Upsert into roles table to record this user
          if (isFirstTime) {
            try {
              await fetch(`${supabaseUrl}/rest/v1/roles`, {
                method: 'POST',
                headers: {
                  apikey: adminKey,
                  Authorization: `Bearer ${adminKey}`,
                  'Content-Type': 'application/json',
                  Prefer: 'resolution=merge-duplicates',
                },
                body: JSON.stringify({ email: cleanEmail, role: 'user', roleApproved: true }),
              })
            } catch (err) {
              console.warn('[AUTH SIGNIN] Roles upsert failed (non-fatal):', err)
            }

            // 📧 Notify admin about first-time Google login
            sendNewGoogleLoginNotification(cleanEmail, user?.name).catch(() => {})
          }
        }

        console.log(`[AUTH SIGNIN] Google login: ${cleanEmail} | firstTime=${isFirstTime}`)
      }

      return true
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id
        token.email = user.email
      }

      // Google OAuth: check if this Google email is linked to a username account
      if (account?.provider === 'google' && user?.email) {
        const googleEmail = user.email.toLowerCase()
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (url && serviceKey) {
          try {
            const { createClient } = await import('@supabase/supabase-js')
            const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } })

            // Find a username account that has real_email matching this Google email
            const { data: listData } = await adminClient.auth.admin.listUsers({
              page: 1,
              perPage: 1000,
            })

            const linked = listData?.users?.find(
              (u) =>
                u.user_metadata?.real_email?.toLowerCase() === googleEmail &&
                u.email?.endsWith('@musicweb.com')
            )

            if (linked) {
              console.log(`[AUTH JWT] Google ${googleEmail} linked to account: ${linked.email}`)
              try {
                // Create a Supabase session for the linked username account
                const { data: sessionData, error: sessionErr } =
                  await (adminClient.auth.admin as any).createSession({ user_id: linked.id })

                if (!sessionErr && sessionData?.session) {
                  token.linkedEmail = linked.email
                  token.linkedUsername = linked.user_metadata?.username || linked.email?.split('@')[0]
                  token.supabaseAccessToken = sessionData.session.access_token
                  token.supabaseRefreshToken = sessionData.session.refresh_token
                  // Override the NextAuth email to the linked account's internal email
                  token.email = linked.email
                }
              } catch (sessionErr) {
                console.warn('[AUTH JWT] Could not create linked Supabase session (non-fatal):', sessionErr)
              }
            }
          } catch (err) {
            console.warn('[AUTH JWT] Google linking lookup failed (non-fatal):', err)
          }
        }
      }

      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id as string
        // Carry linked account info into the session
        if (token.linkedUsername) {
          (session.user as any).username = token.linkedUsername
        }
      }
      // Expose Supabase tokens so the client can establish a Supabase session
      if (token.supabaseAccessToken) {
        (session as any).supabaseAccessToken = token.supabaseAccessToken
        ;(session as any).supabaseRefreshToken = token.supabaseRefreshToken
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || (() => {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NEXTAUTH_SECRET or AUTH_SECRET environment variable is required in production')
    }
    // Only use default in development to avoid breaking local dev
    console.warn('[AUTH] Using default NEXTAUTH_SECRET in development mode. Set NEXTAUTH_SECRET in production!')
    return 'musicweb_nextauth_secret_key_84920482910_phongtct_dev_only'
  })(),
}
