'use client'

import { useId } from 'react'
import { usePlaybackProgress } from './PlayerContext'
import { useTheme } from '@/components/theme/ThemeContext'

interface PlayerBarGlowBorderProps {
  duration?: number
  className?: string
  rx?: number
}

export function PlayerBarGlowBorder({ duration = 0, className = '', rx = 16 }: PlayerBarGlowBorderProps) {
  const { themeStyle } = useTheme()
  const { currentTime, duration: contextDuration } = usePlaybackProgress()
  const rawId = useId()
  const gradientId = `playerbar-perimeter-glow-${rawId.replace(/:/g, '')}`
  const effectiveDuration = duration || contextDuration || 0
  const progressRatio = effectiveDuration > 0 ? Math.min(1, Math.max(0, currentTime / effectiveDuration)) : 0

  if (themeStyle === 'minimal-flat' || effectiveDuration <= 0 || progressRatio <= 0) return null

  const strokeDashoffset = 100 * (1 - progressRatio)

  return (
    <svg
      className={`absolute inset-0 w-full h-full pointer-events-none z-10 overflow-visible ${className}`}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="var(--spotify-glow, #22d3ee)" stopOpacity="1" />
          <stop offset="50%" stopColor="var(--primary-spotify, #06b6d4)" stopOpacity="1" />
          <stop offset="100%" stopColor="var(--spotify-glow, #22d3ee)" stopOpacity="1" />
        </linearGradient>
      </defs>
      {/* Lightweight secondary glow stroke replacing per-tick CSS drop-shadow filter */}
      <rect
        x="1"
        y="1"
        width="calc(100% - 2px)"
        height="calc(100% - 2px)"
        rx={rx}
        pathLength={100}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="5"
        strokeOpacity="0.28"
        strokeLinecap="round"
        strokeDasharray="100"
        strokeDashoffset={strokeDashoffset}
        className="transition-[stroke-dashoffset] duration-[250ms] ease-linear motion-reduce:transition-none"
      />
      <rect
        x="1"
        y="1"
        width="calc(100% - 2px)"
        height="calc(100% - 2px)"
        rx={rx}
        pathLength={100}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="100"
        strokeDashoffset={strokeDashoffset}
        className="transition-[stroke-dashoffset] duration-[250ms] ease-linear motion-reduce:transition-none"
      />
    </svg>
  )
}
