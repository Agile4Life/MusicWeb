import { describe, expect, it } from 'vitest'

import {
  trackMetadataArtistClass,
  trackMetadataArtistInlineClass,
  trackMetadataLoadingClass,
  trackMetadataLoopScrubberClass,
  trackMetadataTitleClass,
} from '../trackMetadataLayout'

describe('track metadata layout contract', () => {
  it('gives title and artist independent shrinkable regions', () => {
    expect(trackMetadataTitleClass).toContain('min-w-0')
    expect(trackMetadataTitleClass).toContain('flex-1')
    expect(trackMetadataArtistClass).toContain('min-w-0')
    expect(trackMetadataArtistClass).toContain('truncate')
  })

  it('keeps the loading badge bounded so it cannot collapse the artist row', () => {
    expect(trackMetadataLoadingClass).toContain('min-w-0')
    expect(trackMetadataLoadingClass).toContain('max-w-')
    expect(trackMetadataLoadingClass).toContain('truncate')
  })

  it('keeps the desktop artist stable and the scrubber beside loop controls', () => {
    expect(trackMetadataArtistInlineClass).toContain('min-w-0')
    expect(trackMetadataArtistInlineClass).toContain('truncate')
    expect(trackMetadataArtistInlineClass).toContain('shrink')
    expect(trackMetadataLoopScrubberClass).toContain('shrink-0')
    expect(trackMetadataLoopScrubberClass).toContain('w-[')
  })
})
