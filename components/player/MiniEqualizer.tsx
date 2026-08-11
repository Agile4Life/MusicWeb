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
        if (bar) bar.style.height = '4px'
      })
      return
    }

    let animId: number
    const updateBars = () => {
      barsRef.current.forEach((bar, i) => {
        if (!bar) return
        // Mini equalizer animation bounce
        const cycle = (Date.now() / 150 + i * 1.2) % (Math.PI * 2)
        const height = Math.floor(Math.sin(cycle) * 10 + 14 + (i % 2) * 4)
        bar.style.height = `${Math.max(4, Math.min(28, height))}px`
      })
      animId = requestAnimationFrame(updateBars)
    }

    animId = requestAnimationFrame(updateBars)
    return () => cancelAnimationFrame(animId)
  }, [isPlaying])

  return (
    <div className={`eq-container flex items-end gap-0.5 h-7 px-1.5 pointer-events-none select-none ${className}`} title="Audio Visualizer">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          ref={(el) => {
            barsRef.current[i] = el
          }}
          className="eq-bar w-0.75 rounded-xs transition-[height] duration-75"
          style={{
            height: isPlaying ? '14px' : '4px',
            backgroundColor: 'var(--accent, var(--spotify-glow, #22d3ee))',
          }}
        />
      ))}
    </div>
  )
}
