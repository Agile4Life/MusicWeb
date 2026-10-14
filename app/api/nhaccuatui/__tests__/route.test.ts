import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET as searchGET } from '../search/route'
import { GET as songGET } from '../song/[id]/route'
import { clearAllNctAudioCache, resolveNctSongDetailCached } from '@/lib/nctCacheStore'

describe('NhacCuaTui proxy routes', () => {
  beforeEach(() => {
    clearAllNctAudioCache()
  })

  afterEach(() => {
    clearAllNctAudioCache()
    vi.restoreAllMocks()
    delete process.env.NCT_API_BASE_URL
  })

  it('normalizes search metadata and caches repeated search queries', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([
        { id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto' },
      ]), { status: 200 }),
    )

    const response = await searchGET(new Request('https://music.test/api/nhaccuatui/search?q=x%C6%B0%C6%A1ng%20r%E1%BB%93ng'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [{ id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto' }],
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://nct-api.test/api/search?q=x%C6%B0%C6%A1ng+r%E1%BB%93ng')

    // Second search for the same query hits server search cache
    const secondResponse = await searchGET(new Request('https://music.test/api/nhaccuatui/search?q=x%C6%B0%C6%A1ng%20r%E1%BB%93ng'))
    expect(secondResponse.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns a same-origin stream URL without exposing the signed NCT URL', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id: 'nct-1',
        title: 'Xương Rồng',
        artist: 'Dangrangto',
        audioUrl: 'https://stream.nct.vn/song.mp3?expires=secret',
      }), { status: 200 }),
    )

    const response = await songGET(
      new Request('https://music.test/api/nhaccuatui/song/nct-1'),
      { params: Promise.resolve({ id: 'nct-1' }) },
    )
    const body = await response.json()

    expect(body.song.audioUrl).toBeUndefined()
    expect(body.song.streamUrl).toBe('/api/nhaccuatui/stream?id=nct-1')
    expect(JSON.stringify(body)).not.toContain('expires=secret')
  })

  it('reuses nctCacheStore populated by resolveNctSongDetailCached without a second upstream fetch', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        song: {
          id: 'xxkiVtQf4MX9',
          title: 'Timeless',
          artist: 'The Weeknd',
          audioUrl: 'https://stream.nct.vn/timeless.mp3?expires=secret',
          timedLyric: [{ time: 5000, text: 'Ever since I was a jit' }],
        },
      }), { status: 200 }),
    )

    // 1. Server resolver validates NCT song detail and warms shared cache
    const resolved = await resolveNctSongDetailCached('xxkiVtQf4MX9')
    expect(resolved?.audioUrl).toContain('timeless.mp3')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 2. Client requests /api/nhaccuatui/song/xxkiVtQf4MX9 -> hits shared cache in 0ms
    const response = await songGET(
      new Request('https://music.test/api/nhaccuatui/song/xxkiVtQf4MX9'),
      { params: Promise.resolve({ id: 'xxkiVtQf4MX9' }) },
    )
    const body = await response.json()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(body.song.id).toBe('xxkiVtQf4MX9')
    expect(body.song.lyric).toContain('[00:05.00] Ever since I was a jit')
  })
})


