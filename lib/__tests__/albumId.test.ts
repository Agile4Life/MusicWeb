import { describe, it, expect } from 'vitest'
import { stripAlbumIdPrefix, sortAlbumTracks, validateAndNormalizeCachedAlbum } from '../albumId'

describe('stripAlbumIdPrefix', () => {
  it('strips itunes-rss- prefix correctly', () => {
    expect(stripAlbumIdPrefix('itunes-rss-12345')).toBe('12345')
  })

  it('strips itunes- prefix correctly', () => {
    expect(stripAlbumIdPrefix('itunes-12345')).toBe('12345')
  })

  it('strips deezer- prefix correctly', () => {
    expect(stripAlbumIdPrefix('deezer-67890')).toBe('67890')
  })

  it('strips spotify- prefix correctly', () => {
    expect(stripAlbumIdPrefix('spotify-abcde')).toBe('abcde')
  })

  it('returns clean ID untouched if no prefix present', () => {
    expect(stripAlbumIdPrefix('12345')).toBe('12345')
  })
})

describe('validateAndNormalizeCachedAlbum', () => {
  it('rejects stub albums where total_tracks is missing or 0 even if 1 track is linked', () => {
    const stub = {
      id: '369191597',
      name: 'Midnights',
      artist: 'Taylor Swift',
      total_tracks: 0,
      album_type: 'album',
      tracks: [{ id: 't1', title: 'Anti-Hero', track_number: null }],
    }
    expect(validateAndNormalizeCachedAlbum(stub)).toBeNull()
  })

  it('rejects multi-track albums that only have 1 track in DB', () => {
    const partial = {
      id: '369191597',
      name: 'Midnights',
      artist: 'Taylor Swift',
      total_tracks: 13,
      album_type: 'album',
      tracks: [{ id: 't1', title: 'Anti-Hero', track_number: 3 }],
    }
    expect(validateAndNormalizeCachedAlbum(partial)).toBeNull()
  })

  it('deduplicates multi-user track rows and sorts by disc and track_number', () => {
    const completeWithDupes = {
      id: '100',
      name: 'Mini EP',
      artist: 'Artist',
      total_tracks: 2,
      album_type: 'album',
      cover_url: 'https://example.com/cover.jpg',
      tracks: [
        { id: 'u1', user_id: 'user-123', title: 'Track Two', disc_number: 1, track_number: 2 },
        { id: 's2', user_id: '00000000-0000-4000-a000-000000000001', title: 'Track Two', disc_number: 1, track_number: 2 },
        { id: 's1', user_id: '00000000-0000-4000-a000-000000000001', title: 'Track One', disc_number: 1, track_number: 1 },
        { id: 'u2', user_id: 'user-456', title: 'Track One', disc_number: null, track_number: null },
      ],
    }

    const validated = validateAndNormalizeCachedAlbum(completeWithDupes)
    expect(validated).not.toBeNull()
    expect(validated.tracks).toHaveLength(2)
    expect(validated.tracks[0].id).toBe('s1')
    expect(validated.tracks[1].id).toBe('s2')
  })

  it('accepts valid 1-track singles when album_type is single', () => {
    const singleAlbum = {
      id: '431887357',
      name: 'Making My Way',
      artist: 'Sơn Tùng M-TP',
      total_tracks: 1,
      album_type: 'single',
      tracks: [{ id: 's1', title: 'Making My Way', track_number: 1 }],
    }
    const validated = validateAndNormalizeCachedAlbum(singleAlbum)
    expect(validated).not.toBeNull()
    expect(validated.tracks).toHaveLength(1)
  })
})

describe('sortAlbumTracks', () => {
  it('sorts by disc_number then track_number', () => {
    const sorted = sortAlbumTracks([
      { id: 'c', disc_number: 2, track_number: 1 },
      { id: 'b', disc_number: 1, track_number: 2 },
      { id: 'a', disc_number: 1, track_number: 1 },
    ])
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})
