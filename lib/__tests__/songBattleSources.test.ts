import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchBattleTracks, playlistEndpoint, normalizeBattleTrack, mergeBattleTracks } from '../songBattleSources'

afterEach(() => vi.restoreAllMocks())

describe('battle playlist sources', () => {
  it('routes public playlists to the existing APIs', () => {
    expect(playlistEndpoint('https://open.spotify.com/playlist/abc123?si=test')).toBe('/api/spotify/playlist?id=abc123&type=tracks')
    expect(playlistEndpoint('https://www.youtube.com/watch?v=video&list=PL123')).toBe('/api/youtube/playlist?id=PL123')
    expect(playlistEndpoint('https://music.youtube.com/playlist?list=PL123')).toBe('/api/youtube/playlist?id=PL123')
    expect(playlistEndpoint('https://soundcloud.com/artist/sets/songs')).toContain('/api/soundcloud/playlists?url=')
  })

  it.each(['https://evil.test/playlist/abc', 'https://open.spotify.com.evil.test/playlist/abc', 'https://open.spotify.com/track/abc', 'javascript:alert(1)', 'https://youtube.com/playlist', 'https://soundcloud.com/artist/song'])('rejects unsupported or non-playlist link %s', value => {
    expect(() => playlistEndpoint(value)).toThrow()
  })

  it('normalizes Spotify playlist items without a generic id and keeps other source identities', () => {
    expect(normalizeBattleTrack({ spotify_id: 'abc', title: 'Song', artist: 'Artist' })).toMatchObject({ id: 'spotify-abc', source: 'spotify', spotify_id: 'abc' })
    expect(normalizeBattleTrack({ id: 'yt-abc', youtube_id: 'abc', source: 'youtube', title: 'Song', artist_name: 'Artist' })).toMatchObject({ id: 'yt-abc', source: 'youtube', artist: 'Artist' })
    expect(normalizeBattleTrack({ id: 'sc-12', source: 'soundcloud', soundcloud_id: 12, title: 'Song', source_url: 'https://soundcloud.com/a/b' })).toMatchObject({ source: 'soundcloud', soundcloud_id: '12' })
    expect(normalizeBattleTrack({ title: 'Unplayable' })).toBeNull()
  })

  it('deduplicates by source identity and leaves the original selection untouched', () => {
    const song = normalizeBattleTrack({ spotify_id: 'abc', title: 'Song' })!
    const other = normalizeBattleTrack({ youtube_id: 'abc', source: 'youtube', title: 'Other' })!
    expect(mergeBattleTracks([song], [{ ...song, id: 'other-id' }, other])).toEqual([song, other])
    expect(mergeBattleTracks([], [song, song])).toHaveLength(1)
  })

  it('uses the selected provider identity when imported rows contain multiple IDs', () => {
    const first = normalizeBattleTrack({ id: 'db-1', source: 'youtube', spotify_id: 'same', youtube_id: 'one', title: 'One' })!
    const second = normalizeBattleTrack({ id: 'db-2', source: 'youtube', spotify_id: 'same', youtube_id: 'two', title: 'Two' })!
    expect(mergeBattleTracks([], [first, second])).toHaveLength(2)
    expect(mergeBattleTracks([first], [{ ...second, id: first.id }])).toHaveLength(1)
  })

  it('bounds a stalled request and reports a retryable timeout', async () => {
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal)
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason))
    }))
    const result = fetchBattleTracks('/api/spotify/playlist?id=test', new AbortController().signal)
    const assertion = expect(result).rejects.toThrow('phản hồi quá lâu')
    deadline.abort(new DOMException('Timed out', 'TimeoutError'))
    await assertion
    expect(timeout).toHaveBeenCalledWith(25000)
  })

  it('surfaces source errors and accepts both existing response formats', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    fetch.mockResolvedValueOnce(Response.json({ error: 'Playlist riêng tư' }, { status: 404 }))
    await expect(fetchBattleTracks('/test', new AbortController().signal)).rejects.toThrow('Playlist riêng tư')
    const raw = { spotify_id: 'abc', title: 'Song' }
    fetch.mockResolvedValueOnce(Response.json([raw, raw])).mockResolvedValueOnce(Response.json({ tracks: [raw] }))
    expect(await fetchBattleTracks('/test', new AbortController().signal)).toHaveLength(1)
    expect(await fetchBattleTracks('/test', new AbortController().signal)).toHaveLength(1)
  })
})
