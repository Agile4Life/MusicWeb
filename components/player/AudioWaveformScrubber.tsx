'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT } from '@/lib/motion'
import { usePlaybackProgress } from './PlayerContext'

interface AudioWaveformScrubberProps {
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
  duration,
  onSeek,
}: AudioWaveformScrubberProps) {
  const prefersReducedMotion = useReducedMotion()
  const { currentTime, duration: contextDuration } = usePlaybackProgress()
  const effectiveDuration = duration && duration > 0 ? duration : contextDuration || 0

  const [hoverTime, setHoverTime] = useState<number | null>(null)
  const [hoverX, setHoverX] = useState<number>(24)
  const [isDragging, setIsDragging] = useState<boolean>(false)
  const [showRemaining, setShowRemaining] = useState<boolean>(false)
  // While dragging, the bar follows the pointer locally; one seek happens on release
  // (seeking per frame opened a new ranged stream request each time).
  const [dragTime, setDragTime] = useState<number | null>(null)
  const dragTimeRef = useRef<number | null>(null)
  const setDrag = (t: number | null) => {
    dragTimeRef.current = t
    setDragTime(t)
  }

  const containerRef = useRef<HTMLDivElement | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
    }
  }, [])

  const safeDuration = effectiveDuration > 0 ? effectiveDuration : 0.0001
  const shownTime = dragTime ?? currentTime
  const progressRatio = safeDuration > 1 ? Math.min(Math.max(0, shownTime / safeDuration), 1) : 0

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!containerRef.current) return
      const isMouse = e.pointerType === 'mouse'
      if (!isMouse && !isDragging) return
      const clientX = e.clientX

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }

      rafRef.current = requestAnimationFrame(() => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        if (rect.width === 0) return
        const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
        const clampedX = Math.max(24, Math.min(x, Math.max(24, rect.width - 24)))
        const ratio = x / rect.width
        const calculatedTime = ratio * effectiveDuration

        setHoverX(clampedX)
        setHoverTime(calculatedTime)

        if (isDragging && effectiveDuration > 0) {
          dragTimeRef.current = calculatedTime
          setDragTime(calculatedTime)
        }
      })
    },
    [effectiveDuration, isDragging]
  )

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    setIsDragging(true)
    if (!containerRef.current || effectiveDuration <= 0) return
    const rect = containerRef.current.getBoundingClientRect()
    if (rect.width === 0) return
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const clampedX = Math.max(24, Math.min(x, Math.max(24, rect.width - 24)))
    const ratio = x / rect.width
    const calculatedTime = ratio * effectiveDuration
    setHoverX(clampedX)
    setHoverTime(calculatedTime)
    setDrag(calculatedTime)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {}
    setIsDragging(false)
    if (e.pointerType !== 'mouse') {
      setHoverTime(null)
    }
    const target = dragTimeRef.current
    setDrag(null)
    if (target !== null && e.type === 'pointerup') onSeek(target)
  }

  const remainingTime = Math.max(0, safeDuration - shownTime)

  return (
    <div
      className={`scrubber-wrapper w-full flex items-center justify-between gap-3 sm:gap-4 select-none px-1 ${
        isDragging ? 'is-dragging' : ''
      }`}
    >
      {/* Elapsed time */}
      <span className="scrubber-time-btn text-[11px] sm:text-xs font-mono tabular-nums text-slate-400 font-semibold w-10 text-right shrink-0">
        {formatTime(shownTime)}
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
        className="relative flex-1 h-8 lg:h-[18px] flex items-center cursor-pointer group px-0.5 touch-none"
      >
        {/* Floating Time Preview Tooltip */}
        <AnimatePresence>
          {hoverTime !== null && (
            <div
              className="absolute -top-7 lg:top-auto lg:bottom-[13px] -translate-x-1/2 pointer-events-none z-40"
              style={{ left: `${hoverX}px` }}
            >
              <motion.div
                initial={
                  prefersReducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, transform: 'translate3d(0, 2px, 0) scale(0.94)' }
                }
                animate={
                  prefersReducedMotion
                    ? { opacity: 1 }
                    : { opacity: 1, transform: 'translate3d(0, 0px, 0) scale(1)' }
                }
                exit={
                  prefersReducedMotion
                    ? { opacity: 0 }
                    : { opacity: 0, transform: 'translate3d(0, 2px, 0) scale(0.94)' }
                }
                transition={{ duration: 0.15, ease: EASE_OUT }}
                className="origin-bottom bg-[var(--elevation-2-bg,#0f172a)]/95 text-white text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border border-white/20 shadow-lg backdrop-blur-md leading-none"
              >
                <span>{formatTime(hoverTime)}</span>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* The Track */}
        <div className="scrubber-track">
          <div
            className="scrubber-fill motion-reduce:transition-none"
            style={{
              background: 'linear-gradient(90deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
              width: '100%',
              opacity: progressRatio > 0.001 ? 1 : 0,
              transformOrigin: 'left center',
              transform: `scaleX(${progressRatio})`,
              transition: isDragging ? 'none' : 'transform 220ms linear, opacity 140ms ease',
            }}
          />
          <div
            className="absolute inset-0 pointer-events-none motion-reduce:transition-none"
            style={{
              transform: `translate3d(${(progressRatio - 1) * 100}%, 0, 0)`,
              transition: isDragging ? 'none' : 'transform 220ms linear',
            }}
          >
            <div className="scrubber-thumb" style={{ left: '100%' }} />
          </div>
        </div>
      </div>

      {/* Total / Remaining Duration toggle */}
      <button
        type="button"
        onClick={() => setShowRemaining((prev) => !prev)}
        className="scrubber-time-btn text-[11px] sm:text-xs font-mono tabular-nums text-slate-400 hover:text-white font-semibold w-10 text-left shrink-0 active:scale-[0.97] transition-[color,transform] duration-150 ease-[var(--ease-out)] cursor-pointer"
        title="Bấm để đổi giữa Thời lượng & Thời gian còn lại"
      >
        {showRemaining ? `-${formatTime(remainingTime)}` : formatTime(effectiveDuration)}
      </button>
    </div>
  )
}
