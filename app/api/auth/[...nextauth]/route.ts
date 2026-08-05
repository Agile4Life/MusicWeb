import NextAuth, { NextAuthOptions } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import CredentialsProvider from 'next-auth/providers/credentials'
import fs from 'fs'
import path from 'path'
import { cookies } from 'next/headers'

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
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        return {
          id: credentials.email,
          email: credentials.email,
          name: credentials.email.split('@')[0],
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        const cleanEmail = user?.email?.trim().toLowerCase()
        if (!cleanEmail) {
          return '/login?error=UnapprovedAccount'
        }

        let allowedList: string[] = []
        let allowAll = false

        try {
          const configPath = path.join(process.cwd(), 'config', 'allowedAccounts.json')
          if (fs.existsSync(configPath)) {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
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
          }
        } catch (err) {
          console.warn('Could not read allowedAccounts.json in NextAuth signIn callback:', err)
        }

        if (allowAll) return true

        try {
          const cookieStore = await cookies()
          const rawVal = cookieStore.get('approved_emails')?.value || cookieStore.get('musicweb_approved_emails')?.value
          if (rawVal) {
            const decoded = decodeURIComponent(rawVal)
            try {
              const parsed = JSON.parse(decoded)
              if (Array.isArray(parsed)) {
                parsed.forEach((e: string) => allowedList.push(String(e).trim().toLowerCase()))
              } else if (typeof parsed === 'string') {
                allowedList.push(parsed.trim().toLowerCase())
              }
            } catch {
              allowedList.push(decoded.trim().toLowerCase())
            }
          }
        } catch (cookieErr) {
          console.warn('Could not read approved_emails cookie in NextAuth signIn callback:', cookieErr)
        }


        const isAllowed = allowedList.includes(cleanEmail)

        if (!isAllowed) {
          console.warn(`[AUTH GUARD] Access denied for unapproved Google account: ${cleanEmail}`)
          return `/login?error=UnapprovedAccount&unapprovedEmail=${encodeURIComponent(cleanEmail)}`
        }
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

const handler = NextAuth(authOptions)

export { handler as GET, handler as POST }

