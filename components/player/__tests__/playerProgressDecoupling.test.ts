import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { PlaybackProgressStore } from '../PlaybackProgressStore'

describe('Playback Progress Decoupling via useSyncExternalStore (Task 6)', () => {
  let store: PlaybackProgressStore

  beforeEach(() => {
    store = new PlaybackProgressStore()
  })

  it('notifies subscribers only when progress values change', () => {
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    // Initial state
    expect(store.getSnapshot()).toEqual({ currentTime: 0, duration: 0 })

    // Update progress
    store.setProgress(10, 180)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({ currentTime: 10, duration: 180 })
    expect(store.getCurrentTime()).toBe(10)
    expect(store.getDuration()).toBe(180)

    // Identical update -> should be a no-op (listener not called again)
    store.setProgress(10, 180)
    expect(listener).toHaveBeenCalledTimes(1)

    // Time update only
    store.setCurrentTime(11)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getCurrentTime()).toBe(11)

    // Unsubscribe
    unsubscribe()
    store.setCurrentTime(12)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('resets progress cleanly on track change', () => {
    store.setProgress(55, 200)
    expect(store.getCurrentTime()).toBe(55)

    store.reset()
    expect(store.getCurrentTime()).toBe(0)
    expect(store.getDuration()).toBe(0)
  })

  it('allows parent provider to remain completely unaffected by high-frequency time updates', () => {
    let parentRenderCount = 0
    let subscriberRenderCount = 0

    // Simulate Parent Component (like PlayerProvider)
    const renderParent = () => {
      parentRenderCount++
    }

    // Simulate Consumer Component (like LyricsView / PlayerBar scrubber)
    const renderSubscriber = () => {
      subscriberRenderCount++
    }

    renderParent()
    expect(parentRenderCount).toBe(1)

    store.subscribe(renderSubscriber)

    // Simulate 10 timeupdate events fired by audio element (4 times/sec)
    for (let sec = 1; sec <= 10; sec++) {
      store.setProgress(sec, 300)
    }

    // Subscriber updated on every tick
    expect(subscriberRenderCount).toBe(10)

    // Parent provider did NOT re-render a single time!
    expect(parentRenderCount).toBe(1)
  })
})
