'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface IndicatorState {
  top: number
  height: number
  opacity: number
  scaleY: number
}

export function useGlideIndicator(defaultHeight = 44) {
  const [state, setState] = useState<IndicatorState>({
    top: 0,
    height: defaultHeight,
    opacity: 0,
    scaleY: 1,
  })
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const moveTo = useCallback(
    (el: HTMLElement) => {
      const newTop = el.offsetTop
      const newHeight = el.offsetHeight || defaultHeight
      const distance = Math.abs(newTop - state.top)

      // Độ giãn tỉ lệ theo khoảng cách di chuyển, giới hạn tối đa 1.4x
      const stretch = Math.min(1 + (distance / newHeight) * 0.12, 1.4)

      if (timeoutRef.current) clearTimeout(timeoutRef.current)

      setState({
        top: newTop,
        height: newHeight,
        opacity: 1,
        scaleY: stretch,
      })

      // Co lại về scaleY = 1 sau khi bắt đầu di chuyển
      timeoutRef.current = setTimeout(() => {
        setState((prev) => ({ ...prev, scaleY: 1 }))
      }, 60)
    },
    [state.top, defaultHeight]
  )

  const hide = useCallback(() => {
    setState((prev) => ({ ...prev, opacity: 0, scaleY: 1 }))
  }, [])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  return { state, moveTo, hide }
}
