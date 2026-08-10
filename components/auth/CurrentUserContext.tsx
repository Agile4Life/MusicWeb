'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'

interface CurrentUserContextType {
  userEmail: string | null
  loading: boolean
}

const CurrentUserContext = createContext<CurrentUserContextType>({
  userEmail: null,
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

  const userEmail = nextAuthSession?.user?.email || supabaseEmail

  return (
    <CurrentUserContext.Provider value={{ userEmail, loading }}>
      {children}
    </CurrentUserContext.Provider>
  )
}

export function useCurrentUser() {
  return useContext(CurrentUserContext)
}
