'use client'

import React from 'react'

interface MiniEqualizerProps {
  isPlaying: boolean
  className?: string
}

export function MiniEqualizer({ isPlaying, className = '' }: MiniEqualizerProps) {
  return (
    <div
      className={`flex items-end gap-[1.5px] h-3.5 px-0.5 pointer-events-none select-none shrink-0 ${className}`}
      title="Audio Visualizer"
    >
      {[1, 2, 3, 4].map((num) => (
        <div
          key={num}
          className={`w-[2px] h-3.5 rounded-full eq-bar-${num}`}
          style={{
            animationPlayState: isPlaying ? 'running' : 'paused',
            transform: isPlaying ? undefined : 'scaleY(0.2)',
            backgroundColor: 'var(--spotify-glow, #22d3ee)',
          }}
        />
      ))}
    </div>
  )
}

