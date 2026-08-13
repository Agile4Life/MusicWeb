import { describe, expect, it } from 'vitest'

import {
  trackMetadataArtistClass,
  trackMetadataArtistInlineClass,
  trackMetadataLoadingClass,
  trackMetadataProgressClass,
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

  it('keeps the desktop artist stable for the controls row', () => {
    expect(trackMetadataArtistInlineClass).toContain('min-w-0')
    expect(trackMetadataArtistInlineClass).toContain('truncate')
    expect(trackMetadataArtistInlineClass).toContain('shrink')
  })

  it('uses a stable centered width for the progress row below playback controls', () => {
    expect(trackMetadataProgressClass).toContain('w-full')
    expect(trackMetadataProgressClass).toContain('max-w-[560px]')
    expect(trackMetadataProgressClass).toContain('min-w-[320px]')
  })
})
