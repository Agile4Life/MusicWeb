'use client'

import React, { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import { isAllowedToLogin } from '@/lib/accessControl'
import { Disc, ShieldAlert, LogOut } from 'lucide-react'
import { AuthForm } from './AuthForm'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()
  const { data: nextAuthSession, status: nextAuthStatus } = useSession()

  const [checking, setChecking] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [isAllowed, setIsAllowed] = useState(false)

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
        const allowed = isAllowedToLogin(email)
        setIsAllowed(allowed)
      } else {
        setUserEmail(null)
        setIsAllowed(false)
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
  }, [nextAuthSession, nextAuthStatus, pathname, router, supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    await signOut({ callbackUrl: '/login' })
    window.location.href = '/login'
  }

  // 1. Loading state (only during initial check, not during tab focus re-validations)
  if (checking && nextAuthStatus === 'loading') {
    return (
      <div className="h-screen w-screen bg-[#07080c] flex flex-col items-center justify-center gap-4 text-slate-300">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#1DB954] to-cyan-400 p-0.5 shadow-2xl shadow-emerald-500/20">
          <div className="w-full h-full bg-[#0d0e15] rounded-[14px] flex items-center justify-center">
            <Disc className="w-8 h-8 text-[#1DB954] animate-spin" />
          </div>
        </div>
        <p className="text-xs font-bold text-slate-400 tracking-wider uppercase animate-pulse">
          Đang kiểm tra quyền truy cập...
        </p>
      </div>
    )
  }

  // 2. Not logged in -> Show Login Form directly
  if (!userEmail) {
    return <AuthForm mode="login" />
  }

  // 3. Logged in BUT not in allowedAccounts -> Show Unauthorized Screen
  if (!isAllowed) {
    return (
      <div className="h-screen w-screen bg-[#07080c] flex items-center justify-center p-4 relative overflow-hidden select-none">
        <div className="w-full max-w-md glass-panel p-8 rounded-3xl border border-red-500/30 shadow-2xl relative overflow-hidden z-10 flex flex-col items-center text-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/30 flex items-center justify-center shadow-lg shadow-red-500/10">
            <ShieldAlert className="w-8 h-8 text-red-400" />
          </div>

          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-extrabold text-white">Chưa Được Cấp Quyền Truy Cập</h1>
            <p className="text-xs font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 p-3 rounded-2xl">
              ⚠️ Vui lòng liên hệ Admin để được cấp quyền!
            </p>
          </div>

          {userEmail && (
            <p className="text-[11px] text-slate-400 font-mono bg-black/40 px-3 py-1.5 rounded-xl border border-white/5">
              Email: <span className="text-white font-bold">{userEmail}</span>
            </p>
          )}

          <button
            onClick={handleSignOut}
            className="w-full bg-white/10 hover:bg-white/20 text-white font-bold py-3 rounded-full transition-all flex items-center justify-center gap-2 text-xs border border-white/10 mt-2"
          >
            <LogOut className="w-4 h-4" />
            <span>Đăng xuất & Thử tài khoản khác</span>
          </button>
        </div>
      </div>
    )
  }

  // 4. Logged in AND allowed -> Render App Layout & Page
  return <>{children}</>
}
