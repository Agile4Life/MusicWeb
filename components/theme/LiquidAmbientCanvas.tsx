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
  targetRadius: number
}

export function LiquidAmbientCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const { currentTheme, themeStyle, liquidGlassConfig } = useTheme()

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
    const c3 = currentTheme?.glowColor || '#38bdf8'

    const orbs: Orb[] = [
      { x: width * 0.25, y: height * 0.3, vx: 0.4, vy: 0.3, radius: 320, color: c1, targetRadius: 320 },
      { x: width * 0.75, y: height * 0.4, vx: -0.35, vy: 0.45, radius: 380, color: c2, targetRadius: 380 },
      { x: width * 0.5, y: height * 0.75, vx: 0.3, vy: -0.4, radius: 340, color: c3, targetRadius: 340 },
      { x: width * 0.15, y: height * 0.85, vx: -0.25, vy: -0.2, radius: 260, color: c1, targetRadius: 260 },
    ]

    let time = 0

    const render = () => {
      time += 0.006
      ctx.clearRect(0, 0, width, height)

      // Dark translucent backdrop
      ctx.fillStyle = currentTheme?.bgSpace || '#0a0e1a'
      ctx.fillRect(0, 0, width, height)

      // Draw morphing glowing orbs
      ctx.globalCompositeOperation = 'screen'

      orbs.forEach((orb, i) => {
        orb.x += orb.vx + Math.sin(time + i) * 0.5
        orb.y += orb.vy + Math.cos(time + i * 1.5) * 0.5

        if (orb.x < -100) orb.x = width + 100
        if (orb.x > width + 100) orb.x = -100
        if (orb.y < -100) orb.y = height + 100
        if (orb.y > height + 100) orb.y = -100

        const currentRadius = orb.radius + Math.sin(time * 2 + i) * 40

        const grad = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, currentRadius)
        grad.addColorStop(0, `${orb.color}33`) // ~20% alpha
        grad.addColorStop(0.5, `${orb.color}15`) // ~8% alpha
        grad.addColorStop(1, 'transparent')

        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.arc(orb.x, orb.y, currentRadius, 0, Math.PI * 2)
        ctx.fill()
      })

      ctx.globalCompositeOperation = 'source-over'
      animationFrameId = requestAnimationFrame(render)
    }

    render()

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationFrameId)
    }
  }, [currentTheme, themeStyle, liquidGlassConfig?.ambientCanvas])

  if (themeStyle !== 'liquid-glass' || liquidGlassConfig?.ambientCanvas === false) {
    return null
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full opacity-60 transition-opacity duration-1000"
    />
  )
}
