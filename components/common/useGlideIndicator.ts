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

    setIndicator((prev) => {
      const isFirstEnter = prev.opacity === 0
      const distX = Math.abs(newLeft - prev.left)
      const distY = Math.abs(newTop - prev.top)
      const stretchX = isFirstEnter ? 1 : Math.min(1 + (distX / (width || 1)) * 0.09, 1.2)
      const stretchY = isFirstEnter ? 1 : Math.min(1 + (distY / (height || 1)) * 0.09, 1.2)

      return {
        left: newLeft,
        top: newTop,
        width,
        height,
        opacity: 1,
        scaleX: stretchX,
        scaleY: stretchY,
      }
    })
  }, [])

  const handleContainerMouseLeave = useCallback(() => {
    setIndicator((prev) => ({ ...prev, opacity: 0, scaleX: 1, scaleY: 1 }))
  }, [])

  useEffect(() => {
    if (indicator.scaleX !== 1 || indicator.scaleY !== 1) {
      const t = setTimeout(() => {
        setIndicator((prev) => ({ ...prev, scaleX: 1, scaleY: 1 }))
      }, 40)
      return () => clearTimeout(t)
    }
  }, [indicator.left, indicator.top, indicator.scaleX, indicator.scaleY])

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

    setIndicator((prev) => {
      const isFirstEnter = prev.opacity === 0
      const distance = Math.abs(newTop - prev.top)
      const stretchFactor = isFirstEnter ? 1 : Math.min(1 + (distance / height) * 0.14, 1.38)

      return {
        top: newTop,
        height,
        opacity: 1,
        scaleY: stretchFactor,
      }
    })
  }, [defaultHeight])

  const handleContainerMouseLeave = useCallback(() => {
    setIndicator((prev) => ({ ...prev, opacity: 0, scaleY: 1 }))
  }, [])

  useEffect(() => {
    if (indicator.scaleY !== 1) {
      const t = setTimeout(() => {
        setIndicator((prev) => ({ ...prev, scaleY: 1 }))
      }, 40)
      return () => clearTimeout(t)
    }
  }, [indicator.top, indicator.scaleY])

  return {
    containerRef,
    indicator,
    handleItemMouseEnter,
    handleContainerMouseLeave,
  }
}
