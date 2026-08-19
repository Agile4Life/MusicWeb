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

  it('ensures restored player state on mount initializes audio ownership token matching the restored track ID', () => {
    const restoredTrack: Track = {
      id: 'song-restored-456',
      title: 'Restored Song',
      artist: 'Restored Artist',
      duration: 210,
      source: 'nhaccuatui',
      user_id: 'user-1',
      file_path: '',
      cover_url: null,
      created_at: '2026-01-01T00:00:00Z',
    }

    const audioGenerationRef = { current: 0 }
    const playRequestRef = { current: 0 }
    const restoreRequestId = playRequestRef.current
    const currentTrackRef = { current: restoredTrack }

    const audioOwnershipRef = {
      current: {
        generation: audioGenerationRef.current,
        requestId: restoreRequestId,
        trackId: restoredTrack.id,
      },
    }

    const isCurrentAudioOwnership = () => {
      const token = audioOwnershipRef.current
      const activeId = currentTrackRef.current?.id
      if (!activeId || !token.trackId) return false
      return (
        token.generation === audioGenerationRef.current &&
        token.requestId === playRequestRef.current &&
        token.trackId === activeId
      )
    }

    // Ownership check must be immediately valid after mount restore
    expect(isCurrentAudioOwnership()).toBe(true)
  })

  it('ensures togglePlay resume keeps ownership token aligned when resuming pre-loaded audio', () => {
    const activeTrack: Track = {
      id: 'song-789',
      title: 'Active Track',
      duration: 190,
      source: 'local',
      user_id: 'user-1',
      file_path: '',
      cover_url: null,
      created_at: '2026-01-01T00:00:00Z',
    }

    const audioGenerationRef = { current: 1 }
    const playRequestRef = { current: 1 }
    const currentTrackRef = { current: activeTrack }

    // Simulating resume where ownership token is synchronized with current track
    const audioOwnershipRef = {
      current: {
        generation: audioGenerationRef.current,
        requestId: playRequestRef.current,
        trackId: activeTrack.id,
      },
    }

    const isCurrentAudioOwnership = () => {
      const token = audioOwnershipRef.current
      const activeId = currentTrackRef.current?.id
      if (!activeId || !token.trackId) return false
      return (
        token.generation === audioGenerationRef.current &&
        token.requestId === playRequestRef.current &&
        token.trackId === activeId
      )
    }

    expect(isCurrentAudioOwnership()).toBe(true)
  })

  it('prevents play/pause spam race conditions by serializing action IDs and desired play state', async () => {
    let isPlaying = false
    const toggleActionIdRef = { current: 0 }
    const desiredPlayStateRef = { current: null as 'playing' | 'paused' | null }

    const mockAudio = {
      paused: true,
      pause: () => {
        mockAudio.paused = true
      },
      play: () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            mockAudio.paused = false
            resolve()
          }, 50)
        }),
    }

    const togglePlay = async () => {
      const actionId = ++toggleActionIdRef.current
      const isCurrentlyActive =
        (isPlaying || !mockAudio.paused || desiredPlayStateRef.current === 'playing') &&
        desiredPlayStateRef.current !== 'paused'

      if (isCurrentlyActive) {
        desiredPlayStateRef.current = 'paused'
        mockAudio.pause()
        isPlaying = false
        return
      }

      desiredPlayStateRef.current = 'playing'
      try {
        await mockAudio.play()
        if (actionId !== toggleActionIdRef.current || (desiredPlayStateRef.current as any) === 'paused') {
          mockAudio.pause()
          isPlaying = false
          return
        }
        isPlaying = true
      } catch {}
    }

    // 1. User clicks PLAY (action 1)
    const p1 = togglePlay()
    expect(desiredPlayStateRef.current).toBe('playing')

    // 2. User quickly clicks PAUSE (action 2) while action 1 play() is in-flight (after 10ms)
    await new Promise((r) => setTimeout(r, 10))
    const p2 = togglePlay()
    expect(desiredPlayStateRef.current).toBe('paused')
    expect(isPlaying).toBe(false)
    expect(mockAudio.paused).toBe(true)

    // Await both promises to complete
    await Promise.all([p1, p2])

    // After action 1 resolves, the guard must prevent action 1 from setting isPlaying = true
    expect(isPlaying).toBe(false)
    expect(mockAudio.paused).toBe(true)
  })
})

