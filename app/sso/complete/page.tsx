'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'

// Second half of the hoilauchay SSO handoff: /api/sso already verified the
// hlc_session and minted a Supabase access token for this email, it just
// couldn't establish the NextAuth cookie session itself (signIn() is a
// browser-only next-auth/react call). Bridges the same way a normal
// password login does — see components/auth/passwordSession.ts.
function SsoCompleteInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const email = params.get('email')
    const accessToken = params.get('accessToken')
    if (!email || !accessToken) {
      router.replace('/login?error=SsoInvalid')
      return
    }

    signIn('credentials', { redirect: false, email, accessToken })
      .then((result) => {
        if (result?.ok) {
          router.replace('/')
        } else {
          setError(result?.error || 'Đăng nhập thất bại')
          setTimeout(() => router.replace('/login?error=SsoInvalid'), 1500)
        }
      })
      .catch(() => {
        setError('Đăng nhập thất bại')
        setTimeout(() => router.replace('/login?error=SsoInvalid'), 1500)
      })
  }, [params, router])

  return (
    <div className="min-h-screen bg-[#07080c] flex items-center justify-center text-slate-400">
      {error ? `Lỗi đăng nhập: ${error}` : 'Đang đăng nhập…'}
    </div>
  )
}

export default function SsoCompletePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#07080c] flex items-center justify-center text-slate-400">Đang tải...</div>}>
      <SsoCompleteInner />
    </Suspense>
  )
}
