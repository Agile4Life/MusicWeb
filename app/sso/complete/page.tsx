'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT } from '@/lib/motion'
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
  const reduced = useReducedMotion()
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
      className="min-h-[100dvh] w-full flex items-center justify-center p-6"
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

        <AnimatePresence mode="wait" initial={false}>
          {error ? (
            <motion.div
              key="sso-error"
              initial={reduced ? { opacity: 0 } : { opacity: 0, transform: 'translate3d(0, 6px, 0) scale(0.985)' }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, transform: 'translate3d(0, -4px, 0) scale(0.985)' }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="flex flex-col items-center gap-6"
            >
              <div className="w-11 h-11 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">Không thể đăng nhập từ Hội Lẩu chay</p>
                <p className="text-xs text-slate-400 mt-1.5">Đang chuyển đến trang đăng nhập…</p>
              </div>
              <a
                href="/login"
                className="btn-3d-primary text-black font-extrabold py-3 px-6 rounded-full text-xs sm:text-sm"
              >
                Đến trang đăng nhập ngay
              </a>
            </motion.div>
          ) : (
            <motion.div
              key="sso-loading"
              initial={reduced ? { opacity: 0 } : { opacity: 0, transform: 'translate3d(0, 6px, 0) scale(0.985)' }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, transform: 'translate3d(0, -4px, 0) scale(0.985)' }}
              transition={{ duration: 0.2, ease: EASE_OUT }}
              className="flex flex-col items-center gap-6"
            >
              <div className="flex items-end gap-1 h-6 sso-bars" aria-hidden="true">
                <span className="w-1 rounded-full bg-[var(--spotify-glow,#22d3ee)] sso-bar" style={{ height: '40%', animationDelay: '-0.60s' }} />
                <span className="w-1 rounded-full bg-[var(--spotify-glow,#22d3ee)] sso-bar" style={{ height: '100%', animationDelay: '-0.45s' }} />
                <span className="w-1 rounded-full bg-[var(--spotify-glow,#22d3ee)] sso-bar" style={{ height: '65%', animationDelay: '-0.30s' }} />
                <span className="w-1 rounded-full bg-[var(--spotify-glow,#22d3ee)] sso-bar" style={{ height: '85%', animationDelay: '-0.15s' }} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-200">Đang đăng nhập từ Hội Lẩu chay…</p>
                <p className="text-xs text-slate-400 mt-1.5">Chỉ mất một chút thôi</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <style>{`
        .sso-bar {
          transform-origin: bottom;
          animation: ssoBar 850ms var(--ease-in-out-cubic, cubic-bezier(0.645, 0.045, 0.355, 1)) infinite alternate;
        }
        @keyframes ssoBar {
          from { transform: scaleY(0.35); }
          to { transform: scaleY(1); }
        }
        @keyframes ssoBarReduced {
          from { opacity: 0.4; }
          to { opacity: 0.95; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sso-bar {
            animation: ssoBarReduced 1.6s ease-in-out infinite alternate !important;
            transform: none !important;
          }
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
          className="min-h-[100dvh] w-full flex items-center justify-center"
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
