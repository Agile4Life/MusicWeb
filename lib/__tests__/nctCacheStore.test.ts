import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAllNctAudioCache,
  getNctAudioCache,
  resolveNctSongDetailCached,
} from '../nctCacheStore'

describe('resolveNctSongDetailCached', () => {
  beforeEach(() => {
    clearAllNctAudioCache()
  })

  afterEach(() => {
    clearAllNctAudioCache()
    vi.unstubAllGlobals()
  })

  it('validates playable audioUrl and warms shared NCT cache for stream route', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        song: {
          id: 'nct-valid-1',
          title: 'Chúng Ta Của Hiện Tại',
          artist: 'Sơn Tùng M-TP',
          audioUrl: 'https://cdn.nct.vn/audio/valid-1.mp3',
          duration: 289,
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const detail = await resolveNctSongDetailCached('nct-valid-1', 1500)
    expect(detail?.audioUrl).toBe('https://cdn.nct.vn/audio/valid-1.mp3')
    expect(getNctAudioCache('nct-valid-1')?.audioUrl).toBe('https://cdn.nct.vn/audio/valid-1.mp3')

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
})
