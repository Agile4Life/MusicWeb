import { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import fs from 'fs'
import path from 'path'
import { cookies } from 'next/headers'
import { authorizePasswordCredentials } from '@/lib/auth/credentials'

export const authOptions: NextAuthOptions = {
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '992317284123-u7l6n1ur1fcvl8v86t9sjkpoupal5nqk.apps.googleusercontent.com',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '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',
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
        console.log('[AUTH SIGNIN] Google OAuth callback triggered for email:', cleanEmail)

        if (!cleanEmail) {
          console.warn('[AUTH SIGNIN] No email found in Google OAuth user object')
          return '/login?error=UnapprovedAccount'
        }

        let allowedList: string[] = []
        let allowAll = false

        // 1. Read from bundled allowedAccounts.json (build-time snapshot)
        try {
          const configPath = path.join(process.cwd(), 'config', 'allowedAccounts.json')
          if (fs.existsSync(configPath)) {
            const rawContent = fs.readFileSync(configPath, 'utf-8')
            const data = JSON.parse(rawContent)
            console.log('[AUTH SIGNIN] allowedAccounts.json loaded, allowAllAsListeners:', data.allowAllAsListeners)

            if (data.allowAllAsListeners) {
              allowAll = true
            }
            if (Array.isArray(data.adminEmails)) {
              data.adminEmails.forEach((e: string) => allowedList.push(String(e).trim().toLowerCase()))
            }
            if (Array.isArray(data.allowedEmails)) {
              data.allowedEmails.forEach((item: any) => {
                if (item?.email) allowedList.push(String(item.email).trim().toLowerCase())
              })
            }
          } else {
            console.warn('[AUTH SIGNIN] allowedAccounts.json NOT found at:', configPath)
          }
        } catch (err) {
          console.warn('[AUTH SIGNIN] Error reading allowedAccounts.json:', err)
        }

        console.log('[AUTH SIGNIN] Allowed list from JSON file:', JSON.stringify(allowedList))

        if (allowAll) {
          console.log('[AUTH SIGNIN] allowAllAsListeners=true, granting access')
          return true
        }

        // 2. Read approved_emails from cookies (set by Passkey API)
        try {
          const cookieStore = await cookies()
          const cookieNames = ['approved_emails', 'musicweb_approved_emails']
          for (const cookieName of cookieNames) {
            const rawVal = cookieStore.get(cookieName)?.value
            if (rawVal) {
              console.log(`[AUTH SIGNIN] Found cookie "${cookieName}":`, rawVal.substring(0, 100))
              let parsed: any = null
              try {
                parsed = JSON.parse(rawVal)
              } catch {
                try {
                  parsed = JSON.parse(decodeURIComponent(rawVal))
                } catch {
                  const singleEmail = decodeURIComponent(rawVal).trim().toLowerCase()
                  if (singleEmail && !allowedList.includes(singleEmail)) {
                    allowedList.push(singleEmail)
                  }
                  continue
                }
              }
              if (Array.isArray(parsed)) {
                parsed.forEach((e: string) => {
                  const normalized = String(e).trim().toLowerCase()
                  if (normalized && !allowedList.includes(normalized)) {
                    allowedList.push(normalized)
                  }
                })
              } else if (typeof parsed === 'string') {
                const normalized = parsed.trim().toLowerCase()
                if (normalized && !allowedList.includes(normalized)) {
                  allowedList.push(normalized)
                }
              }
            }
          }
        } catch (cookieErr) {
          console.warn('[AUTH SIGNIN] Could not read approved_emails cookie:', cookieErr)
        }

        console.log('[AUTH SIGNIN] Final allowed list (JSON + cookies):', JSON.stringify(allowedList))

        // 3. Server-side persistent approval: check Supabase `roles` table
        let isAllowed = allowedList.includes(cleanEmail)
        if (!isAllowed) {
          try {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
            const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
            if (supabaseUrl && adminKey) {
              const rolesRes = await fetch(
                `https://${supabaseUrl.replace('https://', '')}/rest/v1/roles?email=eq.${encodeURIComponent(cleanEmail)}&select=roleApproved`,
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
                  console.log('[AUTH SIGNIN] ✅ Email approved via Supabase roles table:', cleanEmail)
                  isAllowed = true
                }
              } else {
                console.warn('[AUTH SIGNIN] Supabase roles lookup status:', rolesRes.status)
              }
            }
          } catch (dbErr) {
            console.warn('[AUTH SIGNIN] Could not check Supabase roles table:', dbErr)
          }
        }

        console.log('[AUTH SIGNIN] Checking if email is allowed:', cleanEmail, '→', isAllowed)

        if (!isAllowed) {
          console.warn(`[AUTH GUARD] ❌ Access DENIED for unapproved Google account: ${cleanEmail}`)
          console.warn(`[AUTH GUARD] Allowed list was:`, JSON.stringify(allowedList))
          return `/login?error=UnapprovedAccount&unapprovedEmail=${encodeURIComponent(cleanEmail)}`
        }

        console.log(`[AUTH GUARD] ✅ Access GRANTED for: ${cleanEmail}`)
      }

      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.email = user.email
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id as string
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'musicweb_nextauth_secret_key_84920482910_phongtct',
}
