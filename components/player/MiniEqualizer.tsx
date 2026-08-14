'use client'

import React, { useEffect, useRef } from 'react'

interface MiniEqualizerProps {
  isPlaying: boolean
  className?: string
}

export function MiniEqualizer({ isPlaying, className = '' }: MiniEqualizerProps) {
  const barsRef = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    if (!isPlaying) {
      barsRef.current.forEach((bar) => {
        if (bar) bar.style.height = '3px'
      })
      return
    }

    let animId: number
    const updateBars = () => {
      barsRef.current.forEach((bar, i) => {
        if (!bar) return
        const cycle = (Date.now() / 150 + i * 1.2) % (Math.PI * 2)
        const height = Math.floor(Math.sin(cycle) * 4 + 7 + (i % 2) * 2)
        bar.style.height = `${Math.max(3, Math.min(14, height))}px`
      })
      animId = requestAnimationFrame(updateBars)
    }

    animId = requestAnimationFrame(updateBars)
    return () => cancelAnimationFrame(animId)
  }, [isPlaying])

  return (
    <div className={`flex items-end gap-[1.5px] h-3.5 px-0.5 pointer-events-none select-none shrink-0 ${className}`} title="Audio Visualizer">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          ref={(el) => {
            barsRef.current[i] = el
          }}
          className="w-[2px] rounded-full transition-[height] duration-75"
          style={{
            height: isPlaying ? '7px' : '3px',
            backgroundColor: 'var(--spotify-glow, #22d3ee)',
          }}
        />
      ))}
    </div>
  )
}
