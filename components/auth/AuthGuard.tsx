'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import { Disc } from 'lucide-react'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const supabase = createClient()
  const { data: nextAuthSession, status: nextAuthStatus } = useSession()
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkAuth() {
      if (nextAuthStatus === 'authenticated' && nextAuthSession?.user) {
        setAuthenticated(true)
        setLoading(false)
        return
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user || nextAuthSession?.user) {
        setAuthenticated(true)
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

  return <>{children}</>
}
