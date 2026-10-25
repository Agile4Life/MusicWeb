import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPrimaryLyrics,
  clearPrimaryLyricsCache,
  setCustomLyricsInPrimaryCache,
} from '../lyricsFlow'
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
    clearPrimaryLyricsCache()
  })

  it('returns synced NCT lyrics without calling LRCLIB', async () => {
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
    expect(lrclibMock).not.toHaveBeenCalled()
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

  it('prevents lyrics lookup for SoundCloud UGC user uploads, remixes and beats', async () => {
    const ugcResult1 = await getPrimaryLyrics({
      title: 'Chung Ta Cua Tuong Lai (Vinahouse Remix 2024)',
      artist: 'DJ Duy Remix',
      source: 'soundcloud',
    })
    expect(ugcResult1).toBeNull()
    expect(lrclibMock).not.toHaveBeenCalled()

    const ugcResult2 = await getPrimaryLyrics({
      title: 'Lo-Fi Chill Beat Instrumental',
      artist: 'user-84920492',
      source: 'soundcloud',
    })
    expect(ugcResult2).toBeNull()
    expect(lrclibMock).not.toHaveBeenCalled()
  })

  const lookupTrack = { id: 'retryable', title: 'Song', artist: 'Artist', album: 'Studio', duration: 180 }
  const recoveredLyrics = {
    id: 42, trackName: 'Song', artistName: 'Artist', albumName: 'Studio',
    duration: 180, instrumental: false, plainLyrics: 'Recovered lyrics', syncedLyrics: null,
  }

  it('retries a transient provider miss on the next lookup', async () => {
    lrclibMock.mockResolvedValueOnce(null).mockResolvedValueOnce(recoveredLyrics)
    await expect(getPrimaryLyrics(lookupTrack)).resolves.toBeNull()
    await expect(getPrimaryLyrics(lookupTrack)).resolves.toMatchObject({ plainLyrics: 'Recovered lyrics' })
  })

  it('retries after a provider throws', async () => {
    lrclibMock.mockRejectedValueOnce(new Error('Provider unavailable')).mockResolvedValueOnce(recoveredLyrics)
    await expect(getPrimaryLyrics(lookupTrack)).resolves.toBeNull()
    await expect(getPrimaryLyrics(lookupTrack)).resolves.toMatchObject({ plainLyrics: 'Recovered lyrics' })
  })

  it.each([
    { album: 'Live album' },
    { duration: 240 },
    { youtube_id: 'different-video', nhaccuatui_id: 'same-nct' },
  ])('keeps distinct provider lookup metadata separate: %j', async (metadata) => {
    lrclibMock.mockResolvedValueOnce(recoveredLyrics).mockResolvedValueOnce({ ...recoveredLyrics, plainLyrics: 'Other version' })
    const original = { ...lookupTrack, youtube_id: 'original-video', nhaccuatui_id: 'same-nct' }
    await getPrimaryLyrics(original)
    await expect(getPrimaryLyrics({ ...original, ...metadata })).resolves.toMatchObject({ plainLyrics: 'Other version' })
  })

  it('deduplicates pending lookups and retains successful lyrics', async () => {
    let finish!: (value: typeof recoveredLyrics) => void
    lrclibMock.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const first = getPrimaryLyrics(lookupTrack)
    const second = getPrimaryLyrics(lookupTrack)
    finish(recoveredLyrics)
    expect(await first).toEqual(recoveredLyrics)
    expect(await second).toEqual(recoveredLyrics)
    expect(await getPrimaryLyrics(lookupTrack)).toEqual(recoveredLyrics)
    expect(lrclibMock).toHaveBeenCalledOnce()
  })

  it('evicts old successes after many distinct tracks instead of growing forever', async () => {
    lrclibMock.mockResolvedValue(recoveredLyrics)
    await getPrimaryLyrics(lookupTrack)
    for (let i = 0; i < 500; i++) await getPrimaryLyrics({ ...lookupTrack, id: `bounded-${i}` })
    lrclibMock.mockResolvedValue({ ...recoveredLyrics, plainLyrics: 'Refetched old track' })
    await expect(getPrimaryLyrics(lookupTrack)).resolves.toMatchObject({ plainLyrics: 'Refetched old track' })
  })

  it('prioritizes Admin custom lyrics (including on SoundCloud UGC/remix tracks) without calling external providers', async () => {
    const scRemixWithAdminLyrics = {
      id: 'sc-999',
      title: 'Chung Ta Cua Tuong Lai (Vinahouse Remix 2024)',
      artist: 'DJ Duy Remix',
      source: 'soundcloud' as const,
      lyrics: '[00:02.50] Lời do Admin viết cho bản remix\n[00:06.00] Câu thứ hai',
    }

    const res = await getPrimaryLyrics(scRemixWithAdminLyrics)
    expect(res?.syncedLyrics).toBe('[00:02.50] Lời do Admin viết cho bản remix\n[00:06.00] Câu thứ hai')
    expect(lrclibMock).not.toHaveBeenCalled()
    expect(resolveNctMock).not.toHaveBeenCalled()
  })

  it('updates and clears primary cache immediately via setCustomLyricsInPrimaryCache', async () => {
    const customTrack = {
      id: 'custom-1',
      title: 'Bài Hát Hiếm',
      artist: 'Nghệ Sĩ Độc Lập',
      duration: 200,
    }

    setCustomLyricsInPrimaryCache(customTrack, {
      id: 888888,
      trackName: customTrack.title,
      artistName: customTrack.artist,
      duration: 200,
      instrumental: false,
      plainLyrics: 'Lời tự viết dạng văn bản',
      syncedLyrics: null,
    })

    const cachedRes = await getPrimaryLyrics(customTrack)
    expect(cachedRes?.plainLyrics).toBe('Lời tự viết dạng văn bản')
    expect(lrclibMock).not.toHaveBeenCalled()

    setCustomLyricsInPrimaryCache(customTrack, null)
    lrclibMock.mockResolvedValueOnce(recoveredLyrics)
    const fallbackRes = await getPrimaryLyrics(customTrack)
    expect(fallbackRes?.plainLyrics).toBe('Recovered lyrics')
  })
})
