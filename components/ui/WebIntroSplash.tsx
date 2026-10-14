'use client'

import React, { useEffect, useState } from 'react'
import { getIntroSplashTimings, shouldBypassIntroSplash } from './webIntroTiming'

declare global {
  interface Window {
    __musicwebAuthReady?: boolean
  }
}

export function WebIntroSplash() {
  const [phase, setPhase] = useState<'entering' | 'exiting' | 'done'>('entering')

  useEffect(() => {
    const hasSeenOnboardingFlag =
      window.localStorage.getItem('has_seen_onboarding') === 'true'
    const isGamingMode =
      window.localStorage.getItem('musicweb_gaming_mode') === 'true'

    if (shouldBypassIntroSplash({ hasSeenOnboardingFlag, isGamingMode })) {
      const skipTimer = setTimeout(() => setPhase('done'), 0)
      return () => clearTimeout(skipTimer)
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timings = getIntroSplashTimings({
      reducedMotion,
      skipIntro: false,
    })

    let minHoldDone = false
    let authDone =
      Boolean(window.__musicwebAuthReady) ||
      window.location.pathname.startsWith('/login') ||
      window.location.pathname.startsWith('/register') ||
      window.location.pathname.startsWith('/reset-password') ||
      window.location.pathname.startsWith('/qr-tree')
    let exitStarted = false
    let exitTimer: ReturnType<typeof setTimeout> | null = null

    const tryStartExit = () => {
      if (exitStarted || !minHoldDone || !authDone) return
      exitStarted = true
      setPhase('exiting')
      exitTimer = setTimeout(() => {
        setPhase('done')
        window.dispatchEvent(new CustomEvent('musicweb:intro-complete'))
      }, timings.exitDurationMs)
    }

    const holdTimer = setTimeout(() => {
      minHoldDone = true
      tryStartExit()
    }, timings.holdDurationMs)

    // Safety fallback so the splash never blocks indefinitely even on slow networks
    const maxWaitTimer = setTimeout(() => {
      authDone = true
      minHoldDone = true
      tryStartExit()
    }, Math.max(timings.holdDurationMs + 1000, 3600))

    const handleAuthReady = () => {
      authDone = true
      tryStartExit()
    }

    window.addEventListener('musicweb:auth-ready', handleAuthReady)

    return () => {
      clearTimeout(holdTimer)
      clearTimeout(maxWaitTimer)
      if (exitTimer) clearTimeout(exitTimer)
      window.removeEventListener('musicweb:auth-ready', handleAuthReady)
    }
  }, [])

  if (phase === 'done') return null

  return (
    <div
      data-phase={phase}
      aria-hidden="true"
      className={`intro-splash-backdrop fixed inset-0 z-[9995] flex flex-col items-center justify-center select-none overflow-hidden ${
        phase === 'exiting' ? 'pointer-events-none' : ''
      }`}
    >
      {/* Ambient theme glow behind the central logo plaque */}
      <div className="intro-splash-ambient pointer-events-none absolute inset-0" />

      {/* Center Brand Logo Plaque (modeled after .sidebar-logo-plaque) */}
      <div
        data-phase={phase}
        className="intro-splash-plaque relative flex items-center gap-4 sm:gap-5 px-6 sm:px-8 py-4 sm:py-5 rounded-[24px]"
      >
        {/* Top specular highlight arc */}
        <span
          className="pointer-events-none absolute top-0 left-6 right-6 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.55) 50%, transparent 100%)',
          }}
        />

        {/* Diagonal specular shimmer across the plaque */}
        <span className="intro-plaque-shimmer pointer-events-none absolute inset-0" />

        {/* 1. Web Favicon Emblem (/favicon.ico) */}
        <div className="intro-icon-badge relative shrink-0">
          <span className="intro-icon-halo pointer-events-none absolute -inset-1.5 rounded-2xl" />
          <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-tr from-[var(--spotify-glow,#22d3ee)] via-[var(--primary-spotify,#06b6d4)] to-[var(--theme-secondary,#6366f1)] p-[1.5px] shadow-[0_8px_24px_rgba(0,0,0,0.45)]">
            <div className="w-full h-full bg-[#080c14] rounded-[14.5px] flex items-center justify-center relative overflow-hidden">
              <img
                src="/favicon.ico"
                alt="MusicWeb Favicon"
                className="intro-favicon-img w-full h-full object-cover rounded-[14px] drop-shadow-[0_0_10px_var(--theme-glow-shadow,rgba(34,211,238,0.8))]"
              />
            </div>
          </div>
        </div>

        {/* Subtle vertical glass divider */}
        <div className="intro-plaque-divider w-px h-9 sm:h-10 bg-gradient-to-b from-transparent via-white/20 to-transparent shrink-0" />

        {/* 2. Logo Signature Text ("MuSic" from /phong-signature.png) */}
        <div className="intro-signature-wrap relative flex items-center justify-start pr-1">
          <img
            src="/phong-signature.png"
            alt="MuSic Logo"
            className="intro-signature-img h-10 sm:h-12 w-auto object-contain signature-img-invert"
          />
        </div>

        {/* Bottom sleek soundwave progress line */}
        <div className="intro-progress-track pointer-events-none absolute bottom-0 left-6 right-6 h-[2px] overflow-hidden rounded-full bg-white/[0.06]">
          <div className="intro-progress-fill h-full w-full rounded-full" />
        </div>
      </div>
    </div>
  )
}
