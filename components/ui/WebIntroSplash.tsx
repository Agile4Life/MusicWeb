/* eslint-disable @next/next/no-img-element -- Local brand assets render immediately at their intrinsic aspect ratios. */
'use client'

import React, { useEffect, useState, type CSSProperties } from 'react'
import {
  INTRO_EXIT_DURATION_MS,
  INTRO_REDUCED_MOTION_DURATION_MS,
  getIntroSplashTimings,
  shouldBypassIntroSplash,
} from './webIntroTiming'

declare global {
  interface Window {
    __musicwebAuthReady?: boolean
  }
}

const introStyle = {
  '--intro-exit-duration': `${INTRO_EXIT_DURATION_MS}ms`,
  '--intro-reduced-duration': `${INTRO_REDUCED_MOTION_DURATION_MS}ms`,
} as CSSProperties

export function WebIntroSplash() {
  const [phase, setPhase] = useState<'entering' | 'exiting' | 'done'>('entering')

  useEffect(() => {
    let hasSeenOnboardingFlag = false
    let isGamingMode = false

    try {
      hasSeenOnboardingFlag = window.localStorage.getItem('has_seen_onboarding') === 'true'
      isGamingMode = (
        window.localStorage.getItem('musicweb-gaming-mode') ??
        window.localStorage.getItem('musicweb_gaming_mode')
      ) === 'true'
    } catch {
      // Storage can be unavailable in private or embedded browsing contexts.
    }

    const completeIntro = () => {
      setPhase('done')
      window.dispatchEvent(new CustomEvent('musicweb:intro-complete'))
    }

    if (shouldBypassIntroSplash({ hasSeenOnboardingFlag, isGamingMode })) {
      const skipTimer = setTimeout(completeIntro, 0)
      return () => clearTimeout(skipTimer)
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timings = getIntroSplashTimings({ reducedMotion, skipIntro: false })

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
      exitTimer = setTimeout(completeIntro, timings.exitDurationMs)
    }

    const holdTimer = setTimeout(() => {
      minHoldDone = true
      tryStartExit()
    }, timings.holdDurationMs)

    // Even if authentication never responds, the intro must release the page.
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
      className="intro-splash-backdrop"
      style={introStyle}
    >
      <div className="intro-splash-ambient" />

      {/* Exit belongs to this wrapper so entrance keyframes can settle naturally. */}
      <div className="intro-splash-content">
        <div className="intro-splash-orbits">
          <span className="intro-splash-orbit" />
          <span className="intro-splash-orbit intro-splash-orbit-outer" />
        </div>

        <div className="intro-splash-plaque">
          <span className="intro-plaque-highlight" />
          <span className="intro-plaque-shimmer" />

          <div className="intro-icon-badge">
            <span className="intro-icon-halo" />
            <div className="intro-icon-frame">
              <img
                src="/favicon.ico"
                alt=""
                width={192}
                height={192}
                className="intro-favicon-img"
              />
            </div>
          </div>

          <div className="intro-plaque-divider" />

          <div className="intro-signature-wrap">
            <img
              src="/phong-signature.png"
              alt=""
              width={780}
              height={282}
              className="intro-signature-img signature-img-invert"
            />
          </div>

          {/* An ongoing light sweep, rather than a loading bar that stops full. */}
          <div className="intro-progress-track">
            <span className="intro-progress-fill" />
            <span className="intro-progress-runner" />
          </div>
        </div>

        <div className="intro-sound-signal">
          <span className="intro-sound-rule" />
          <div className="intro-equalizer">
            {Array.from({ length: 9 }, (_, index) => (
              <span key={index} className="intro-equalizer-bar" />
            ))}
          </div>
          <span className="intro-sound-rule" />
        </div>
      </div>
    </div>
  )
}
