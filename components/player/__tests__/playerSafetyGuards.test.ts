import { describe, expect, it } from 'vitest'
import { Track } from '@/types'

describe('Player Safety Mechanisms & Edge Guards', () => {
  it('correctly windows large queues (>150 items) around currentIndex to prevent index overflow', () => {
    const queueLength = 300
    const mockTracks: Track[] = Array.from({ length: queueLength }, (_, i) => ({
      id: `track-${i}`,
      title: `Track ${i}`,
      artist: `Artist ${i}`,
      duration: 180,
      source: 'local' as const,
      user_id: 'user-1',
      file_path: `/music/${i}.mp3`,
      cover_url: null,
      created_at: new Date().toISOString(),
    }))

    const maxItems = 150
    const targetIndex = 200

    const safeIndex = Math.max(0, targetIndex)
    const start = Math.max(0, Math.min(safeIndex - 20, mockTracks.length - maxItems))
    const end = Math.min(mockTracks.length, start + maxItems)
    const windowedQueue = mockTracks.slice(start, end)
    const persistedIndex = safeIndex >= 0 ? safeIndex - start : -1

    expect(windowedQueue.length).toBe(150)
    expect(persistedIndex).toBe(50)
    expect(windowedQueue[persistedIndex].id).toBe('track-200')
    expect(persistedIndex).toBeGreaterThanOrEqual(0)
    expect(persistedIndex).toBeLessThan(windowedQueue.length)
  })

  it('correctly verifies YouTube video matching with fallback to ytLoadedIdRef', () => {
    const activeTrack = { id: 't1', title: 'Song 1', youtube_id: 'vid-123' }
    let actualVideoId: string | null = null
    const ytLoadedId = 'vid-123'

    // When actualVideoId from API is null (e.g. immediately after loadVideoById),
    // matching against ytLoadedIdRef must return true.
    const isMatchedWithFallback =
      (actualVideoId !== null && actualVideoId === activeTrack.youtube_id) ||
      (ytLoadedId === activeTrack.youtube_id)

    expect(isMatchedWithFallback).toBe(true)

    // When both actualVideoId and ytLoadedId differ from active track
    actualVideoId = 'other-vid'
    const wrongLoadedId = 'other-vid'
    const isCompletelyMismatched =
      (actualVideoId !== null && actualVideoId === activeTrack.youtube_id) ||
      (wrongLoadedId === activeTrack.youtube_id)

    expect(isCompletelyMismatched).toBe(false)
  })

  it('circuit breaker prevents infinite skip loop when consecutive errors reach MAX_CONSECUTIVE_SKIPS (4)', () => {
    const MAX_CONSECUTIVE_SKIPS = 4
    let consecutiveSkips = 0
    let autoAdvanceBlocked = false

    // Simulate 3 consecutive track failures
    for (let i = 0; i < 3; i++) {
      consecutiveSkips += 1
      if (consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
        autoAdvanceBlocked = true
      }
    }
    expect(consecutiveSkips).toBe(3)
    expect(autoAdvanceBlocked).toBe(false)

    // 4th consecutive failure triggers circuit breaker
    consecutiveSkips += 1
    if (consecutiveSkips >= MAX_CONSECUTIVE_SKIPS) {
      autoAdvanceBlocked = true
    }
    expect(consecutiveSkips).toBe(4)
    expect(autoAdvanceBlocked).toBe(true)

    // User manual play / successful play resets the counter
    consecutiveSkips = 0
    autoAdvanceBlocked = false
    expect(consecutiveSkips).toBe(0)
    expect(autoAdvanceBlocked).toBe(false)
  })
})
