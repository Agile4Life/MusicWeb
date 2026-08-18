'use client'

import React, { useEffect, useRef } from 'react'
import { useTheme } from './ThemeContext'

interface Orb {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  color: string
}

export function LiquidAmbientCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const { currentTheme, themeStyle, liquidGlassConfig } = useTheme()

  const refractionMode = liquidGlassConfig?.refractionMode || 'standard'

  useEffect(() => {
    if (themeStyle !== 'liquid-glass' || liquidGlassConfig?.ambientCanvas === false) {
      return
    }

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

    // Palette colors from current active theme
    const c1 = currentTheme?.accentColor || '#22d3ee'
    const c2 = currentTheme?.secondaryColor || '#6366f1'
    const c3 = currentTheme?.glowColor || '#ec4899'

    // Extra chromatic colors for prominent / shader modes
    const cRed = '#f43f5e'
    const cCyan = '#06b6d4'
    const cPurple = '#a855f7'

    const orbs: Orb[] = [
      { x: width * 0.2, y: height * 0.25, vx: 0.5, vy: 0.4, radius: 340, color: c1 },
      { x: width * 0.8, y: height * 0.35, vx: -0.4, vy: 0.5, radius: 400, color: c2 },
      { x: width * 0.5, y: height * 0.75, vx: 0.35, vy: -0.45, radius: 360, color: c3 },
      { x: width * 0.15, y: height * 0.85, vx: -0.3, vy: -0.3, radius: 280, color: refractionMode === 'prominent' ? cRed : c1 },
      { x: width * 0.85, y: height * 0.8, vx: -0.4, vy: 0.3, radius: 320, color: refractionMode === 'shader' ? cPurple : cCyan },
    ]

    let time = 0

    let isHidden = document.hidden

    const render = () => {
      if (isHidden) {
        // Tab is hidden — skip rendering, schedule next check
        animationFrameId = requestAnimationFrame(render)
        return
      }
      // Different speed and animation physics depending on refraction mode
      const speed = refractionMode === 'shader' ? 0.015 : refractionMode === 'polar' ? 0.012 : refractionMode === 'prominent' ? 0.01 : 0.006
      time += speed
      ctx.clearRect(0, 0, width, height)


      // Dark translucent backdrop
      ctx.fillStyle = currentTheme?.bgSpace || '#07090e'
      ctx.fillRect(0, 0, width, height)

      ctx.globalCompositeOperation = 'screen'

      if (refractionMode === 'polar') {
        // === Polar Mode: Swirling circular radial vortex ===
        const centerX = width / 2
        const centerY = height / 2

        // Radiating concentric pulsing rings
        for (let r = 1; r <= 3; r++) {
          const ringRadius = ((time * 80 + r * 180) % (Math.max(width, height) * 0.7)) + 50
          const ringGrad = ctx.createRadialGradient(centerX, centerY, ringRadius * 0.8, centerX, centerY, ringRadius)
          ringGrad.addColorStop(0, 'transparent')
          ringGrad.addColorStop(0.5, `${c1}18`)
          ringGrad.addColorStop(1, 'transparent')
          ctx.fillStyle = ringGrad
          ctx.beginPath()
          ctx.arc(centerX, centerY, ringRadius, 0, Math.PI * 2)
          ctx.fill()
        }

        orbs.forEach((orb, i) => {
          const angle = time * 0.8 + (i * Math.PI * 2) / orbs.length
          const dist = Math.min(width, height) * 0.28 + Math.sin(time + i) * 60
          orb.x = centerX + Math.cos(angle) * dist
          orb.y = centerY + Math.sin(angle) * dist

          const grad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.radius)
          grad.addColorStop(0, `${orb.color}44`)
          grad.addColorStop(0.6, `${orb.color}18`)
          grad.addColorStop(1, 'transparent')

          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2)
          ctx.fill()
        })
      } else if (refractionMode === 'prominent') {
        // === Prominent Mode: High-contrast Prismatic RGB split beams ===
        orbs.forEach((orb, i) => {
          orb.x += orb.vx * 1.5 + Math.sin(time * 1.8 + i) * 1.2
          orb.y += orb.vy * 1.5 + Math.cos(time * 1.8 + i * 1.5) * 1.2

          if (orb.x < -100) orb.x = width + 100
          if (orb.x > width + 100) orb.x = -100
          if (orb.y < -100) orb.y = height + 100
          if (orb.y > height + 100) orb.y = -100

          const r = orb.radius + Math.sin(time * 3 + i) * 50

          // High saturation prismatic gradients
          const grad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, r)
          grad.addColorStop(0, `${orb.color}66`) // ~40% intense alpha
          grad.addColorStop(0.4, `${orb.color}28`)
          grad.addColorStop(1, 'transparent')

          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(orb.x, orb.y, r, 0, Math.PI * 2)
          ctx.fill()
        })
      } else if (refractionMode === 'shader') {
        // === Shader SDF Mode: Fluid dynamic wave ripple mesh ===
        orbs.forEach((orb, i) => {
          orb.x += Math.sin(time * 1.2 + i * 1.4) * 2.5
          orb.y += Math.cos(time * 1.5 + i * 1.1) * 2.5

          const r = orb.radius + Math.sin(time * 4 + i * 2) * 60

          const grad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, r)
          grad.addColorStop(0, `${orb.color}55`)
          grad.addColorStop(0.5, `${orb.color}20`)
          grad.addColorStop(1, 'transparent')

          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(orb.x, orb.y, r, 0, Math.PI * 2)
          ctx.fill()
        })
      } else {
        // === Standard Mode: Smooth elegant organic drift ===
        orbs.forEach((orb, i) => {
          orb.x += orb.vx + Math.sin(time + i) * 0.5
          orb.y += orb.vy + Math.cos(time + i * 1.5) * 0.5

          if (orb.x < -100) orb.x = width + 100
          if (orb.x > width + 100) orb.x = -100
          if (orb.y < -100) orb.y = height + 100
          if (orb.y > height + 100) orb.y = -100

          const currentRadius = orb.radius + Math.sin(time * 2 + i) * 35

          const grad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, currentRadius)
          grad.addColorStop(0, `${orb.color}35`)
          grad.addColorStop(0.5, `${orb.color}14`)
          grad.addColorStop(1, 'transparent')

          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(orb.x, orb.y, currentRadius, 0, Math.PI * 2)
          ctx.fill()
        })
      }

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
  }, [currentTheme, themeStyle, refractionMode, liquidGlassConfig?.ambientCanvas])

  if (themeStyle !== 'liquid-glass' || liquidGlassConfig?.ambientCanvas === false) {
    return null
  }

  const opacityClass =
    refractionMode === 'prominent'
      ? 'opacity-85'
      : refractionMode === 'shader'
      ? 'opacity-75'
      : refractionMode === 'polar'
      ? 'opacity-70'
      : 'opacity-60'

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-0 h-full w-full ${opacityClass} transition-opacity duration-700`}
    />
  )
}
