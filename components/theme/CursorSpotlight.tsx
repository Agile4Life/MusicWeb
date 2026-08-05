'use client'

import React, { useEffect, useState } from 'react'

export function CursorSpotlight() {
  const [pos, setPos] = useState({ x: -500, y: -500 })
  const [opacity, setOpacity] = useState(0)

  useEffect(() => {
    let animationFrameId: number

    const handleMouseMove = (e: MouseEvent) => {
      animationFrameId = requestAnimationFrame(() => {
        setPos({ x: e.clientX, y: e.clientY })
        setOpacity(1)
      })
    }

    const handleMouseLeave = () => {
      setOpacity(0)
    }

    window.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseleave', handleMouseLeave)
      if (animationFrameId) cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <div
      className="pointer-events-none fixed inset-0 z-30 transition-opacity duration-300"
      style={{
        opacity,
        background: `radial-gradient(110px circle at ${pos.x}px ${pos.y}px, rgba(255, 255, 255, 0.10), transparent 80%)`,
      }}
    />
  )
}


