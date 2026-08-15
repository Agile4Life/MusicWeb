'use client'

import React, { useRef, useState, useCallback, useEffect } from 'react'
import { useTheme } from './ThemeContext'

interface LiquidGlassContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
  className?: string
  refractionMode?: 'standard' | 'polar' | 'prominent' | 'shader' | 'subtle'
  cornerRadius?: number
  enableElasticity?: boolean
  elasticity?: number
  active?: boolean
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
}

export function LiquidGlassContainer({
  children,
  className = '',
  refractionMode = 'standard',
  cornerRadius = 20,
  enableElasticity = false,
  elasticity = 0.12,
  active = false,
  onClick,
  style,
  ...rest
}: LiquidGlassContainerProps) {
  const { themeStyle, liquidGlassConfig } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 })
  const [isHovered, setIsHovered] = useState(false)

  const isLiquid = themeStyle === 'liquid-glass'
  const allowElastic = enableElasticity && liquidGlassConfig?.elasticInteraction !== false

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!allowElastic || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const dx = (e.clientX - centerX) * elasticity * 0.1
      const dy = (e.clientY - centerY) * elasticity * 0.1
      setMouseOffset({ x: dx, y: dy })
    },
    [allowElastic, elasticity]
  )

  const handleMouseLeave = () => {
    setIsHovered(false)
    setMouseOffset({ x: 0, y: 0 })
  }

  const handleMouseEnter = () => {
    setIsHovered(true)
  }

  const transformStyle =
    allowElastic && isHovered
      ? `translate3d(${mouseOffset.x}px, ${mouseOffset.y}px, 0)`
      : undefined

  const filterId =
    refractionMode === 'subtle'
      ? 'liquid-glass-subtle'
      : `liquid-glass-${liquidGlassConfig?.refractionMode || refractionMode}`

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      style={{
        borderRadius: `${cornerRadius}px`,
        transform: transformStyle,
        ...style,
      }}
      className={`relative overflow-hidden transition-transform duration-200 ease-out ${
        isLiquid ? 'liquid-glass-container' : ''
      } ${className}`}
      {...rest}
    >
      {/* Refraction backdrop layer */}
      {isLiquid && (
        <span
          className="pointer-events-none absolute inset-0 z-0 opacity-90 transition-opacity duration-300"
          style={{
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
            filter: `url(#${filterId})`,
          }}
          aria-hidden="true"
        />
      )}

      {/* Specular sheen gradient on top border */}
      {isLiquid && (
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/40 to-transparent"
          aria-hidden="true"
        />
      )}

      {/* Content wrapper */}
      <div className="relative z-10 h-full w-full">{children}</div>
    </div>
  )
}
