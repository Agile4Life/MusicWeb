'use client'

import React, { useState, useRef, useMemo, useCallback } from 'react'
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
  isPlaying = false,
  trackId = 'default',
  onSeek,
  barCount = 100,
}: AudioWaveformScrubberProps) {
  const { duration: contextDuration } = usePlaybackProgress()
  const effectiveDuration = duration && duration > 0 ? duration : contextDuration || 0

  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState<number>(0)
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const [showRemaining, setShowRemaining] = useState<boolean>(false)

  const containerRef = useRef<HTMLDivElement | null>(null)

  // Generate dense realistic waveform heights (15% to 100%)
  const barHeights = useMemo(() => {
    const bars: number[] = []
    let seed = 0
    for (let i = 0; i < trackId.length; i++) {
      seed = (seed << 5) - seed + trackId.charCodeAt(i)
      seed |= 0
    }

    const pseudoRandom = (idx: number) => {
      const x = Math.sin(seed + idx * 8888) * 10000
      return x - Math.floor(x)
    }

    for (let i = 0; i < barCount; i++) {
      const posRatio = i / barCount
      const envelope = Math.sin(posRatio * Math.PI)
      const rawNoise = 0.25 + 0.75 * pseudoRandom(i)
      const heightPercent = Math.max(18, Math.min(100, Math.round((0.3 + 0.7 * rawNoise) * (0.45 + 0.55 * envelope) * 100)))
      bars.push(heightPercent)
    }
    return bars
  }, [trackId, barCount])

  const safeDuration = effectiveDuration > 0 ? effectiveDuration : 0.0001
  const progressRatio = safeDuration > 1 ? Math.min(Math.max(0, currentTime / safeDuration), 1) : 0
  const activeBarIndex = Math.floor(progressRatio * barCount)

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
      const ratio = x / rect.width
      const calculatedTime = ratio * effectiveDuration
      const calculatedIndex = Math.floor(ratio * barCount)

      setHoverX(x)
      setHoverTime(calculatedTime)
      setHoverIndex(calculatedIndex)

      if (isDragging && effectiveDuration > 0) {
        onSeek(calculatedTime)
      }
    },
    [effectiveDuration, barCount, isDragging, onSeek]
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
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
    setIsDragging(false)
  }

  const remainingTime = Math.max(0, safeDuration - currentTime)

  return (
    <div className="w-full flex items-center justify-between gap-3 sm:gap-4 select-none px-1">
      {/* Elapsed time */}
      <span className="text-[11px] sm:text-xs font-mono text-slate-400 font-semibold w-10 text-right shrink-0">
        {formatTime(currentTime)}
      </span>

      {/* Waveform Scrubber Interactive Track */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          if (!isDragging) {
            setHoverIndex(null)
            setHoverTime(null)
          }
        }}
        className="relative flex-1 h-10 sm:h-9 flex items-center cursor-pointer group px-0.5 touch-none"
      >
        {/* Floating Time Preview Tooltip */}
        {hoverTime !== null && (
          <div
            className="absolute -top-8 transform -translate-x-1/2 bg-slate-900/95 text-white text-[10px] sm:text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border border-cyan-400/40 shadow-2xl backdrop-blur-md pointer-events-none transition-transform z-40 flex items-center gap-1.5"
            style={{ left: `${hoverX}px` }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary-spotify,#06b6d4)] animate-ping" />
            <span>{formatTime(hoverTime)}</span>
          </div>
        )}

        {/* Hover Vertical Guide Line */}
        {hoverX > 0 && hoverIndex !== null && (
          <div
            className="absolute top-0 bottom-0 w-[1.5px] bg-cyan-300/60 pointer-events-none rounded-full transition-all z-10"
            style={{ left: `${hoverX}px` }}
          />
        )}

        {/* SVG Waveform Bars (100% Uniform Bar Widths) */}
        <svg
          className="w-full h-7 sm:h-6 overflow-visible pointer-events-none"
          viewBox="0 0 1000 100"
          preserveAspectRatio="none"
        >
          {barHeights.map((heightPct, idx) => {
            const isPlayed = idx <= activeBarIndex
            const isHovered = hoverIndex !== null && idx <= hoverIndex

            const step = 1000 / barCount
            const barWidth = Math.max(2, step * 0.58)
            const x = idx * step + (step - barWidth) / 2
            const height = Math.max(14, (heightPct / 100) * 85)
            const y = (100 - height) / 2
            const rx = barWidth / 2

            let fillColor = 'rgba(255, 255, 255, 0.3)'
            if (isPlayed) {
              fillColor = 'var(--primary-spotify, #06b6d4)'
            } else if (isHovered) {
              fillColor = 'rgba(255, 255, 255, 0.65)'
            }

            const isActivePlaying = isPlaying && idx === activeBarIndex

            return (
              <rect
                key={idx}
                x={x}
                y={y}
                width={barWidth}
                height={height}
                rx={rx}
                ry={rx}
                fill={fillColor}
                className={`transition-all duration-150 ${
                  isActivePlaying ? 'animate-pulse' : ''
                }`}
                style={{
                  filter: isPlayed && isPlaying && idx === activeBarIndex
                    ? 'drop-shadow(0 0 4px var(--theme-glow-shadow, rgba(6,182,212,0.8)))'
                    : 'none',
                }}
              />
            )
          })}
        </svg>
      </div>

      {/* Total / Remaining Duration toggle */}
      <button
        onClick={() => setShowRemaining((prev) => !prev)}
        className="text-[11px] sm:text-xs font-mono text-slate-400 hover:text-white font-semibold w-10 text-left shrink-0 transition-colors cursor-pointer"
        title="Bấm để đổi giữa Thời lượng & Thời gian còn lại"
      >
        {showRemaining ? `-${formatTime(remainingTime)}` : formatTime(effectiveDuration)}
      </button>
    </div>
  )
}
