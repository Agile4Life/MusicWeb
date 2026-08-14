'use client'

import React, { useEffect, useRef } from 'react'

export function CursorSpotlight() {
  const spotlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let animationFrameId: number | null = null

    const handleMouseMove = (e: MouseEvent) => {
      if (animationFrameId !== null) return
      animationFrameId = requestAnimationFrame(() => {
        if (spotlightRef.current) {
          spotlightRef.current.style.opacity = '1'
          spotlightRef.current.style.background = `radial-gradient(110px circle at ${e.clientX}px ${e.clientY}px, rgba(255, 255, 255, 0.10), transparent 80%)`
        }
        animationFrameId = null
      })
    }

    const handleMouseLeave = () => {
      if (spotlightRef.current) {
        spotlightRef.current.style.opacity = '0'
      }
    }

    window.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseleave', handleMouseLeave)
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <div
      ref={spotlightRef}
      className="pointer-events-none fixed inset-0 z-30 transition-opacity duration-300 opacity-0"
    />
  )
}


