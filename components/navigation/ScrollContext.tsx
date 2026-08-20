'use client'

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

interface ScrollState {
  scrollY: number
  direction: 'up' | 'down' | 'none'
  velocity: number
  isAtTop: boolean
  isScrolled: boolean
}

type ScrollListener = (scrollY: number) => void

interface ScrollContextValue {
  scrollState: ScrollState
  setScrollContainer: (container: HTMLElement | null) => void
  /** Subscribe to raw scrollY changes — called every rAF, no React state lag */
  addScrollListener: (fn: ScrollListener) => () => void
  /** Get the current scrollY value synchronously (no stale state) */
  getScrollY: () => number
}

const defaultScrollState: ScrollState = {
  scrollY: 0,
  direction: 'none',
  velocity: 0,
  isAtTop: true,
  isScrolled: false,
}

const ScrollContext = createContext<ScrollContextValue>({
  scrollState: defaultScrollState,
  setScrollContainer: () => {},
  addScrollListener: () => () => {},
  getScrollY: () => 0,
})

export function useScrollContext() {
  return useContext(ScrollContext)
}

export function ScrollProvider({ children }: { children: React.ReactNode }) {
  const [scrollState, setScrollState] = useState<ScrollState>(defaultScrollState)
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const lastScrollY = useRef(0)
  const lastScrollTime = useRef(Date.now())
  const animationFrameRef = useRef<number | null>(null)
  const scrollYRef = useRef(0)
  const listenersRef = useRef<Set<ScrollListener>>(new Set())

  const setScrollContainer = useCallback((container: HTMLElement | null) => {
    scrollContainerRef.current = container
  }, [])

  const addScrollListener = useCallback((fn: ScrollListener) => {
    listenersRef.current.add(fn)
    return () => { listenersRef.current.delete(fn) }
  }, [])

  const getScrollY = useCallback(() => scrollYRef.current, [])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        const currentY = container.scrollTop
        const currentTime = Date.now()
        const timeDelta = currentTime - lastScrollTime.current
        const scrollDelta = currentY - lastScrollY.current

        // Update the ref synchronously for listeners (Zero React re-render)
        scrollYRef.current = currentY

        // Notify all raw scroll listeners directly on the animation frame
        listenersRef.current.forEach(fn => fn(currentY))

        // Calculate discrete threshold states
        const isAtTop = currentY <= 10
        const isScrolled = currentY > 20
        let direction: 'up' | 'down' | 'none' = 'none'
        if (scrollDelta > 3) direction = 'down'
        else if (scrollDelta < -3) direction = 'up'

        // Only trigger React state updates when discrete thresholds or direction change
        setScrollState(prev => {
          if (
            prev.isAtTop === isAtTop &&
            prev.isScrolled === isScrolled &&
            prev.direction === direction &&
            Math.abs(prev.scrollY - currentY) < 60
          ) {
            return prev
          }
          const velocity = timeDelta > 0 ? (scrollDelta / timeDelta) * 1000 : 0
          return {
            scrollY: currentY,
            direction,
            velocity,
            isAtTop,
            isScrolled,
          }
        })

        lastScrollY.current = currentY
        lastScrollTime.current = currentTime
      })
    }

    // Listen to scroll on the container with passive flag for smooth scrolling
    container.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  const contextValue = React.useMemo(() => ({
    scrollState,
    setScrollContainer,
    addScrollListener,
    getScrollY,
  }), [scrollState, setScrollContainer, addScrollListener, getScrollY])

  return (
    <ScrollContext.Provider value={contextValue}>
      {children}
    </ScrollContext.Provider>
  )
}
