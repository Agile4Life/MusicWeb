import { describe, expect, it } from 'vitest'
import { hasCatalogArtistEvidence, hasIncompatiblePlaybackVariant, isSoundCloudCatalogMatch } from '../catalogMatching'

describe('catalog artist evidence', () => {
  it.each([
    ['Taylor Swift feat. Ed Sheeran', 'Ed Sheeran - Topic'],
    ['Taylor Swift, Ed Sheeran', 'Taylor Swift Official'],
    ['Sơn Tùng M-TP', 'Son Tung M TP'],
    ['Adele', 'AdeleVEVO'],
    ['방탄소년단', '방탄소년단'],
  ])('accepts credited artist %s from uploader %s', (targetArtist, artist) => {
    expect(hasCatalogArtistEvidence({ artist }, targetArtist)).toBe(true)
  })

  it('does not count an artist as a substring of a different name', () => {
    expect(hasCatalogArtistEvidence({ title: 'Hello', artist: 'Adelaide' }, 'Adele')).toBe(false)
    expect(hasCatalogArtistEvidence({ title: 'Hello', artist: 'BTSFan' }, 'BTS')).toBe(false)
  })

  it('preserves unspaced slashes within one artist name', () => {
    expect(hasCatalogArtistEvidence({ artist: 'AC' }, 'AC/DC')).toBe(false)
    expect(hasCatalogArtistEvidence({ artist: 'DC' }, 'AC/DC')).toBe(false)
    expect(hasCatalogArtistEvidence({ artist: 'AC/DC - Topic' }, 'AC/DC')).toBe(true)
  })

  it('accepts a credited artist separated by a spaced slash', () => {
    expect(hasCatalogArtistEvidence({ artist: 'Ed Sheeran' }, 'Taylor Swift / Ed Sheeran')).toBe(true)
  })

  it('allows title matching when the requested artist is unavailable', () => {
    expect(hasCatalogArtistEvidence({ title: 'Hello', artist: 'Unknown' }, null)).toBe(true)
  })
})

describe('variant marker boundaries', () => {
  it.each(['Heartbeat', 'Recover', 'Liverpool', 'Loophole'])('keeps the original title %s', (title) => {
    expect(hasIncompatiblePlaybackVariant(title, title)).toBe(false)
    expect(hasIncompatiblePlaybackVariant(title, 'Other')).toBe(false)
  })

  it('detects a phrase across parentheses and hyphen punctuation', () => {
    expect(hasIncompatiblePlaybackVariant('Hello (Sped-Up)', 'Hello')).toBe(true)
    expect(hasIncompatiblePlaybackVariant('Hello (Sped-Up)', 'Hello (Sped Up)')).toBe(false)
  })
})

describe('SoundCloud catalog matches', () => {
  const target = { title: 'Hello', artist: 'Lionel Richie', duration: 240 }

  it('rejects an exact title with another artist despite matching duration', () => {
    expect(isSoundCloudCatalogMatch({ title: 'Hello', artist: 'Adele', duration: 240 }, target)).toBe(false)
  })

  it('accepts artist attribution in a label upload title', () => {
    expect(isSoundCloudCatalogMatch({ title: 'Lionel Richie - Hello', artist: 'Universal Music', duration: 270 }, target)).toBe(true)
  })

  it('rejects duration differences beyond 30 seconds', () => {
    expect(isSoundCloudCatalogMatch({ title: 'Hello', artist: 'Lionel Richie', duration: 271 }, target)).toBe(false)
  })

  it('rejects cover variants while preserving a requested remix', () => {
    expect(isSoundCloudCatalogMatch({ title: 'Hello (Cover)', artist: 'Lionel Richie' }, target)).toBe(false)
    expect(isSoundCloudCatalogMatch(
      { title: 'Hello (Remix)', artist: 'Lionel Richie' },
      { ...target, title: 'Hello (Remix)' },
    )).toBe(true)
  })

  it('keeps a Heartbeat release without treating beat as a marker', () => {
    expect(isSoundCloudCatalogMatch({ title: 'Heartbeat', artist: 'BTS' }, { title: 'Heartbeat', artist: 'BTS' })).toBe(true)
  })

  it('does not treat a partial title word as a title match', () => {
    expect(isSoundCloudCatalogMatch({ title: 'Hello', artist: 'Lionel Richie' }, { ...target, title: 'Hell' })).toBe(false)
  })
})
