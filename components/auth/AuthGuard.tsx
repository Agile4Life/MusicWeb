'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import { isAllowedToLogin } from '@/lib/accessControl'
import { Disc, ShieldAlert, LogOut } from 'lucide-react'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const supabase = createClient()
  const { data: nextAuthSession, status: nextAuthStatus } = useSession()
  const [authenticated, setAuthenticated] = useState(false)
  const [authorized, setAuthorized] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkAuth() {
      let email: string | null = null

      if (nextAuthStatus === 'authenticated' && nextAuthSession?.user?.email) {
        email = nextAuthSession.user.email
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (user?.email) {
          email = user.email
        }
      }

      if (email) {
        setUserEmail(email)
        setAuthenticated(true)
        const allowed = isAllowedToLogin(email)
        setAuthorized(allowed)
      } else if (nextAuthStatus !== 'loading') {
        setAuthenticated(false)
        router.replace('/login')
      }

      if (nextAuthStatus !== 'loading') {
        setLoading(false)
      }
    }

    checkAuth()
  }, [router, supabase, nextAuthSession, nextAuthStatus])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    await signOut({ callbackUrl: '/login' })
    router.replace('/login')
  }

  if (loading || nextAuthStatus === 'loading') {
    return (
      <div className="h-screen w-screen bg-[#07080c] flex flex-col items-center justify-center gap-4 text-slate-300">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#1DB954] to-cyan-400 p-0.5 shadow-2xl shadow-emerald-500/20">
          <div className="w-full h-full bg-[#0d0e15] rounded-[14px] flex items-center justify-center">
            <Disc className="w-8 h-8 text-[#1DB954] animate-spin" />
          </div>
        </div>
        <p className="text-xs font-bold text-slate-400 tracking-wider uppercase animate-pulse">
          Đang xác thực quyền truy cập...
        </p>
      </div>
    )
  }

  if (!authenticated) {
    return null
  }

  if (!authorized) {
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

  return <>{children}</>
}
