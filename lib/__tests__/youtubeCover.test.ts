import { describe, it, expect } from 'vitest'
import { getHighResCoverUrl } from '@/components/common/TrackCoverImage'
import { getBestYouTubeThumbnailUrl } from '@/lib/youtube'

describe('YouTube High Resolution Cover Utilities', () => {
  it('should upgrade low-res YouTube hqdefault.jpg to maxresdefault.jpg', () => {
    const input = 'https://img.youtube.com/vi/ogalxoVRNuQ/hqdefault.jpg'
    const result = getHighResCoverUrl(input)
    expect(result).toBe('https://i.ytimg.com/vi/ogalxoVRNuQ/maxresdefault.jpg')
  })

  it('should strip YouTubei downscaling sqp parameters and return maxresdefault.jpg', () => {
    const input = 'https://i.ytimg.com/vi/ogalxoVRNuQ/hq720.jpg?sqp=-oaymwEXCNAFEJQDSFryq4qpAwkIARUAAIhCGAE=&rs=AOn4CLDiD6IRlom6QGDwM1TFkUoPUdw6fw'
    const result = getHighResCoverUrl(input)
    expect(result).toBe('https://i.ytimg.com/vi/ogalxoVRNuQ/maxresdefault.jpg')
  })

  it('should generate maxresdefault.jpg for YouTube videoId via getBestYouTubeThumbnailUrl', () => {
    const result = getBestYouTubeThumbnailUrl('ogalxoVRNuQ')
    expect(result).toBe('https://i.ytimg.com/vi/ogalxoVRNuQ/maxresdefault.jpg')
  })

  it('should handle raw YouTube URLs with query params in getBestYouTubeThumbnailUrl', () => {
    const raw = 'https://i.ytimg.com/vi/OWCBdJMC-78/hq720.jpg?sqp=-oaymwEjCOgCEMoBSFryq4qpAxUIARUAAAAAGAElAADIQj0AgKJDeAE=&rs=AOn4CLA9EysQENVZtShT5cnhcp2gdd3a_g'
    const result = getBestYouTubeThumbnailUrl('OWCBdJMC-78', raw)
    expect(result).toBe('https://i.ytimg.com/vi/OWCBdJMC-78/maxresdefault.jpg')
  })
})
