import { describe, it, expect } from 'vitest'
import { stripAlbumIdPrefix, sortAlbumTracks, validateAndNormalizeCachedAlbum } from '../albumId'
import { resolveTrackSpotifyAlbumId } from '../spotify'
import { deduplicateQueueTracks, mergeTrackMetadata } from '../utils'
import { Track } from '@/types'
import { clearAlbumCache, getCachedResolvedAlbum, isKnownBadFallback, setCachedResolvedAlbum } from '../albumCache'

describe('stripAlbumIdPrefix', () => {
  it('preserves retired iTunes RSS IDs so they cannot become Deezer IDs', () => {
    expect(stripAlbumIdPrefix('itunes-rss-12345')).toBe('itunes-rss-12345')
  })

  it('preserves retired iTunes IDs so they cannot become Deezer IDs', () => {
    expect(stripAlbumIdPrefix('itunes-12345')).toBe('itunes-12345')
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
  it.each(['itunes', 'audius'])('normalizes retired %s track transports inside a supported cached album', (source) => {
    const cached = {
      id: 'spotify-current', name: 'Studio Record', artist: 'Artist', total_tracks: 2, album_type: 'album',
      tracks: [
        { id: 'saved-2', title: 'Second Song', source: 'spotify', file_path: 'spotify:valid-track', track_number: 2 },
        {
          id: 'saved-1', title: 'First Song', source, track_number: 1, spotify_id: '123',
          file_path: source === 'itunes' ? 'https://audio-ssl.itunes.apple.com/preview.m4a' : 'https://discovery.audius.co/v1/tracks/123/stream',
          audio_url: `${source}:123`, source_url: `${source}:123`, itunes_id: '123', audius_id: '123',
        },
      ],
    }

    const validated = validateAndNormalizeCachedAlbum(cached)
    expect(validated).toMatchObject({ id: 'spotify-current', total_tracks: 2 })
    expect(validated.tracks.map((track: Track) => track.id)).toEqual(['saved-1', 'saved-2'])
    expect(validated.tracks[0]).toMatchObject({
      title: 'First Song', source: 'spotify', file_path: '', album: 'Studio Record', spotify_album_id: 'spotify-current',
    })
    for (const key of ['audio_url', 'source_url', 'itunes_id', 'audius_id', 'spotify_id']) {
      expect(validated.tracks[0]).not.toHaveProperty(key)
    }
    expect(validated.tracks[1].file_path).toBe('spotify:valid-track')
    expect(cached.tracks[1].source).toBe(source)
    expect(cached.tracks[1].audio_url).toBe(`${source}:123`)
  })

  it.each(['itunes-12345', 'itunes-rss-12345', 'audius-12345'])('rejects retired cached album %s', (id) => {
    expect(validateAndNormalizeCachedAlbum({
      id, name: 'Saved Album', artist: 'Artist', total_tracks: 1, album_type: 'single',
      tracks: [{ id: 'saved-track', title: 'Song', track_number: 1 }],
    })).toBeNull()
  })

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

describe('retired client album resolutions', () => {
  it.each(['itunes-12345', 'itunes-rss-12345', 'audius-12345', 'audius:12345'])('rejects retired fallback %s', (albumId) => {
    clearAlbumCache()
    expect(isKnownBadFallback(albumId)).toBe(true)
    setCachedResolvedAlbum('Song', 'Artist', { albumId, albumName: 'Saved Album' })
    expect(getCachedResolvedAlbum('Song', 'Artist')).toBeUndefined()
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

describe('resolveTrackSpotifyAlbumId', () => {
  it('does not lock spotify_album_id for 1-track self-titled singles', () => {
    expect(
      resolveTrackSpotifyAlbumId(
        { id: 'single-123', name: 'Fortnight', album_type: 'single', total_tracks: 1 },
        'Fortnight'
      )
    ).toBeUndefined()
  })

  it('preserves spotify_album_id for title tracks on multi-track studio albums', () => {
    expect(
      resolveTrackSpotifyAlbumId(
        { id: 'album-lover', name: 'Lover', album_type: 'album', total_tracks: 18 },
        'Lover'
      )
    ).toBe('album-lover')
  })

  it('preserves spotify_album_id when album name is distinct from track title', () => {
    expect(
      resolveTrackSpotifyAlbumId(
        { id: 'album-midnights', name: 'Midnights' },
        'Anti-Hero'
      )
    ).toBe('album-midnights')
  })
})

describe('deduplicateQueueTracks album metadata enrichment', () => {
  it('enriches surviving NhacCuaTui track with album and spotify_album_id from duplicate Spotify track', () => {
    const nctTrack: Track = {
      id: 'nct-1',
      user_id: 'system',
      title: 'Chúng Ta Của Tương Lai',
      artist: 'Sơn Tùng M-TP',
      album: null,
      duration: 240,
      file_path: 'nct:1',
      cover_url: null,
      created_at: '2026-01-01T00:00:00Z',
      source: 'nhaccuatui',
      nhaccuatui_id: 'abc123',
    }
    const spotifyTrack: Track = {
      id: 'spotify-2',
      user_id: 'spotify',
      title: 'Chúng Ta Của Tương Lai',
      artist: 'Sơn Tùng M-TP',
      album: 'Sky Tour',
      spotify_album_id: 'sp-alb-999',
      duration: 240,
      file_path: 'https://open.spotify.com/track/2',
      cover_url: 'https://i.scdn.co/image/cover.jpg',
      created_at: '2026-01-01T00:00:00Z',
      source: 'spotify',
      spotify_id: '2',
    }

    const deduped = deduplicateQueueTracks([nctTrack, spotifyTrack])
    expect(deduped).toHaveLength(1)
    expect(deduped[0].id).toBe('nct-1')
    expect(deduped[0].source).toBe('nhaccuatui')
    expect(deduped[0].album).toBe('Sky Tour')
    expect(deduped[0].spotify_album_id).toBe('sp-alb-999')
    expect(deduped[0].cover_url).toBe('https://i.scdn.co/image/cover.jpg')
  })

  it('merges real album over self-titled single album name via mergeTrackMetadata', () => {
    const winner: Track = {
      id: '1',
      user_id: 'u',
      title: 'Anti-Hero',
      artist: 'Taylor Swift',
      album: 'Anti-Hero',
      duration: 200,
      file_path: 'a',
      cover_url: 'https://example.com/1.jpg',
      created_at: '2026-01-01',
    }
    const loser: Track = {
      id: '2',
      user_id: 'u',
      title: 'Anti-Hero',
      artist: 'Taylor Swift',
      album: 'Midnights',
      spotify_album_id: 'alb-midnights',
      duration: 200,
      file_path: 'b',
      cover_url: 'https://example.com/2.jpg',
      created_at: '2026-01-01',
    }
    const merged = mergeTrackMetadata(winner, loser)
    expect(merged.album).toBe('Midnights')
    expect(merged.spotify_album_id).toBe('alb-midnights')
  })
})
