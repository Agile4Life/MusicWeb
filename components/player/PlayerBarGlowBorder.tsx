'use client'

import React from 'react'
import { usePlaybackProgress } from './PlayerContext'

interface PlayerBarGlowBorderProps {
  duration?: number
  className?: string
  rx?: number
}

export function PlayerBarGlowBorder({ duration = 0, className = '', rx = 16 }: PlayerBarGlowBorderProps) {
  const { currentTime, duration: contextDuration } = usePlaybackProgress()
  const effectiveDuration = duration || contextDuration || 0
  const progressRatio = effectiveDuration > 0 ? Math.min(1, Math.max(0, currentTime / effectiveDuration)) : 0

  if (effectiveDuration <= 0 || progressRatio <= 0) return null

  return (
    <svg
      className={`absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="playerbar-perimeter-glow" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--spotify-glow, #22d3ee)" stopOpacity="1" />
          <stop offset="50%" stopColor="var(--primary-spotify, #06b6d4)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--spotify-glow, #22d3ee)" stopOpacity="1" />
        </linearGradient>
      </defs>
      <rect
        x="1"
        y="1"
        width="calc(100% - 2px)"
        height="calc(100% - 2px)"
        rx={rx}
        pathLength={100}
        fill="none"
        stroke="url(#playerbar-perimeter-glow)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="100"
        strokeDashoffset={100 * (1 - progressRatio)}
        style={{
          filter: 'drop-shadow(0 0 6px var(--spotify-glow, #22d3ee)) drop-shadow(0 0 12px var(--theme-glow-shadow, rgba(6,182,212,0.9))) drop-shadow(0 0 20px rgba(34,211,238,0.55))',
          transition: 'stroke-dashoffset 0.25s linear',
        }}
      />
    </svg>
  )
}
