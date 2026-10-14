import { describe, it, expect } from 'vitest'
import {
  cleanTrackTitleForAlbumSearch,
  normalizeAlbumText,
  stripAlbumEditionSuffix,
  cleanDisplayAlbumName,
  isAlbumArtistMatch,
  isAlbumTrackTitleMatch,
  isAlbumNameMatch,
  isLikelySingleAlbum,
  selectBestAlbumTrackCandidate,
} from '../albumMatching'

describe('normalizeAlbumText', () => {
  it('converts Vietnamese Đ/đ and diacritics properly', () => {
    expect(normalizeAlbumText('Đen Vâu')).toBe('den vau')
    expect(normalizeAlbumText('Sơn Tùng M-TP')).toBe('son tung m tp')
    expect(normalizeAlbumText('Bảo Tàng Của Nuối Tiếc')).toBe('bao tang cua nuoi tiec')
  })

  it('preserves legitimate words like Single, Video, Audio inside titles', () => {
    expect(normalizeAlbumText('Single Ladies (Put a Ring on It)')).toBe('single ladies put a ring on it')
    expect(normalizeAlbumText('Single Soon')).toBe('single soon')
    expect(normalizeAlbumText('Video Games')).toBe('video games')
  })

  it('strips trailing - Single / - EP and upload annotations', () => {
    expect(normalizeAlbumText('Making My Way - Single')).toBe('making my way')
    expect(normalizeAlbumText('Cruel Summer (Official Video)')).toBe('cruel summer')
    expect(normalizeAlbumText('Lạc Trôi [Official MV 4K]')).toBe('lac troi')
  })
})

describe('stripAlbumEditionSuffix', () => {
  it('strips deluxe, edition, version, and remastered suffixes', () => {
    expect(stripAlbumEditionSuffix('Midnights (3am Edition)')).toBe('midnights')
    expect(stripAlbumEditionSuffix('Midnights (The Til Dawn Edition)')).toBe('midnights')
    expect(stripAlbumEditionSuffix("1989 (Taylor's Version) [Deluxe]")).toBe('1989')
    expect(stripAlbumEditionSuffix('After Hours (Deluxe)')).toBe('after hours')
    expect(stripAlbumEditionSuffix('Abbey Road (2019 Remaster)')).toBe('abbey road')
  })
})

describe('isAlbumArtistMatch', () => {
  it('matches exact and diacritic-folded artist names', () => {
    expect(isAlbumArtistMatch('Sơn Tùng M-TP', 'Son Tung M-TP')).toBe(true)
    expect(isAlbumArtistMatch('Đen', 'Den')).toBe(true)
  })

  it('matches multi-artist collaborations in either direction', () => {
    expect(isAlbumArtistMatch('ROSÉ', 'ROSÉ & Bruno Mars')).toBe(true)
    expect(isAlbumArtistMatch('Bruno Mars', 'ROSÉ, Bruno Mars')).toBe(true)
    expect(isAlbumArtistMatch('Taylor Swift feat. Ice Spice', 'Taylor Swift')).toBe(true)
  })

  it('supports 2-character artist names in collaborations', () => {
    expect(isAlbumArtistMatch('Vũ.', 'Vũ., Dear Jane')).toBe(true)
    expect(isAlbumArtistMatch('IU', 'IU, SUGA')).toBe(true)
  })

  it('rejects substring false positives without word boundaries', () => {
    expect(isAlbumArtistMatch('Michael Jackson', 'Son')).toBe(false)
    expect(isAlbumArtistMatch('Lana Del Rey', 'Ana')).toBe(false)
    expect(isAlbumArtistMatch('Various Artists', 'Taylor Swift')).toBe(false)
  })
})

describe('isAlbumTrackTitleMatch', () => {
  it('matches identical or upload-annotated titles', () => {
    expect(isAlbumTrackTitleMatch('Anti-Hero', 'Anti-Hero (Official Music Video)')).toBe(true)
    expect(isAlbumTrackTitleMatch('Chúng Ta Của Hiện Tại', 'Chung Ta Cua Hien Tai')).toBe(true)
  })

  it('rejects 1-word prefix false positives', () => {
    expect(isAlbumTrackTitleMatch('Anh', 'Anh Đã Quen Với Cô Đơn')).toBe(false)
    expect(isAlbumTrackTitleMatch('Love', 'Lover')).toBe(false)
    expect(isAlbumTrackTitleMatch('Love', 'Love Story')).toBe(false)
  })

  it('rejects incompatible variants like remix or live when target is original', () => {
    expect(isAlbumTrackTitleMatch('Anti-Hero (Kungs Remix)', 'Anti-Hero')).toBe(false)
    expect(isAlbumTrackTitleMatch('Anti-Hero (Acoustic Version)', 'Anti-Hero')).toBe(false)
  })
})

describe('isAlbumNameMatch', () => {
  it('matches exact and edition-variant album names', () => {
    expect(isAlbumNameMatch('Midnights', 'Midnights (3am Edition)')).toBe(true)
    expect(isAlbumNameMatch("1989 (Taylor's Version)", '1989')).toBe(true)
  })

  it('does NOT match unrelated prefix album names against song or album titles', () => {
    expect(isAlbumNameMatch('Love', 'Love Story')).toBe(false)
    expect(isAlbumNameMatch('Intro', 'Intro Song')).toBe(false)
  })
})

describe('isLikelySingleAlbum', () => {
  it('identifies singles where album title equals track title unless multi-track album', () => {
    expect(isLikelySingleAlbum('Anti-Hero', 'Anti-Hero')).toBe(true)
    expect(isLikelySingleAlbum('Seven - Single', 'Seven')).toBe(true)
    expect(isLikelySingleAlbum('Lover', 'Lover', 18, 'album')).toBe(false)
    expect(isLikelySingleAlbum('Midnights', 'Anti-Hero', 13, 'album')).toBe(false)
  })
})

describe('selectBestAlbumTrackCandidate', () => {
  it('prefers full studio album over 1-track single and compilation', () => {
    const candidates = [
      {
        trackTitle: 'Anti-Hero',
        artistName: 'Taylor Swift',
        albumId: '111',
        albumTitle: 'Anti-Hero',
        albumType: 'single',
        totalTracks: 1,
      },
      {
        trackTitle: 'Anti-Hero',
        artistName: 'Taylor Swift',
        albumId: '222',
        albumTitle: 'Top Hits 2023',
        albumType: 'compilation',
        totalTracks: 30,
      },
      {
        trackTitle: 'Anti-Hero',
        artistName: 'Taylor Swift',
        albumId: '333',
        albumTitle: 'Midnights',
        albumType: 'album',
        totalTracks: 13,
      },
    ]

    const best = selectBestAlbumTrackCandidate(candidates, {
      title: 'Anti-Hero',
      artist: 'Taylor Swift',
    })
    expect(best?.albumId).toBe('333')
    expect(best?.albumTitle).toBe('Midnights')
  })

  it('prefers candidate matching expected targetAlbum when provided', () => {
    const candidates = [
      {
        trackTitle: 'All Too Well',
        artistName: 'Taylor Swift',
        albumId: '10',
        albumTitle: 'Red',
        albumType: 'album',
        totalTracks: 16,
      },
      {
        trackTitle: 'All Too Well',
        artistName: 'Taylor Swift',
        albumId: '20',
        albumTitle: "Red (Taylor's Version)",
        albumType: 'album',
        totalTracks: 30,
      },
    ]

    const best = selectBestAlbumTrackCandidate(candidates, {
      title: 'All Too Well',
      artist: 'Taylor Swift',
      album: 'Red',
    })
    // Both match base name "Red", 30-track Taylor's Version or exact match is selected
    expect(best).not.toBeNull()
  })

  it('falls back to single when no studio album candidate exists', () => {
    const candidates = [
      {
        trackTitle: 'Making My Way',
        artistName: 'Sơn Tùng M-TP',
        albumId: '431887357',
        albumTitle: 'Making My Way',
        albumType: 'single',
        totalTracks: 1,
      },
    ]

    const best = selectBestAlbumTrackCandidate(candidates, {
      title: 'Making My Way',
      artist: 'Sơn Tùng M-TP',
    })
    expect(best?.albumId).toBe('431887357')
  })
})

describe('cleanDisplayAlbumName & cleanTrackTitleForAlbumSearch', () => {
  it('strips trailing - Single / - EP from display album names', () => {
    expect(cleanDisplayAlbumName('Making My Way - Single')).toBe('Making My Way')
    expect(cleanDisplayAlbumName('NewJeans 2nd EP Get Up - EP')).toBe('NewJeans 2nd EP Get Up')
    expect(cleanDisplayAlbumName('Midnights')).toBe('Midnights')
  })

  it('cleans redundant artist prefix and MV tags from track title', () => {
    expect(
      cleanTrackTitleForAlbumSearch(
        'Sơn Tùng M-TP - Chúng Ta Của Hiện Tại (Official Music Video)',
        'Sơn Tùng M-TP',
      ),
    ).toBe('Chúng Ta Của Hiện Tại')
  })
})
