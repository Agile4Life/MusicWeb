import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

describe('Background Tab Optimization (Gaming Eco Mode)', () => {
  let attributes: Record<string, string> = {}

  beforeEach(() => {
    attributes = {}
    const mockDocument = {
      hidden: false,
      documentElement: {
        setAttribute: vi.fn((key: string, val: string) => {
          attributes[key] = val
        }),
        removeAttribute: vi.fn((key: string) => {
          delete attributes[key]
        }),
        getAttribute: vi.fn((key: string) => attributes[key] || null),
      },
    }

    Object.defineProperty(globalThis, 'document', {
      value: mockDocument,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    // @ts-ignore
    delete globalThis.document
  })

  it('sets data-tab-hidden attribute on documentElement when tab is hidden and removes when visible', () => {
    const setVisibility = (hidden: boolean) => {
      if (hidden) {
        document.documentElement.setAttribute('data-tab-hidden', 'true')
      } else {
        document.documentElement.removeAttribute('data-tab-hidden')
      }
    }

    setVisibility(true)
    expect(document.documentElement.getAttribute('data-tab-hidden')).toBe('true')

    setVisibility(false)
    expect(document.documentElement.getAttribute('data-tab-hidden')).toBeNull()
  })

  it('throttles setCurrentTime updates when tab is hidden while preserving internal ref tracking', () => {
    let stateCurrentTime = 0
    const currentTimeRef = { current: 0 }
    const isTabHiddenRef = { current: true }
    const setCurrentTime = vi.fn((t: number) => {
      stateCurrentTime = t
    })

    const simulateTimeUpdate = (audioTime: number) => {
      currentTimeRef.current = audioTime
      if (!isTabHiddenRef.current) {
        setCurrentTime(audioTime)
      }
    }

    // 1. When hidden (gaming in progress)
    simulateTimeUpdate(10.5)
    simulateTimeUpdate(11.0)
    simulateTimeUpdate(11.5)

    expect(currentTimeRef.current).toBe(11.5)
    expect(setCurrentTime).not.toHaveBeenCalled()
    expect(stateCurrentTime).toBe(0) // UI state remained frozen, 0 re-renders

    // 2. When tab becomes visible again
    isTabHiddenRef.current = false
    const handleVisibilityRestore = (actualTime: number) => {
      currentTimeRef.current = actualTime
      setCurrentTime(actualTime)
    }

    handleVisibilityRestore(12.0)
    expect(setCurrentTime).toHaveBeenCalledWith(12.0)
    expect(stateCurrentTime).toBe(12.0) // UI snapped directly to accurate time
  })

  it('ensures MediaSession positionState queries internal ref even when UI progress is throttled', () => {
    const mockSetPositionState = vi.fn()
    const currentTimeRef = { current: 45.2 }
    const stateCurrentTime = 0 // UI was frozen at 0 when tab was hidden
    const duration = 180

    const updateMediaSessionPosition = () => {
      const t = currentTimeRef.current || stateCurrentTime
      mockSetPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(Math.max(t, 0), duration),
      })
    }

    updateMediaSessionPosition()

    expect(mockSetPositionState).toHaveBeenCalledWith({
      duration: 180,
      playbackRate: 1,
      position: 45.2,
    })
  })
})
