'use client'

import React, { useEffect, useState, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import { Headphones } from 'lucide-react'
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
        setUserEmail(null)
        if (pathname !== '/login' && pathname !== '/register' && pathname !== '/reset-password') {
          router.replace('/login')
        }
      }

      setChecking(false)
    }

    verifyAuth()

    return () => {
      isMounted = false
    }
  }, [nextAuthSession, nextAuthStatus, supabase])

  // 1. Loading state
  if (checking) {
    return (
      <div className="h-screen w-screen bg-[#07080c] flex flex-col items-center justify-center gap-4 text-slate-300">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-cyan-400 via-teal-400 to-blue-600 p-0.5 shadow-2xl shadow-cyan-500/20">
          <div className="w-full h-full bg-[#080c14] rounded-[14px] flex items-center justify-center">
            <Headphones className="w-8 h-8 text-cyan-400 animate-pulse drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
          </div>
        </div>
        <p className="text-xs font-bold text-slate-400 tracking-wider uppercase animate-pulse">
          Đang tải...
        </p>
      </div>
    )
  }

  // 2. Not logged in -> Show Login Form
  if (!userEmail) {
    return <AuthForm mode="login" />
  }

  // 3. Logged in -> Render App
  return <>{children}</>
}
