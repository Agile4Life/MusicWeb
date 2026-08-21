'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { AlertCircle } from 'lucide-react'

// Second half of the hoilauchay SSO handoff: /api/sso already verified the
// hlc_session and minted a Supabase access token for this email, it just
// couldn't establish the NextAuth cookie session itself (signIn() is a
// browser-only next-auth/react call). Bridges the same way a normal
// password login does — see components/auth/passwordSession.ts.
//
// This is the only thing a visitor coming from hoilauchay's "Nhạc" nav link
// actually sees — the two server-side hops before it (hoilauchay's own
// redirect, then /api/sso) are invisible page loads. It needs to read as a
// branded step of signing in, not a bare loading blip.
function SsoCompleteInner() {
  const router = useRouter()
  const params = useSearchParams()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const email = params.get('email')
    const accessToken = params.get('accessToken')
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, '', '/sso/complete')
    }
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
          setTimeout(() => router.replace('/login?error=SsoInvalid'), 2200)
        }
      })
      .catch(() => {
        setError('Đăng nhập thất bại')
        setTimeout(() => router.replace('/login?error=SsoInvalid'), 2200)
      })
  }, [params, router])

  return (
    <div
      className="min-h-screen w-screen flex items-center justify-center p-6"
      style={{ background: 'var(--bg-space, #0A0E1A)' }}
    >
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex items-center justify-center h-10">
          <img
            src="/phong-signature.png"
            alt="MusicWeb"
            className="h-10 w-auto object-contain signature-img-invert"
          />
        </div>

        {error ? (
          <>
            <div className="w-11 h-11 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">Không thể đăng nhập từ Hội Lẩu chay</p>
              <p className="text-xs text-slate-500 mt-1.5">Đang chuyển đến trang đăng nhập…</p>
            </div>
            <a
              href="/login"
              className="btn-3d-primary text-black font-extrabold py-3 px-6 rounded-full text-xs sm:text-sm"
            >
              Đến trang đăng nhập ngay
            </a>
          </>
        ) : (
          <>
            <div className="flex items-end gap-1 h-6" aria-hidden="true">
              <span className="w-1 rounded-full bg-[var(--spotify-glow,#22d3ee)]" style={{ height: '40%', animation: 'ssoBar 0.9s ease-in-out infinite', animationDelay: '0s' }} />
              <span className="w-1 rounded-full bg-[var(--spotify-glow,#22d3ee)]" style={{ height: '100%', animation: 'ssoBar 0.9s ease-in-out infinite', animationDelay: '0.15s' }} />
              <span className="w-1 rounded-full bg-[var(--spotify-glow,#22d3ee)]" style={{ height: '65%', animation: 'ssoBar 0.9s ease-in-out infinite', animationDelay: '0.3s' }} />
              <span className="w-1 rounded-full bg-[var(--spotify-glow,#22d3ee)]" style={{ height: '85%', animation: 'ssoBar 0.9s ease-in-out infinite', animationDelay: '0.45s' }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">Đang đăng nhập từ Hội Lẩu chay…</p>
              <p className="text-xs text-slate-500 mt-1.5">Chỉ mất một chút thôi</p>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes ssoBar {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}

export default function SsoCompletePage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen w-screen flex items-center justify-center"
          style={{ background: 'var(--bg-space, #0A0E1A)' }}
        >
          <img src="/phong-signature.png" alt="MusicWeb" className="h-10 w-auto object-contain signature-img-invert" />
        </div>
      }
    >
      <SsoCompleteInner />
    </Suspense>
  )
}
