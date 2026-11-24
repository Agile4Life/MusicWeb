'use client'

import { useCallback, useState } from 'react'

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

  const moveTo = useCallback(
    (el: HTMLElement) => {
      const newTop = el.offsetTop
      const newHeight = el.offsetHeight || defaultHeight

      setState({
        top: newTop,
        height: newHeight,
        opacity: 1,
        scaleY: 1,
      })
    },
    [defaultHeight]
  )

  const hide = useCallback(() => {
    setState((prev) => ({ ...prev, opacity: 0, scaleY: 1 }))
  }, [])

  return { state, moveTo, hide }
}
