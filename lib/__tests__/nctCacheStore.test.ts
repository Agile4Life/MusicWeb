import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAllNctAudioCache,
  deleteNctAudioCache,
  getNctAudioCache,
  setNctAudioCache,
  NCT_CACHE_MAX_ENTRIES,
} from '../nctCacheStore'

describe('Shared NCT Audio Cache Store', () => {
  beforeEach(() => {
    clearAllNctAudioCache()
  })

  it('stores and retrieves cached song entries', () => {
    setNctAudioCache('song-1', {
      audioUrl: 'https://stream.nct.vn/1.mp3',
      title: 'Song 1',
      artist: 'Artist 1',
      duration: 180,
    })

    const cached = getNctAudioCache('song-1')
    expect(cached).toBeDefined()
    expect(cached?.audioUrl).toBe('https://stream.nct.vn/1.mp3')
    expect(cached?.title).toBe('Song 1')
  })

  it('evicts expired entries', () => {
    setNctAudioCache('song-expired', {
      audioUrl: 'https://stream.nct.vn/expired.mp3',
      expiresAt: Date.now() - 1000, // already expired
    })

    expect(getNctAudioCache('song-expired')).toBeNull()
  })

  it('deletes specific cache entries', () => {
    setNctAudioCache('song-2', { audioUrl: 'https://stream.nct.vn/2.mp3' })
    expect(getNctAudioCache('song-2')).not.toBeNull()

    deleteNctAudioCache('song-2')
    expect(getNctAudioCache('song-2')).toBeNull()
  })

  it('evicts oldest entry when max size is reached', () => {
    // Fill up to max entries
    for (let i = 0; i < NCT_CACHE_MAX_ENTRIES; i++) {
      setNctAudioCache(`song-${i}`, { audioUrl: `https://stream.nct.vn/${i}.mp3` })
    }
    expect(getNctAudioCache('song-0')).not.toBeNull()

    // Add one more
    setNctAudioCache('song-new', { audioUrl: 'https://stream.nct.vn/new.mp3' })
    // Oldest song-0 should be evicted
    expect(getNctAudioCache('song-0')).toBeNull()
    expect(getNctAudioCache('song-new')).not.toBeNull()
  })

  it('shares cache between resolve-stream route and stream route', async () => {
    const { GET: resolveGet } = await import('@/app/api/nhaccuatui/resolve-stream/route')
    const { GET: streamGet } = await import('@/app/api/nhaccuatui/stream/route')

    process.env.NCT_API_BASE_URL = 'https://nct-api.test'

    // Mock upstream API fetch for resolve-stream
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'cross-sync-1',
        title: 'Song Synchronized',
        artist: 'Artist',
        audioUrl: 'https://stream.nct.vn/sync.mp3',
      }), { status: 200 }))
      // Upstream audio fetch for stream route
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }))

    // 1. Prewarm / resolve route is called
    const resolveRes = await resolveGet(new Request('https://music.test/api/nhaccuatui/resolve-stream?id=cross-sync-1'))
    expect(resolveRes.status).toBe(200)
    const resolveData = await resolveRes.json()
    expect(resolveData.url).toBe('https://stream.nct.vn/sync.mp3')

    // 2. Now stream route is called by audio element
    const streamRes = await streamGet(new Request('https://music.test/api/nhaccuatui/stream?id=cross-sync-1'))
    expect(streamRes.status).toBe(200)

    // Verify that stream route did NOT call external NCT song metadata API again!
    // Total fetch calls = 2: (1 for resolve-stream metadata API, 1 for actual audio CDN file stream)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(fetchSpy.mock.calls[0][0].toString()).toContain('/api/song/cross-sync-1')
    expect(fetchSpy.mock.calls[1][0].toString()).toBe('https://stream.nct.vn/sync.mp3')
  })
})
