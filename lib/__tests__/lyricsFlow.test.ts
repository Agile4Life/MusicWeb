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

  it('prioritizes synced NCT lyrics even if both NCT and LRCLIB run in parallel', async () => {
    resolveNctMock.mockResolvedValue({
      id: 'nct-1',
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      lyric: '[00:01.00]line one from NCT',
      audioUrl: 'https://stream.nct.vn/song.mp3?expires=123',
    })
    lrclibMock.mockResolvedValue({
      id: 99,
      trackName: 'Xương Rồng',
      artistName: 'Dangrangto',
      duration: 220,
      instrumental: false,
      plainLyrics: 'LRCLIB plain',
      syncedLyrics: '[00:01.00]line one from LRCLIB',
    })

    const result = await getPrimaryLyrics({
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      duration: 220,
      nhaccuatui_id: 'nct-1',
    })

    expect(result?.syncedLyrics).toBe('[00:01.00]line one from NCT')
    expect(lrclibMock).toHaveBeenCalledOnce()
    expect(resolveNctMock).toHaveBeenCalledOnce()
  })

  it('falls back to LRCLIB synced lyrics when NCT has only plain lyrics', async () => {
    resolveNctMock.mockResolvedValue({
      id: 'nct-1',
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      lyric: 'Dòng một không có timestamp\nDòng hai không có timestamp',
      audioUrl: 'https://stream.nct.vn/song.mp3?expires=123',
    })
    lrclibMock.mockResolvedValue({
      id: 2,
      trackName: 'Xương Rồng',
      artistName: 'Dangrangto',
      duration: 220,
      instrumental: false,
      plainLyrics: 'LRCLIB plain lyrics',
      syncedLyrics: '[00:01.00]LRCLIB synced line one\n[00:05.00]LRCLIB synced line two',
    })

    const result = await getPrimaryLyrics({
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      duration: 220,
      nhaccuatui_id: 'nct-1',
    })

    expect(lrclibMock).toHaveBeenCalledOnce()
    expect(result?.syncedLyrics).toBe('[00:01.00]LRCLIB synced line one\n[00:05.00]LRCLIB synced line two')
  })

  it('returns NCT plain lyrics when NCT has plain lyrics and LRCLIB has no synced lyrics', async () => {
    resolveNctMock.mockResolvedValue({
      id: 'nct-1',
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      lyric: 'Dòng một không có timestamp\nDòng hai không có timestamp',
      audioUrl: 'https://stream.nct.vn/song.mp3?expires=123',
    })
    lrclibMock.mockResolvedValue({
      id: 3,
      trackName: 'Xương Rồng',
      artistName: 'Dangrangto',
      duration: 220,
      instrumental: false,
      plainLyrics: 'LRCLIB plain lyrics',
      syncedLyrics: null,
    })

    const result = await getPrimaryLyrics({
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      duration: 220,
      nhaccuatui_id: 'nct-1',
    })

    expect(lrclibMock).toHaveBeenCalledOnce()
    expect(result?.syncedLyrics).toBeNull()
    expect(result?.plainLyrics).toBe('Dòng một không có timestamp\nDòng hai không có timestamp')
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
