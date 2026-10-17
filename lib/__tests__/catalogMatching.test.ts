import { describe, expect, it } from 'vitest'
import {
  findBestSoundCloudMatch,
  hasCatalogArtistEvidence,
  hasIncompatiblePlaybackVariant,
  isSoundCloudCatalogMatch,
} from '../catalogMatching'
import { findMemoryDriveTrack } from '../driveTracksMap'

describe('catalog artist evidence', () => {
  it.each([
    ['Taylor Swift feat. Ed Sheeran', 'Ed Sheeran - Topic'],
    ['Taylor Swift, Ed Sheeran', 'Taylor Swift Official'],
    ['Sơn Tùng M-TP', 'Son Tung M TP'],
    ['Adele', 'AdeleVEVO'],
    ['방탄소년단', '방탄소년단'],
    ['RPT MCK', 'MCK'],
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

  it('rejects a short 1-word candidate title contained inside a long target title', () => {
    expect(
      isSoundCloudCatalogMatch(
        { title: 'Anh', artist: 'Soobin Hoàng Sơn', duration: 240 },
        { title: 'Anh Da Quen Voi Co Don', artist: 'Soobin Hoàng Sơn', duration: 240 },
      ),
    ).toBe(false)
  })

  it('ranks the closest duration and exact title match first in findBestSoundCloudMatch', () => {
    const best = findBestSoundCloudMatch(
      [
        { id: 'sc-loose', title: 'Lionel Richie - Hello (Official Audio)', artist: 'Lionel Richie', duration: 262 },
        { id: 'sc-exact', title: 'Hello', artist: 'Lionel Richie', duration: 241 },
      ],
      target,
    )
    expect(best?.id).toBe('sc-exact')
  })
})

describe('Static Drive track matching (findMemoryDriveTrack)', () => {
  it('rejects same-titled songs by other artists instead of matching MCK', () => {
    expect(findMemoryDriveTrack('Baby', 'Justin Bieber')).toBeNull()
    expect(findMemoryDriveTrack('Cảm Ơn', 'Wanbi Tuấn Anh')).toBeNull()
    expect(findMemoryDriveTrack('IDK', 'Other Artist')).toBeNull()
  })

  it('rejects unrequested remix/live variants of MCK tracks', () => {
    expect(findMemoryDriveTrack('Baby (Remix)', 'MCK')).toBeNull()
  })

  it('matches genuine MCK tracks including RPT MCK alias and featured credits', () => {
    expect(findMemoryDriveTrack('Baby', 'MCK')?.artist).toBe('MCK')
    expect(findMemoryDriveTrack('Xa Xôi', 'RPT MCK')?.artist).toBe('MCK')
    expect(findMemoryDriveTrack('Mắt Môi Tay Chân', 'MCK, Tage')?.artist).toBe('MCK')
  })

  it('strips pipe/dash upload suffixes and prod credits in stripNonIdentityAnnotations and title matching', () => {
    expect(
      isSoundCloudCatalogMatch(
        { title: 'Chúng Ta Của Tương Lai | Official Music Video', artist: 'Sơn Tùng M-TP', duration: 249 },
        { title: 'Chúng Ta Của Tương Lai', artist: 'Sơn Tùng M-TP', duration: 249 },
      ),
    ).toBe(true)

    expect(
      isSoundCloudCatalogMatch(
        { title: 'Bình Yên - Official Audio (Prod. by Kewtiie)', artist: 'Vũ.', duration: 215 },
        { title: 'Bình Yên', artist: 'Vũ.', duration: 215 },
      ),
    ).toBe(true)
  })

  it('rejects a long candidate song title when the target title is a short 1-2 word prefix of a different song', () => {
    expect(
      isSoundCloudCatalogMatch(
        { title: 'Anh Đã Quên Với Cô Đơn', artist: 'Soobin Hoàng Sơn', duration: 240 },
        { title: 'Anh', artist: 'Soobin Hoàng Sơn', duration: 240 },
      ),
    ).toBe(false)

    expect(
      isSoundCloudCatalogMatch(
        { title: 'Chúng Ta Của Hiện Tại', artist: 'Sơn Tùng M-TP', duration: 290 },
        { title: 'Chúng Ta', artist: 'Sơn Tùng M-TP', duration: 290 },
      ),
    ).toBe(false)
  })

  it('recognizes common V-Pop stage name spacing and crew aliases in hasCatalogArtistEvidence', () => {
    expect(hasCatalogArtistEvidence({ artist: 'Orijinn' }, 'RPT Orijinn')).toBe(true)
    expect(hasCatalogArtistEvidence({ artist: 'LowG' }, 'Low G')).toBe(true)
    expect(hasCatalogArtistEvidence({ artist: 'Sơn Tùng MTP' }, 'Sơn Tùng M-TP')).toBe(true)
    expect(hasCatalogArtistEvidence({ artist: 'Đen Vâu' }, 'Đen')).toBe(true)
    expect(hasCatalogArtistEvidence({ artist: 'HIEUTHUHAI' }, 'Hieu Thu Hai')).toBe(true)
  })
})

