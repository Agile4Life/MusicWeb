import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { PlaybackProgressStore } from '../PlaybackProgressStore'

describe('MediaSession Interval Lifecycle & Position Sync (Task 6)', () => {
  let mockSetPositionState: any
  let store: PlaybackProgressStore

  beforeEach(() => {
    vi.useFakeTimers()
    store = new PlaybackProgressStore()
    mockSetPositionState = vi.fn()

    vi.stubGlobal('navigator', {
      mediaSession: {
        setPositionState: mockSetPositionState,
        playbackState: 'none',
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('polls every 1s and syncs accurate position from store/ref without state lag', () => {
    let isPlaying = true
    const currentTrack = { id: 'track-1', title: 'Song 1', duration: 240 }

    // Start interval
    const interval = setInterval(() => {
      try {
        const d = store.getDuration() || currentTrack.duration || 0
        const t = store.getCurrentTime()
        if (d > 0 && t >= 0) {
          navigator.mediaSession.setPositionState({
            duration: Math.max(d, 0),
            playbackRate: 1,
            position: Math.min(Math.max(t, 0), d),
          })
        }
      } catch {}
    }, 1000)

    // Initially at 0s
    vi.advanceTimersByTime(1000)
    expect(mockSetPositionState).toHaveBeenCalledWith({
      duration: 240,
      playbackRate: 1,
      position: 0,
    })

    // Advance audio time in store to 15.3s
    store.setProgress(15.3, 240)
    vi.advanceTimersByTime(1000)
    expect(mockSetPositionState).toHaveBeenLastCalledWith({
      duration: 240,
      playbackRate: 1,
      position: 15.3,
    })

    // Clean up interval on pause
    clearInterval(interval)
    vi.advanceTimersByTime(3000)
    // Should not have been called after clearInterval
    expect(mockSetPositionState).toHaveBeenCalledTimes(2)
  })

  it('safely clamps position to duration if audio time exceeds duration', () => {
    const currentTrack = { id: 'track-1', title: 'Song 1', duration: 100 }
    store.setProgress(105, 100) // Exceeds duration due to buffering or math variance

    const interval = setInterval(() => {
      const d = store.getDuration() || currentTrack.duration || 0
      const t = store.getCurrentTime()
      if (d > 0 && t >= 0) {
        navigator.mediaSession.setPositionState({
          duration: Math.max(d, 0),
          playbackRate: 1,
          position: Math.min(Math.max(t, 0), d),
        })
      }
    }, 1000)

    vi.advanceTimersByTime(1000)
    expect(mockSetPositionState).toHaveBeenCalledWith({
      duration: 100,
      playbackRate: 1,
      position: 100, // Clamped to 100
    })

    clearInterval(interval)
  })
})
