import { describe, expect, it, beforeEach } from 'vitest'
import { isPreviewUrl } from '@/lib/googleDriveUpload'
import { saveTrackResolution, getTrackResolution, deleteTrackResolution } from '@/lib/playbackPersistence'
import { resolveStreamCached, invalidateStreamResolution } from '@/lib/resolveStreamClient'

describe('Catalog stream resolution helpers', () => {
  const store: Record<string, string> = {}
  const mockLocalStorage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]) },
  }

  beforeEach(() => {
    mockLocalStorage.clear()
    // @ts-ignore
    globalThis.window = {}
    // @ts-ignore
    globalThis.localStorage = mockLocalStorage
  })

  it('correctly identifies iTunes, Spotify and preview audio URLs', () => {
    expect(isPreviewUrl('https://audio-ssl.itunes.apple.com/apple-assets-us-std-000001/audio.mp3')).toBe(true)
    expect(isPreviewUrl('https://p.scdn.co/mp3-preview/abc123def456')).toBe(true)
    expect(isPreviewUrl('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT')).toBe(true)
    expect(isPreviewUrl('spotify:4cOdK2wGLETKBW3PvgPWqT')).toBe(true)
    expect(isPreviewUrl('deezer:12345678')).toBe(true)
    expect(isPreviewUrl('itunes:12345678')).toBe(true)
    expect(isPreviewUrl('https://music-stream-cache.phongtct.workers.dev/api/stream?id=nct-1')).toBe(false)
    expect(isPreviewUrl('https://cf-media.sndcdn.com/test.128.mp3')).toBe(false)
  })

  it('filters out source: none from getTrackResolution and resolves to null', () => {
    const key = 'test_song___test_artist___200___'
    saveTrackResolution(key, { source: 'none', resolvedId: '', ttl: 60000 })
    
    // getTrackResolution should return null for 'none' to avoid truthy miss objects
    expect(getTrackResolution(key)).toBeNull()
  })

  it('saves and deletes track resolutions properly', () => {
    const key = 'valid_song___artist___180___'
    saveTrackResolution(key, { source: 'nhaccuatui', resolvedId: 'nct_123', ttl: 60000 })

    expect(getTrackResolution(key)).toEqual({
      source: 'nhaccuatui',
      resolvedId: 'nct_123',
    })

    deleteTrackResolution(key)
    expect(getTrackResolution(key)).toBeNull()
  })

  it('correctly cleans complex Spotify track titles for search fallback', () => {
    const rawTitle = 'In The End (Official Video) - 2020 Remastered'
    const rawArtist = 'Linkin Park (feat. Chester)'

    const cleanTitleOnly = rawTitle
      .replace(/[\(\[\{].*?[\)\]\}]/g, '')
      .replace(/\s*-\s*.*?\b(remaster(ed)?|live|bonus track|single version|mono|stereo|official\s+(audio|video|mv))\b.*/i, '')
      .trim()
    const cleanArtistOnly = rawArtist
      .replace(/[\(\[\{].*?[\)\]\}]/g, '')
      .replace(/\s*feat(\.|\s).*$/i, '')
      .trim()
    const cleanQ = `${cleanTitleOnly || rawTitle} ${cleanArtistOnly || rawArtist}`.trim()

    expect(cleanTitleOnly).toBe('In The End')
    expect(cleanArtistOnly).toBe('Linkin Park')
    expect(cleanQ).toBe('In The End Linkin Park')
  })
})

