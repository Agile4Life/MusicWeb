'use client'

import React, { useRef, useCallback, useEffect, useState } from 'react'
import { calculateTilt } from './tiltCardMath'

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
  maxTilt = 8,
}: TiltCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const [isHovering, setIsHovering] = useState(false)
  const [isHoverCapable, setIsHoverCapable] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(hover: hover)').matches,
  )
  const [isReducedMotion, setIsReducedMotion] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const hoverMatch = window.matchMedia('(hover: hover)')
    const motionMatch = window.matchMedia('(prefers-reduced-motion: reduce)')

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

      if (!isHovering) setIsHovering(true)

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }

      rafRef.current = requestAnimationFrame(() => {
        const rect = card.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return

        const { rotateX, rotateY } = calculateTilt(
          { x: clientX - rect.left, y: clientY - rect.top, width: rect.width, height: rect.height },
          maxTilt,
        )

        card.style.setProperty('--rotate-x', `${rotateX}deg`)
        card.style.setProperty('--rotate-y', `${rotateY}deg`)
        card.style.setProperty('--mouse-x', `${(((clientX - rect.left) / rect.width) * 100).toFixed(1)}%`)
        card.style.setProperty('--mouse-y', `${(((clientY - rect.top) / rect.height) * 100).toFixed(1)}%`)
      })
    },
    [isHoverCapable, isReducedMotion, isHovering, maxTilt]
  )

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false)
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
      className={`group relative rounded-2xl bg-slate-900/40 border border-white/10 shadow-2xl overflow-hidden transition-transform duration-200 ease-out motion-reduce:!transform-none ${className}`}
      style={{
        transform:
          isHovering && isHoverCapable && !isReducedMotion
            ? 'perspective(1000px) rotateX(var(--rotate-x, 0deg)) rotateY(var(--rotate-y, 0deg))'
            : 'none',
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
