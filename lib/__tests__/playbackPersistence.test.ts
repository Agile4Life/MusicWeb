import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@/types'
import { loadPlaybackState, savePlaybackState, type PlaybackState } from '../playbackPersistence'

const KEY = 'musicweb_playback_v2'
const MAX_BYTES = 2 * 1024 * 1024
const track = (id: string, title = id) => ({ id, title, artist: 'Artist' } as Track)
const stateFor = (queue: Track[], currentIndex: number): PlaybackState => ({
  queue, currentIndex, currentTime: 82, currentTrack: queue[currentIndex] ?? null,
  streamUrls: {}, resolutions: {}, savedAt: 0,
})

describe('playback persistence size limits', () => {
  const values = new Map<string, string>()
  beforeEach(() => {
    values.clear()
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('writes a bounded new queue and preserves the selected track beyond index 50', () => {
    savePlaybackState(stateFor([track('previous')], 0))
    const queue = Array.from({ length: 130 }, (_, i) => track(`new-${i}`, 'x'.repeat(24_000)))
    const state = stateFor(queue, 100)
    savePlaybackState(state)
    expect(new TextEncoder().encode(values.get(KEY)!).length).toBeLessThanOrEqual(MAX_BYTES)
    const saved = loadPlaybackState()!
    expect(saved.currentTrack?.id).toBe('new-100')
    expect(saved.queue[saved.currentIndex]?.id).toBe('new-100')
    expect(saved.currentTime).toBe(82)
    expect(state.queue).toHaveLength(130)
  })

  it('counts UTF-8 bytes rather than string characters', () => {
    savePlaybackState(stateFor(Array.from({ length: 100 }, (_, i) => track(`${i}`, '音'.repeat(10_000))), 75))
    expect(new TextEncoder().encode(values.get(KEY)!).length).toBeLessThanOrEqual(MAX_BYTES)
    const saved = loadPlaybackState()!
    expect(saved.queue[saved.currentIndex]?.id).toBe('75')
  })

  it('evicts old cache entries from the incoming payload', () => {
    const incoming = stateFor([track('new')], 0)
    incoming.streamUrls = {
      old: { url: 'x'.repeat(MAX_BYTES), ts: 1, expiresAt: Date.now() + 60_000 },
      fresh: { url: 'https://new.example/audio.mp3', ts: 2, expiresAt: Date.now() + 60_000 },
    }
    savePlaybackState(incoming)
    expect(new TextEncoder().encode(values.get(KEY)!).length).toBeLessThanOrEqual(MAX_BYTES)
    expect(loadPlaybackState()?.streamUrls.fresh?.url).toBe('https://new.example/audio.mp3')
    expect(loadPlaybackState()?.streamUrls.old).toBeUndefined()
    expect(incoming.streamUrls.old).toBeDefined()
  })

  it('bounds resolution cache payloads as well as stream URLs', () => {
    const incoming = stateFor([track('new')], 0)
    incoming.resolutions = {
      old: { source: 'youtube', resolvedId: 'x'.repeat(MAX_BYTES), ts: 1, expiresAt: Date.now() + 60_000 },
      fresh: { source: 'nhaccuatui', resolvedId: 'new', ts: 2, expiresAt: Date.now() + 60_000 },
    }
    savePlaybackState(incoming)
    expect(new TextEncoder().encode(values.get(KEY)!).length).toBeLessThanOrEqual(MAX_BYTES)
    expect(loadPlaybackState()?.resolutions.fresh?.resolvedId).toBe('new')
    expect(loadPlaybackState()?.resolutions.old).toBeUndefined()
  })

  it.each([0, 99])('preserves selected tracks at queue boundary %s', (index) => {
    savePlaybackState(stateFor(Array.from({ length: 100 }, (_, i) => track(`${i}`, 'x'.repeat(25_000))), index))
    const saved = loadPlaybackState()!
    expect(saved.queue[saved.currentIndex]?.id).toBe(`${index}`)
    expect(saved.currentTrack?.id).toBe(`${index}`)
  })

  it('preserves previous valid storage when the selected track alone cannot fit', () => {
    savePlaybackState(stateFor([track('previous')], 0))
    const previous = values.get(KEY)
    savePlaybackState(stateFor([track('too-big', 'x'.repeat(MAX_BYTES))], 0))
    expect(values.get(KEY) === previous).toBe(true)
  })

  it('retries quota failures with the new queue rather than restoring stale playback', () => {
    savePlaybackState(stateFor([track('previous')], 0))
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (new TextEncoder().encode(value).length > 40_000) throw new Error('QuotaExceededError')
        values.set(key, value)
      },
      removeItem: (key: string) => values.delete(key),
    })
    savePlaybackState(stateFor(Array.from({ length: 20 }, (_, i) => track(`new-${i}`, 'x'.repeat(4_000))), 15))
    const saved = loadPlaybackState()!
    expect(saved.currentTrack?.id).toBe('new-15')
    expect(saved.queue[saved.currentIndex]?.id).toBe('new-15')
  })
})
