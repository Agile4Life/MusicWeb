import { describe, expect, it } from 'vitest'
import { isPreviewUrl } from '@/lib/googleDriveUpload'

describe('Catalog stream resolution helpers', () => {
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
})
