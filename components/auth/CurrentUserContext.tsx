'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'

interface CurrentUserContextType {
  userEmail: string | null
  username: string | null
  loading: boolean
}

const CurrentUserContext = createContext<CurrentUserContextType>({
  userEmail: null,
  username: null,
  loading: true,
})

export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const { data: nextAuthSession, status: nextAuthStatus } = useSession()
  const [supabaseEmail, setSupabaseEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (nextAuthStatus === 'loading') return

    if (nextAuthStatus === 'authenticated' && nextAuthSession?.user?.email) {
      // If Google login produced a linked Supabase session, establish it client-side
      const accessToken = (nextAuthSession as any).supabaseAccessToken
      const refreshToken = (nextAuthSession as any).supabaseRefreshToken
      if (accessToken && refreshToken) {
        const supabase = createClient()
        supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }).catch(() => {})
      }

      setSupabaseEmail(nextAuthSession.user.email)
      setLoading(false)
      return
    }

    const supabase = createClient()
    supabase.auth.getUser().then((res: any) => {
      if (cancelled) return
      setSupabaseEmail(res?.data?.user?.email || null)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [nextAuthStatus, nextAuthSession])

  const isLocalHost =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  const defaultLocalEmail = isLocalHost ? 'admin@musicweb.com' : null

  const userEmail = nextAuthSession?.user?.email || supabaseEmail || defaultLocalEmail
  const username = (nextAuthSession?.user as any)?.username || (defaultLocalEmail ? 'admin' : null)

  return (
    <CurrentUserContext.Provider value={{ userEmail, loading, username }}>
      {children}
    </CurrentUserContext.Provider>
  )
}

export function useCurrentUser() {
  return useContext(CurrentUserContext)
}
