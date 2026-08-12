'use client'

import React, { useState, useRef, useCallback } from 'react'
import { usePlaybackProgress } from './PlayerContext'

interface AudioWaveformScrubberProps {
  currentTime: number
  duration: number
  isPlaying?: boolean
  trackId?: string
  onSeek: (seconds: number) => void
  barCount?: number
}

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export function AudioWaveformScrubber({
  currentTime,
  duration,
  onSeek,
}: AudioWaveformScrubberProps) {
  const { duration: contextDuration } = usePlaybackProgress()
  const effectiveDuration = duration && duration > 0 ? duration : contextDuration || 0

  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState<number>(0)
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const [showRemaining, setShowRemaining] = useState<boolean>(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)

  const safeDuration = effectiveDuration > 0 ? effectiveDuration : 0.0001
  const progressRatio = safeDuration > 1 ? Math.min(Math.max(0, currentTime / safeDuration), 1) : 0

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!containerRef.current) return
      const clientX = e.clientX

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }

      rafRef.current = requestAnimationFrame(() => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        if (rect.width === 0) return
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
        const ratio = x / rect.width
        const calculatedTime = ratio * effectiveDuration

        setHoverX(x)
        setHoverTime(calculatedTime)

        if (isDragging && effectiveDuration > 0) {
          onSeek(calculatedTime)
        }
      })
    },
    [effectiveDuration, isDragging, onSeek]
  )

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    if (!containerRef.current || effectiveDuration <= 0) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const ratio = x / rect.width
    onSeek(ratio * effectiveDuration)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
    setIsDragging(false)
  }

  const remainingTime = Math.max(0, safeDuration - currentTime)

  return (
    <div className="w-full flex items-center justify-between gap-3 sm:gap-4 select-none px-1">
      {/* Elapsed time */}
      <span className="text-[11px] sm:text-xs font-mono tabular-nums text-slate-400 font-semibold w-10 text-right shrink-0">
        {formatTime(currentTime)}
      </span>

      {/* Thin Progress Track with Round Thumb */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          if (!isDragging) {
            setHoverTime(null)
          }
        }}
        className={`relative flex-1 h-10 sm:h-9 flex items-center cursor-pointer group px-0.5 touch-none ${isDragging ? 'is-dragging' : ''}`}
      >
        {/* Floating Time Preview Tooltip */}
        {hoverTime !== null && (
          <div
            className="absolute -top-8 transform -translate-x-1/2 bg-slate-900/95 text-white text-[10px] sm:text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border border-white/20 shadow-2xl backdrop-blur-md pointer-events-none transition-transform z-40"
            style={{ left: `${hoverX}px` }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary-spotify,#06b6d4)] animate-ping" />
            <span>{formatTime(hoverTime)}</span>
          </div>
        )}

        {/* The Track */}
        <div className="scrubber-track">
          <div
            className="scrubber-fill"
            style={{
              background: 'var(--accent-gradient)',
              boxShadow: '0 0 8px var(--theme-glow-shadow, rgba(0,0,0,0.3))',
              width: `calc(${progressRatio * 100}%)`,
            }}
          />
          <div className="scrubber-thumb" style={{ left: `calc(${progressRatio * 100}%)` }} />
        </div>
      </div>

      {/* Total / Remaining Duration toggle */}
      <button
        onClick={() => setShowRemaining((prev) => !prev)}
        className="text-[11px] sm:text-xs font-mono tabular-nums text-slate-400 hover:text-white font-semibold w-10 text-left shrink-0 transition-colors cursor-pointer"
        title="Bấm để đổi giữa Thời lượng & Thời gian còn lại"
      >
        {showRemaining ? `-${formatTime(remainingTime)}` : formatTime(effectiveDuration)}
      </button>
    </div>
  )
}
