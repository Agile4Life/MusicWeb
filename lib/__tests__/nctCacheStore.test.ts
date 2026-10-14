import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAllNctAudioCache,
  getNctAudioCache,
  resolveNctSongDetailCached,
  searchNctCached,
} from '../nctCacheStore'

describe('resolveNctSongDetailCached & searchNctCached', () => {
  beforeEach(() => {
    clearAllNctAudioCache()
  })

  afterEach(() => {
    clearAllNctAudioCache()
    vi.unstubAllGlobals()
  })

  it('validates playable audioUrl, preserves timedLyric, and warms shared NCT cache', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        song: {
          id: 'nct-valid-1',
          title: 'Chúng Ta Của Hiện Tại',
          artist: 'Sơn Tùng M-TP',
          audioUrl: 'https://cdn.nct.vn/audio/valid-1.mp3',
          duration: 289,
          timedLyric: [{ time: 12000, text: 'Mùa thu mang giấc mơ quay về' }],
          lyric: 'Plain lyric fallback',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const detail = await resolveNctSongDetailCached('nct-valid-1', 1500)
    expect(detail?.audioUrl).toBe('https://cdn.nct.vn/audio/valid-1.mp3')
    expect(detail?.lyric).toContain('[00:12.00] Mùa thu mang giấc mơ quay về')
    expect(getNctAudioCache('nct-valid-1')?.audioUrl).toBe('https://cdn.nct.vn/audio/valid-1.mp3')
    expect(getNctAudioCache('nct-valid-1')?.lyric).toContain('[00:12.00] Mùa thu mang giấc mơ quay về')

    // Second lookup hits in-memory cache with 0 network calls
    const second = await resolveNctSongDetailCached('nct-valid-1', 1500)
    expect(second?.audioUrl).toBe('https://cdn.nct.vn/audio/valid-1.mp3')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns null when NCT song detail has no playable audioUrl (VIP or dead link)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          song: {
            id: 'nct-dead-1',
            title: 'Bài Hát VIP Không Link',
            artist: 'Ca Sĩ A',
            audioUrl: '',
          },
        }),
      ),
    )

    const detail = await resolveNctSongDetailCached('nct-dead-1', 1500)
    expect(detail).toBeNull()
    expect(getNctAudioCache('nct-dead-1')).toBeNull()
  })

  it('deduplicates concurrent in-flight search queries and caches results', async () => {
    let resolveFetch!: (res: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const p1 = searchNctCached('Timeless The Weeknd')
    const p2 = searchNctCached('  timeless   the weeknd ')

    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch(
      Response.json([
        { id: 'xxkiVtQf4MX9', title: 'Timeless', artist: 'The Weeknd, Playboi Carti', duration: 256 },
      ]),
    )

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toHaveLength(1)
    expect(r1[0]?.id).toBe('xxkiVtQf4MX9')
    expect(r2).toEqual(r1)

    // Subsequent call hits search cache without fetching
    const r3 = await searchNctCached('Timeless The Weeknd')
    expect(r3).toEqual(r1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

