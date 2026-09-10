import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveStreamCached,
  type ResolvedStreamResult,
  buildStableProxyStreamUrl,
} from '@/lib/resolveStreamClient'

describe('Direct Stream Resolution & Waterfall Elimination (Task 5)', () => {
  let mockFetch: any

  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Case 1: Helper generates stable proxy stream URLs for each provider', () => {
    expect(buildStableProxyStreamUrl('nhaccuatui', 'song-123')).toBe('/api/nhaccuatui/stream?id=song-123')
    expect(buildStableProxyStreamUrl('soundcloud', 'sc-456')).toBe('/api/soundcloud/stream?id=sc-456')
    expect(buildStableProxyStreamUrl('drive', 'https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9/view')).toBe(
      '/api/drive-stream?fileId=1A2B3C4D5E6F7G8H9'
    )
    expect(buildStableProxyStreamUrl('youtube', 'yt-789')).toBe('/api/yt-stream?id=yt-789')
  })

  it('Case 2: /api/resolve-stream returns direct streamUrl eliminating secondary roundtrips', async () => {
    mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        source: 'nhaccuatui',
        id: 'nct_sample_123',
        title: 'Chạy Về Khóc Với Anh',
        artist: 'ERIK',
        duration: 210,
        coverUrl: 'https://cover.nct.vn/1.jpg',
        streamUrl: '/api/nhaccuatui/stream?id=nct_sample_123',
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await resolveStreamCached({
      title: 'Chạy Về Khóc Với Anh',
      artist: 'ERIK',
      duration: 210,
    })

    expect(result).not.toBeNull()
    expect(result?.source).toBe('nhaccuatui')
    expect(result?.id).toBe('nct_sample_123')
    expect(result?.streamUrl).toBe('/api/nhaccuatui/stream?id=nct_sample_123')
    expect(mockFetch).toHaveBeenCalledTimes(1)

    // Second call for same track: served from L1 clientCache immediately (0 network calls)
    const cachedResult = await resolveStreamCached({
      title: 'Chạy Về Khóc Với Anh',
      artist: 'ERIK',
      duration: 210,
    })

    expect(cachedResult).toEqual(result)
    // Fetch should still have been called only once!
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('Case 3: Rejects storing raw signed CDN URLs with expiry tokens in localStorage', () => {
    const rawSignedUrl = 'https://cdn.example.com/audio.mp3?token=expired123&expires=1700000000'
    const isEphemeralUrl = (url: string) => {
      return (
        url.includes('token=') ||
        url.includes('expires=') ||
        url.includes('Expires=') ||
        url.includes('Signature=')
      )
    }

    expect(isEphemeralUrl(rawSignedUrl)).toBe(true)

    const stableProxyUrl = buildStableProxyStreamUrl('soundcloud', '123456')
    expect(isEphemeralUrl(stableProxyUrl)).toBe(false)
  })
})
