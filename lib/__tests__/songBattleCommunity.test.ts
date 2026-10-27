import { describe, expect, it } from 'vitest'
import { isDeckId, validateCommunityDeckInput } from '../songBattleCommunity'

const track = (id: string, extra = {}) => ({ spotify_id: id, title: 'Song', artist_name: 'Artist', ...extra })
const input = (tracks = [track('abc'), track('def')]) => ({ name: ' Deck ', description: '', creator_name: 'Alias', tracks })

describe('community deck publication', () => {
  it('publishes album audio and keeps it playable after normalizing the public snapshot', () => {
    const result = validateCommunityDeckInput(input([
      { id: 'deezer-123', source: 'deezer', title: 'Album song', file_path: 'https://audio.example/song.m4a', user_id: 'private' } as never,
      { id: 'deezer-456', source: 'spotify', spotify_id: '456', title: 'Deezer song', file_path: 'https://audio.example/preview.mp3' } as never,
    ]))
    expect(result.tracks.map(t => t.source)).toEqual(['musicweb', 'musicweb'])
    expect(result.tracks[0]).toMatchObject({ stream_url: 'https://audio.example/song.m4a', preview_url: null })
    expect(result.tracks[0]).not.toHaveProperty('user_id')
    expect(validateCommunityDeckInput({ ...input(), tracks: result.tracks }).tracks).toEqual(result.tracks)
  })
  it.each(['javascript:alert(1)', '//evil.test/audio', '/api/private?token=secret', 'https://user:password@example.com/audio'])('rejects unsafe MusicWeb stream %s', stream_url => {
    expect(() => validateCommunityDeckInput(input([
      { id: 'local-123', source: 'musicweb', title: 'Song', stream_url } as never, track('abc'),
    ]))).toThrow()
  })
  it('canonicalizes source identities and removes private fields, spoofed IDs and previews', () => {
    const result = validateCommunityDeckInput(input([
      track('abc', { id: 'collision', preview_url: 'https://secret.test/token', user_id: 'secret', youtube_id: 'forged' }),
      track('def', { id: 'collision' }), track('abc'),
    ]))
    expect(result.name).toBe('Deck')
    expect(result.tracks.map(t => t.id)).toEqual(['spotify-abc', 'spotify-def'])
    expect(result.tracks[0]).toMatchObject({ artist: 'Artist', preview_url: null, source_url: 'https://open.spotify.com/track/abc' })
    expect(result.tracks[0]).not.toHaveProperty('user_id')
    expect(result.tracks[0]).not.toHaveProperty('youtube_id')
  })
  it.each(['bad/id', 'x'.repeat(65), ''])('rejects invalid source ID %s', id => {
    expect(() => validateCommunityDeckInput(input([track(id), track('def')]))).toThrow()
  })
  it('rejects duplicate-only decks and oversized metadata and payloads', () => {
    expect(() => validateCommunityDeckInput(input([track('abc'), track('abc')]))).toThrow()
    expect(() => validateCommunityDeckInput({ ...input(), name: 'x'.repeat(121) })).toThrow()
    expect(() => validateCommunityDeckInput({ ...input(), extra: 'x'.repeat(1048576) })).toThrow()
  })
  it('derives official source links and keeps identities separate across providers', () => {
    const result = validateCommunityDeckInput(input([
      { source: 'youtube', youtube_id: 'abc', title: 'Video', source_url: 'https://evil.test' } as never,
      { source: 'soundcloud', soundcloud_id: '123', title: 'Audio', source_url: 'https://evil.test' } as never,
    ]))
    expect(result.tracks.map(t => t.source_url)).toEqual(['https://www.youtube.com/watch?v=abc', null])
  })
  it('preserves official SoundCloud track permalinks and rejects external or non-track URLs', () => {
    const valid = validateCommunityDeckInput(input([
      { source: 'soundcloud', soundcloud_id: '123', title: 'Audio', soundcloud_permalink_url: 'https://soundcloud.com/artist/track-name' } as never,
      { source: 'soundcloud', soundcloud_id: '456', title: 'Other', source_url: 'https://www.soundcloud.com/other/another-track' } as never,
    ]))
    expect(valid.tracks.map(t => t.source_url)).toEqual(['https://soundcloud.com/artist/track-name', 'https://www.soundcloud.com/other/another-track'])
    for (const url of ['https://evil.test/artist/track', 'http://soundcloud.com/artist/track', 'https://soundcloud.com/artist/sets/playlist', 'https://soundcloud.com/tracks/123']) {
      const result = validateCommunityDeckInput(input([
        { source: 'soundcloud', soundcloud_id: '123', title: 'Audio', source_url: url } as never,
        track('abc'),
      ]))
      expect(result.tracks[0].source_url).toBeNull()
    }
  })
  it('validates deck UUIDs', () => {
    expect(isDeckId('123e4567-e89b-42d3-a456-426614174000')).toBe(true)
    expect(isDeckId('abc')).toBe(false)
  })
})
