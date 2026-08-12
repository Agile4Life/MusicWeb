'use client'

import React, { useRef, useCallback, useEffect, useState } from 'react'

interface TiltCardProps {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
  maxTilt?: number
}

export function TiltCard({
  children,
  className = '',
  style = {},
  maxTilt = 10,
}: TiltCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const [isHoverCapable, setIsHoverCapable] = useState(true)
  const [isReducedMotion, setIsReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hoverMatch = window.matchMedia('(hover: hover)')
    setIsHoverCapable(hoverMatch.matches)

    const motionMatch = window.matchMedia('(prefers-reduced-motion: reduce)')
    setIsReducedMotion(motionMatch.matches)

    const handleHoverChange = (e: MediaQueryListEvent) => setIsHoverCapable(e.matches)
    const handleMotionChange = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches)

    hoverMatch.addEventListener?.('change', handleHoverChange)
    motionMatch.addEventListener?.('change', handleMotionChange)

    return () => {
      hoverMatch.removeEventListener?.('change', handleHoverChange)
      motionMatch.removeEventListener?.('change', handleMotionChange)
    }
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isHoverCapable || isReducedMotion) return
      const card = cardRef.current
      if (!card) return

      const clientX = e.clientX
      const clientY = e.clientY

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }

      rafRef.current = requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return

        const x = clientX - rect.left
        const y = clientY - rect.top
        const centerX = rect.width / 2
        const centerY = rect.height / 2

        const rotateX = ((y - centerY) / centerY) * maxTilt
        const rotateY = ((centerX - x) / centerX) * maxTilt

        card.style.setProperty('--rotate-x', `${rotateX.toFixed(2)}deg`)
        card.style.setProperty('--rotate-y', `${rotateY.toFixed(2)}deg`)
        card.style.setProperty('--mouse-x', `${((x / rect.width) * 100).toFixed(1)}%`)
        card.style.setProperty('--mouse-y', `${((y / rect.height) * 100).toFixed(1)}%`)
      })
    },
    [isHoverCapable, isReducedMotion, maxTilt]
  )

  const handleMouseLeave = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }
    const card = cardRef.current
    if (!card) return

    card.style.setProperty('--rotate-x', '0deg')
    card.style.setProperty('--rotate-y', '0deg')
  }, [])

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`group perspective-1000 relative rounded-2xl bg-slate-900/40 border border-white/10 shadow-2xl overflow-hidden [transform-style:preserve-3d] transition-transform duration-200 ease-out transform-gpu motion-reduce:!transform-none ${className}`}
      style={{
        transform:
          isHoverCapable && !isReducedMotion
            ? 'perspective(1000px) rotateX(var(--rotate-x, 0deg)) rotateY(var(--rotate-y, 0deg))'
            : 'none',
        willChange: 'transform',
        ...style,
      }}
    >
      {/* 3D Depth Layer Children */}
      {children}

      {/* Specular Highlight & Holographic Shine Overlay */}
      {isHoverCapable && !isReducedMotion && (
        <div
          className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300 mix-blend-overlay motion-reduce:hidden z-20"
          style={{
            background:
              'radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(255,255,255,0.35) 0%, transparent 55%, rgba(255,255,255,0.05) 100%)',
          }}
        />
      )}
    </div>
  )
}
