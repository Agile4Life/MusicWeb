import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getPrimaryLyrics } from '../lyricsFlow'
import { resolveNhacCuaTuiSong } from '../nhaccuatuiClient'
import { fetchLyricsFromLrclib } from '../lrclib'

vi.mock('../nhaccuatuiClient', () => ({
  resolveNhacCuaTuiSong: vi.fn(),
}))

vi.mock('../lrclib', () => ({
  fetchLyricsFromLrclib: vi.fn(),
}))

const resolveNctMock = vi.mocked(resolveNhacCuaTuiSong)
const lrclibMock = vi.mocked(fetchLyricsFromLrclib)

describe('primary lyrics flow', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns synced NCT lyrics without calling LRCLIB', async () => {
    resolveNctMock.mockResolvedValue({
      id: 'nct-1',
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      lyric: '[00:01.00]line one',
      audioUrl: 'https://stream.nct.vn/song.mp3?expires=123',
    })

    const result = await getPrimaryLyrics({
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      duration: 220,
      nhaccuatui_id: 'nct-1',
    })

    expect(result?.syncedLyrics).toBe('[00:01.00]line one')
    expect(lrclibMock).not.toHaveBeenCalled()
  })

  it('falls back to LRCLIB when NCT has no usable lyrics', async () => {
    resolveNctMock.mockResolvedValue({
      id: 'nct-1',
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      lyric: null,
      audioUrl: 'https://stream.nct.vn/song.mp3?expires=123',
    })
    lrclibMock.mockResolvedValue({
      id: 1,
      trackName: 'Xương Rồng',
      artistName: 'Dangrangto',
      duration: 220,
      instrumental: false,
      plainLyrics: 'fallback lyrics',
      syncedLyrics: null,
    })

    await expect(getPrimaryLyrics({
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      duration: 220,
      nhaccuatui_id: 'nct-1',
    })).resolves.toMatchObject({ plainLyrics: 'fallback lyrics' })
    expect(lrclibMock).toHaveBeenCalledOnce()
  })
})
