'use client'

import React, { useRef, useState, useEffect } from 'react'

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
  const containerRef = useRef<HTMLDivElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [overflowPx, setOverflowPx] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const checkOverflow = () => {
      const diff = Math.max(0, el.scrollWidth - el.clientWidth)
      setIsOverflowing(diff > 1)
      setOverflowPx(diff)
    }

    checkOverflow()
    const observer = new ResizeObserver(checkOverflow)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text])

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden min-w-0 ${className}`}
      title={title || text}
      onClick={onClick}
    >
      <span
        className={isOverflowing ? 'animate-marquee-text' : 'truncate block'}
        style={isOverflowing ? ({ ['--marquee-shift' as string]: `-${overflowPx}px` } as React.CSSProperties) : undefined}
      >
        {text}
      </span>
    </div>
  )
}
