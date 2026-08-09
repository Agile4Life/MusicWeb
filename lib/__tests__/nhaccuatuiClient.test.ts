import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveNhacCuaTuiAudio, resolveNhacCuaTuiSong, resolveNhacCuaTuiTrack, searchNhacCuaTui } from '../nhaccuatuiClient'

describe('NhacCuaTui browser client', () => {
  afterEach(() => vi.restoreAllMocks())

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
          audioUrl: 'https://stream.nct.vn/song.mp3?expires=123',
        },
      }), { status: 200 }),
    )

    await expect(resolveNhacCuaTuiSong('nct-1')).resolves.toMatchObject({
      id: 'nct-1',
      audioUrl: 'https://stream.nct.vn/song.mp3?expires=123',
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
          audioUrl: 'https://stream.nct.vn/song.mp3?expires=123',
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
          audioUrl: 'https://stream.nct.vn/song.mp3?expires=123',
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
