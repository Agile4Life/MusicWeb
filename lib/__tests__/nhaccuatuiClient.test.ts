import { afterEach, describe, expect, it, vi } from 'vitest'
import { getNhacCuaTuiStreamUrl, resolveNhacCuaTuiAudio, resolveNhacCuaTuiSong, resolveNhacCuaTuiTrack, searchNhacCuaTui } from '../nhaccuatuiClient'

describe('NhacCuaTui browser client', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.NEXT_PUBLIC_NCT_STREAM_CACHE_URL
  })

  it('builds an encoded same-origin stream URL for an NCT track', () => {
    expect(getNhacCuaTuiStreamUrl({ source: 'nhaccuatui', nhaccuatui_id: 'id/with space' }))
      .toBe('/api/nhaccuatui/stream?id=id%2Fwith%20space')
    expect(getNhacCuaTuiStreamUrl({ source: 'youtube', nhaccuatui_id: 'nct-1' })).toBeNull()
  })

  it('uses the configured NCT stream cache worker URL when available', () => {
    process.env.NEXT_PUBLIC_NCT_STREAM_CACHE_URL = 'https://music-stream-cache.phongtct.workers.dev'
    expect(getNhacCuaTuiStreamUrl({ source: 'nhaccuatui', nhaccuatui_id: 'nct-1' }))
      .toBe('https://music-stream-cache.phongtct.workers.dev/api/stream?id=nct-1')

    process.env.NEXT_PUBLIC_NCT_STREAM_CACHE_URL = 'https://music-stream-cache.phongtct.workers.dev/api/stream'
    expect(getNhacCuaTuiStreamUrl({ source: 'nhaccuatui', nhaccuatui_id: 'nct-1' }))
      .toBe('https://music-stream-cache.phongtct.workers.dev/api/stream?id=nct-1')
  })

  it('searches through the internal metadata route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        items: [{ id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto' }],
      }), { status: 200 }),
    )

    await expect(searchNhacCuaTui('xương rồng')).resolves.toEqual([
      { id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto' },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/nhaccuatui/search?q=x%C6%B0%C6%A1ng%20r%E1%BB%93ng',
      { cache: 'no-store' },
    )
  })

  it('resolves a fresh signed audio URL through the internal song route', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        song: {
          id: 'nct-1',
          title: 'Xương Rồng',
          artist: 'Dangrangto',
          lyric: '[00:01.00]line one',
          streamUrl: '/api/nhaccuatui/stream?id=nct-1',
        },
      }), { status: 200 }),
    )

    await expect(resolveNhacCuaTuiSong('nct-1')).resolves.toMatchObject({
      id: 'nct-1',
      streamUrl: '/api/nhaccuatui/stream?id=nct-1',
      lyric: '[00:01.00]line one',
    })
  })

  it('returns null when the route cannot resolve a stream', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }))

    await expect(resolveNhacCuaTuiSong('missing')).resolves.toBeNull()
  })

  it('matches Spotify metadata before resolving the NCT stream', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [
          { id: 'wrong', title: 'Xương Rồng Remix', artist: 'Dangrangto' },
          { id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto' },
        ],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        song: {
          id: 'nct-1',
          title: 'Xương Rồng',
          artist: 'Dangrangto',
          lyric: '[00:01.00]line one',
          streamUrl: '/api/nhaccuatui/stream?id=nct-1',
        },
      }), { status: 200 }))

    await expect(resolveNhacCuaTuiAudio({
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      duration: 220,
    })).resolves.toMatchObject({ id: 'nct-1' })
  })

  it('resolves an NCT search result by exact nhaccuatui_id without searching again', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        song: {
          id: 'nct-1',
          title: 'XÆ°Æ¡ng Rá»“ng',
          artist: 'Dangrangto',
          streamUrl: '/api/nhaccuatui/stream?id=nct-1',
        },
      }), { status: 200 }),
    )

    await expect(resolveNhacCuaTuiTrack({
      title: 'XÆ°Æ¡ng Rá»“ng',
      artist: 'Dangrangto',
      duration: 220,
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-1',
    })).resolves.toMatchObject({ id: 'nct-1' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
