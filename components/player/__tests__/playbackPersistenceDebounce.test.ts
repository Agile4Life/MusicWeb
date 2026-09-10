import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import type { Track } from '@/types'
import {
  toMinimalPersistedTrack,
  PlaybackPersistenceScheduler,
  STORAGE_KEY_PLAYER_STATE,
} from '../playbackPersistenceScheduler'

describe('Playback Persistence Optimization (Task 4)', () => {
  let mockStorage: Record<string, string> = {}

  beforeEach(() => {
    mockStorage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = val
      },
      removeItem: (key: string) => {
        delete mockStorage[key]
      },
      clear: () => {
        mockStorage = {}
      },
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('Case 1: Retains up to 150 items with minimal track structure', () => {
    const queue: Track[] = Array.from({ length: 180 }, (_, i) => ({
      id: `track-${i}`,
      title: `Song ${i}`,
      artist: `Artist ${i}`,
      extraFieldThatShouldBeStripped: 'waste_of_bytes',
      source: 'local',
      file_path: `/music/${i}.mp3`,
    } as any))

    const activeTrack = queue[50]
    const scheduler = new PlaybackPersistenceScheduler()

    scheduler.saveImmediate({
      track: activeTrack,
      currentTime: 42,
      queue,
      currentIndex: 50,
      volume: 0.8,
    })

    const raw = mockStorage[STORAGE_KEY_PLAYER_STATE]
    expect(raw).toBeDefined()
    const parsed = JSON.parse(raw)

    expect(parsed.queue).toHaveLength(150)
    expect(parsed.track.id).toBe('track-50')
    expect(parsed.track.extraFieldThatShouldBeStripped).toBeUndefined()
    expect(parsed.currentTime).toBe(42)
  })

  it('Case 2: Debounces continuous playback writes (15s cadence / idle callback)', () => {
    const scheduler = new PlaybackPersistenceScheduler()
    const setItemSpy = vi.spyOn(localStorage, 'setItem')

    const track: Track = { id: 't1', title: 'Song 1', artist: 'Artist 1' }
    const queue = [track]

    // Simulate timeupdates every 5s during playback
    scheduler.scheduleDebounced({ track, currentTime: 5, queue, currentIndex: 0, volume: 0.8 })
    scheduler.scheduleDebounced({ track, currentTime: 10, queue, currentIndex: 0, volume: 0.8 })
    scheduler.scheduleDebounced({ track, currentTime: 14, queue, currentIndex: 0, volume: 0.8 })

    // Before timer fires, localStorage.setItem should NOT have been called for all 3 updates
    expect(setItemSpy).not.toHaveBeenCalled()

    // Fast-forward 15s debounce window
    vi.advanceTimersByTime(15000)

    // Should have flushed exactly once with the latest time (14s)
    expect(setItemSpy).toHaveBeenCalledTimes(1)
    const saved = JSON.parse(mockStorage[STORAGE_KEY_PLAYER_STATE])
    expect(saved.currentTime).toBe(14)
  })

  it('Case 3: Immediate flush on iOS pagehide & visibilitychange (hidden) without losing progress', () => {
    const scheduler = new PlaybackPersistenceScheduler()
    const setItemSpy = vi.spyOn(localStorage, 'setItem')

    const track: Track = { id: 't1', title: 'Song 1', artist: 'Artist 1' }
    const queue = [track]

    // Audio is playing, user listens up to 73s, schedule debounced save
    scheduler.scheduleDebounced({ track, currentTime: 73, queue, currentIndex: 0, volume: 0.8 })
    expect(setItemSpy).not.toHaveBeenCalled()

    // User switches app or locks screen on iOS Safari -> pagehide / visibilitychange hidden fires
    scheduler.flushPending()

    // Must be saved immediately to localStorage with latest position (73s)
    expect(setItemSpy).toHaveBeenCalledTimes(1)
    const saved = JSON.parse(mockStorage[STORAGE_KEY_PLAYER_STATE])
    expect(saved.currentTime).toBe(73)
  })

  it('Case 4: Reads position directly from currentTime ref/getter, decoupled from React state', () => {
    let internalRefTime = 120
    const getTimeRef = () => internalRefTime

    const scheduler = new PlaybackPersistenceScheduler()
    const track: Track = { id: 't1', title: 'Song 1', artist: 'Artist 1' }
    const queue = [track]

    scheduler.scheduleDebounced({
      track,
      currentTime: getTimeRef(),
      queue,
      currentIndex: 0,
      volume: 0.8,
    })

    // Advance time ref before flush
    internalRefTime = 125
    scheduler.updatePendingTime(internalRefTime)

    scheduler.flushPending()

    const saved = JSON.parse(mockStorage[STORAGE_KEY_PLAYER_STATE])
    expect(saved.currentTime).toBe(125)
  })
})
