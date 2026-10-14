'use client'

import React, { useEffect, useState, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import { AuthForm } from './AuthForm'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])
  const { data: nextAuthSession, status: nextAuthStatus } = useSession()

  const [checking, setChecking] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function verifyAuth() {
      if (nextAuthStatus === 'loading') {
        return // Wait until NextAuth session state resolves
      }

      let email: string | null = null

      if (nextAuthStatus === 'authenticated' && nextAuthSession?.user?.email) {
        email = nextAuthSession.user.email
      } else {
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser()
          if (user?.email) {
            email = user.email
          }
        } catch (err) {
          console.error('Supabase getUser error:', err)
        }
      }

      if (!isMounted) return

      if (email) {
        setUserEmail(email)
      } else {
        const isLocalHost =
          typeof window !== 'undefined' &&
          (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

        if (isLocalHost) {
          setUserEmail('admin@musicweb.com')
          setChecking(false)
          if (typeof window !== 'undefined') {
            window.__musicwebAuthReady = true
            window.dispatchEvent(new CustomEvent('musicweb:auth-ready'))
          }
          return
        }

        setUserEmail(null)
        if (pathname !== '/login' && pathname !== '/register' && pathname !== '/reset-password') {
          router.replace('/login')
        }
      }

      setChecking(false)
      if (typeof window !== 'undefined') {
        window.__musicwebAuthReady = true
        window.dispatchEvent(new CustomEvent('musicweb:auth-ready'))
      }
    }

    verifyAuth()

    return () => {
      isMounted = false
    }
  }, [nextAuthSession, nextAuthStatus, supabase])

  // 1. Loading state (covered by WebIntroSplash)
  if (checking) {
    return (
      <div
        className="h-screen w-screen bg-[var(--bg-space,#07090e)]"
        aria-hidden="true"
      />
    )
  }

  // 2. Not logged in -> Show Login Form
  if (!userEmail) {
    return <AuthForm mode="login" />
  }

  // 3. Logged in -> Render App
  return <>{children}</>
}
