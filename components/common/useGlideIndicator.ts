'use client'

import React, { useState, useRef, useCallback, useMemo } from 'react'

function isFinePointerHover(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches
}

export interface GlideIndicator2DState {
  left: number
  top: number
  width: number
  height: number
  opacity: number
  scaleX: number
  scaleY: number
}

export function useGridGlideIndicator() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<GlideIndicator2DState>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    opacity: 0,
    scaleX: 1,
    scaleY: 1,
  })

  const handleItemMouseEnter = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isFinePointerHover()) return
    const el = e.currentTarget
    const newLeft = el.offsetLeft
    const newTop = el.offsetTop
    const width = el.offsetWidth
    const height = el.offsetHeight

    setIndicator((prev) => {
      if (
        prev.left === newLeft &&
        prev.top === newTop &&
        prev.width === width &&
        prev.height === height &&
        prev.opacity === 1
      ) {
        return prev
      }
      return {
        left: newLeft,
        top: newTop,
        width,
        height,
        opacity: 1,
        scaleX: 1,
        scaleY: 1,
      }
    })
  }, [])

  const handleContainerMouseLeave = useCallback(() => {
    setIndicator((prev) => (prev.opacity === 0 ? prev : { ...prev, opacity: 0 }))
  }, [])

  const indicatorStyle: React.CSSProperties = useMemo(
    () => ({
      transform: `translate3d(${indicator.left}px, ${indicator.top}px, 0) scale(${indicator.scaleX}, ${indicator.scaleY})`,
      width: `${indicator.width}px`,
      height: `${indicator.height}px`,
      opacity: indicator.opacity,
    }),
    [indicator.left, indicator.top, indicator.width, indicator.height, indicator.scaleX, indicator.scaleY, indicator.opacity]
  )

  return {
    containerRef,
    indicator,
    indicatorStyle,
    handleItemMouseEnter,
    handleContainerMouseLeave,
  }
}

export interface GlideIndicator1DState {
  top: number
  height: number
  opacity: number
  scaleY: number
}

export function useListGlideIndicator(defaultHeight = 52) {
  const containerRef = useRef<HTMLDivElement>(null)
  const baseHeight = defaultHeight > 0 ? defaultHeight : 52
  const [indicator, setIndicator] = useState<GlideIndicator1DState>({
    top: 0,
    height: baseHeight,
    opacity: 0,
    scaleY: 1,
  })

  const handleItemMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      if (!isFinePointerHover()) return
      const el = e.currentTarget
      const newTop = el.offsetTop
      const height = el.offsetHeight || baseHeight

      setIndicator((prev) => {
        if (prev.top === newTop && prev.height === height && prev.opacity === 1) {
          return prev
        }
        return {
          top: newTop,
          height,
          opacity: 1,
          scaleY: 1,
        }
      })
    },
    [baseHeight]
  )

  const handleContainerMouseLeave = useCallback(() => {
    setIndicator((prev) => (prev.opacity === 0 ? prev : { ...prev, opacity: 0 }))
  }, [])

  const indicatorStyle: React.CSSProperties = useMemo(
    () => ({
      transform: `translate3d(0, ${indicator.top}px, 0) scaleY(${(indicator.height / baseHeight).toFixed(4)})`,
      height: `${baseHeight}px`,
      opacity: indicator.opacity,
    }),
    [indicator.top, indicator.height, indicator.opacity, baseHeight]
  )

  return {
    containerRef,
    indicator,
    indicatorStyle,
    handleItemMouseEnter,
    handleContainerMouseLeave,
  }
}

export { useGlideIndicator } from '@/hooks/useGlideIndicator'
export type { IndicatorState } from '@/hooks/useGlideIndicator'
