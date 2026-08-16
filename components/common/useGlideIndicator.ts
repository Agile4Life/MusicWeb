'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'

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
    const el = e.currentTarget
    const newLeft = el.offsetLeft
    const newTop = el.offsetTop
    const width = el.offsetWidth
    const height = el.offsetHeight

    setIndicator({
      left: newLeft,
      top: newTop,
      width,
      height,
      opacity: 1,
      scaleX: 1,
      scaleY: 1,
    })
  }, [])

  const handleContainerMouseLeave = useCallback(() => {
    setIndicator((prev) => ({ ...prev, opacity: 0 }))
  }, [])

  return {
    containerRef,
    indicator,
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
  const [indicator, setIndicator] = useState<GlideIndicator1DState>({
    top: 0,
    height: defaultHeight,
    opacity: 0,
    scaleY: 1,
  })

  const handleItemMouseEnter = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const el = e.currentTarget
    const newTop = el.offsetTop
    const height = el.offsetHeight || defaultHeight

    setIndicator({
      top: newTop,
      height,
      opacity: 1,
      scaleY: 1,
    })
  }, [defaultHeight])

  const handleContainerMouseLeave = useCallback(() => {
    setIndicator((prev) => ({ ...prev, opacity: 0 }))
  }, [])

  return {
    containerRef,
    indicator,
    handleItemMouseEnter,
    handleContainerMouseLeave,
  }
}

export { useGlideIndicator } from '@/hooks/useGlideIndicator'
export type { IndicatorState } from '@/hooks/useGlideIndicator'
