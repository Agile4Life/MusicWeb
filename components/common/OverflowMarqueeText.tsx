'use client'

import React, { useRef, useState, useEffect } from 'react'
import { useReducedMotion } from 'framer-motion'

interface OverflowMarqueeTextProps {
  text: string
  className?: string
  title?: string
  onClick?: (e: React.MouseEvent) => void
}

export function OverflowMarqueeText({
  text,
  className = '',
  title,
  onClick,
}: OverflowMarqueeTextProps) {
  const reduced = useReducedMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLSpanElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [overflowPx, setOverflowPx] = useState(0)

  useEffect(() => {
    if (reduced) return
    const el = containerRef.current
    if (!el) return

    const checkOverflow = () => {
      const contentWidth = textRef.current ? textRef.current.scrollWidth : el.scrollWidth
      const diff = Math.max(0, Math.ceil(contentWidth - el.clientWidth))
      setIsOverflowing(diff > 1)
      setOverflowPx(diff)
    }

    checkOverflow()
    const observer = new ResizeObserver(checkOverflow)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, reduced])

  const shouldMarquee = isOverflowing && !reduced
  const durationSec = Number(Math.min(18, Math.max(6, overflowPx / 28 + 3.5)).toFixed(2))
  const edgeFadeMask =
    'linear-gradient(to right, #000 0%, #000 calc(100% - 12px), transparent 100%)'

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden min-w-0 ${className}`}
      style={
        shouldMarquee
          ? {
              maskImage: edgeFadeMask,
              WebkitMaskImage: edgeFadeMask,
            }
          : undefined
      }
      title={title || text}
      onClick={onClick}
    >
      <span
        ref={textRef}
        className={shouldMarquee ? 'animate-marquee-text' : 'truncate block'}
        style={
          shouldMarquee
            ? ({
                ['--marquee-shift' as string]: `-${overflowPx}px`,
                ['--marquee-duration' as string]: `${durationSec}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </div>
  )
}
