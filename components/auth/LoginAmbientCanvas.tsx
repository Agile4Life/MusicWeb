'use client'

import React, { useEffect, useRef } from 'react'

/**
 * Lightweight ambient orb canvas for the login page.
 * Renders 4 soft, slow-moving luminous orbs that drift across the background,
 * creating the same "light source behind glass" effect used by LiquidAmbientCanvas
 * in the main app — but without requiring ThemeContext or liquid-glass mode.
 *
 * This is the Layer 0 that makes backdrop-filter: blur() on the login card
 * actually show light instead of just blurring a dark background.
 */

interface Orb {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
}

export function LoginAmbientCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationFrameId: number
    let width = (canvas.width = window.innerWidth)
    let height = (canvas.height = window.innerHeight)

    const handleResize = () => {
      if (!canvas) return
      width = canvas.width = window.innerWidth
      height = canvas.height = window.innerHeight
    }
    window.addEventListener('resize', handleResize)

    // Theme-aware palette — read CSS custom props or fallback
    const rootStyle = getComputedStyle(document.documentElement)
    const c1 = rootStyle.getPropertyValue('--spotify-glow').trim() || '#22d3ee'
    const c2 = rootStyle.getPropertyValue('--primary-spotify').trim() || '#6366f1'
    const c3 = '#ec4899'
    const bgSpace = rootStyle.getPropertyValue('--bg-space').trim() || '#07090e'

    const orbs: Orb[] = [
      { x: width * 0.2, y: height * 0.15, vx: 0.4, vy: 0.3, radius: 420, color: c1 },
      { x: width * 0.75, y: height * 0.25, vx: -0.35, vy: 0.4, radius: 480, color: c2 },
      { x: width * 0.5, y: height * 0.65, vx: 0.3, vy: -0.35, radius: 400, color: c3 },
      { x: width * 0.85, y: height * 0.8, vx: -0.25, vy: -0.25, radius: 350, color: c1 },
      { x: width * 0.35, y: height * 0.5, vx: 0.2, vy: 0.3, radius: 380, color: c2 },
      { x: width * 0.6, y: height * 0.4, vx: -0.3, vy: -0.2, radius: 320, color: c3 },
    ]

    let time = 0
    let isHidden = document.hidden

    const render = () => {
      if (isHidden) {
        animationFrameId = requestAnimationFrame(render)
        return
      }

      time += 0.005
      ctx.clearRect(0, 0, width, height)

      // Dark base
      ctx.fillStyle = bgSpace
      ctx.fillRect(0, 0, width, height)

      ctx.globalCompositeOperation = 'screen'

      orbs.forEach((orb, i) => {
        orb.x += orb.vx + Math.sin(time + i) * 0.4
        orb.y += orb.vy + Math.cos(time + i * 1.3) * 0.4

        // Wrap around edges
        if (orb.x < -120) orb.x = width + 120
        if (orb.x > width + 120) orb.x = -120
        if (orb.y < -120) orb.y = height + 120
        if (orb.y > height + 120) orb.y = -120

        const currentRadius = orb.radius + Math.sin(time * 1.8 + i) * 40

        const grad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, currentRadius)
        grad.addColorStop(0, `${orb.color}90`)
        grad.addColorStop(0.35, `${orb.color}45`)
        grad.addColorStop(0.7, `${orb.color}15`)
        grad.addColorStop(1, 'transparent')

        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(orb.x, orb.y, currentRadius, 0, Math.PI * 2)
        ctx.fill()
      })

      ctx.globalCompositeOperation = 'source-over'
      animationFrameId = requestAnimationFrame(render)
    }

    const handleVisibility = () => {
      isHidden = document.hidden
    }
    document.addEventListener('visibilitychange', handleVisibility)

    render()

    return () => {
      window.removeEventListener('resize', handleResize)
      document.removeEventListener('visibilitychange', handleVisibility)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full opacity-90 transition-opacity duration-700"
    />
  )
}
