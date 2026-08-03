'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Loader2, Disc } from 'lucide-react'

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const supabase = createClient()
  const [authenticated, setAuthenticated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function checkAuth() {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setAuthenticated(false)
        router.replace('/login')
      } else {
        setAuthenticated(true)
      }
      setLoading(false)
    }

    checkAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event: string, session: any) => {
      if (!session?.user) {
        setAuthenticated(false)
        router.replace('/login')
      } else {
        setAuthenticated(true)
      }
      setLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router, supabase])

  if (loading) {
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
