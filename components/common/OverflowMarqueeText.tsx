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

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const checkOverflow = () => {
      setIsOverflowing(el.scrollWidth > el.clientWidth + 1)
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
      <span className={isOverflowing ? 'animate-marquee-text' : 'truncate block'}>
        {text}
      </span>
    </div>
  )
}
