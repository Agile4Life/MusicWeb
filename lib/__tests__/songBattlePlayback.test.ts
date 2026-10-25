import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BattleView } from '@/app/spotify-lab/BattleView'
import { normalizeBattleTrack } from '../songBattleSources'
import { resolveBattleTrackPlayback } from '../songBattlePlayback'
import type { Battle } from '../songBattle'
import type { BattleTrack } from '../songBattleSources'

afterEach(() => vi.restoreAllMocks())

describe('saved battle playback migration', () => {
  it('keeps a metadata-resolution marker through repeated normalization of saved retired rows', () => {
    const track = normalizeBattleTrack({
      id: 'saved-track', source: 'itunes', title: 'Saved Song', artist: 'Saved Artist',
      stream_url: 'https://audio-ssl.itunes.apple.com/preview.m4a',
    })!
    expect(track).toMatchObject({ id: 'saved-track', title: 'Saved Song', source: 'musicweb', needs_metadata_resolution: true })
    expect(normalizeBattleTrack(track)).toMatchObject({ needs_metadata_resolution: true })
  })

  it('keeps supported transports on a saved retired identity without requesting metadata resolution', () => {
    const track = normalizeBattleTrack({
      id: 'itunes-saved-track', source: 'musicweb', title: 'Saved Song', artist: 'Saved Artist',
      stream_url: '/api/drive-stream?fileId=supported-file',
    })!
    expect(track.stream_url).toBe('/api/drive-stream?fileId=supported-file')
    expect(track).not.toHaveProperty('needs_metadata_resolution', true)
  })

  it('marks a canonical UUID row whose only retired identifier is its old discovery stream', () => {
    expect(normalizeBattleTrack({
      id: '123e4567-e89b-42d3-a456-426614174000', source: 'musicweb', title: 'Saved Song',
      stream_url: 'https://discovery-provider.example/v1/tracks/abc/stream?app_name=MUSICWEB_PRO',
    })).toMatchObject({ source: 'musicweb', stream_url: undefined, needs_metadata_resolution: true })
  })

  it.each([
    ['youtube', 'supported-video', { source: 'youtube', youtube_id: 'supported-video' }],
    ['soundcloud', '123', { source: 'soundcloud', soundcloud_id: '123' }],
    ['nhaccuatui', 'supported-song', { source: 'musicweb', nhaccuatui_id: 'supported-song', stream_url: '/api/nhaccuatui/stream?id=supported-song' }],
    ['drive', 'supported-file', { source: 'musicweb', stream_url: '/api/drive-stream?fileId=supported-file' }],
  ])('replaces retired playback with supported %s while preserving saved metadata', async (source, id, expected) => {
    const track = normalizeBattleTrack({ id: 'saved-track', source: 'itunes', title: `Resolve ${source}`, artist: 'Saved Artist', album: 'Saved Album' })!
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ source, id, title: 'Provider title', artist: 'Provider artist' }))
    const playable = await resolveBattleTrackPlayback(track)
    expect(playable).toMatchObject({ ...expected, id: track.id, title: track.title, artist: track.artist, album: track.album, needs_metadata_resolution: undefined })
    expect(track).toMatchObject({ source: 'musicweb', stream_url: undefined, needs_metadata_resolution: true })
    expect(request).toHaveBeenCalledTimes(1)
    expect(String(request.mock.calls[0][0])).toMatch(/^\/api\/resolve-stream\?/)
    expect(await resolveBattleTrackPlayback(playable)).toBe(playable)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('uses the existing shared resolver cache across preview and battle resolution', async () => {
    const track = normalizeBattleTrack({ id: 'itunes-cache', source: 'itunes', title: 'Battle Cached Match', artist: 'Saved Artist' })!
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ source: 'drive', id: 'cached-file' }))
    const [preview, candidate] = await Promise.all([resolveBattleTrackPlayback(track), resolveBattleTrackPlayback(track)])
    expect(preview.stream_url).toBe('/api/drive-stream?fileId=cached-file')
    expect(candidate.stream_url).toBe(preview.stream_url)
    expect((await resolveBattleTrackPlayback(track)).stream_url).toBe(preview.stream_url)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not look up supported tracks or reuse removed provider responses', async () => {
    const supported = [
      { spotify_id: 'supported', title: 'Spotify' },
      { youtube_id: 'supported', source: 'youtube', title: 'YouTube' },
      { soundcloud_id: '123', source: 'soundcloud', title: 'SoundCloud' },
      { id: 'local', source: 'musicweb', title: 'Native audio', stream_url: '/api/drive-stream?fileId=existing' },
    ].map(track => normalizeBattleTrack(track)!)
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ source: 'audius', id: 'removed-id' }))
    for (const track of supported) expect(await resolveBattleTrackPlayback(track)).toBe(track)
    expect(request).not.toHaveBeenCalled()
    const retired = normalizeBattleTrack({ id: 'audius-rejected', source: 'audius', title: 'Rejected Old Cache' })!
    expect(await resolveBattleTrackPlayback(retired)).toBe(retired)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('renders supported native audio and YouTube players for resolved saved candidates', async () => {
    const tracks = ['Audio', 'Video'].map(title => normalizeBattleTrack({ id: `itunes-${title}`, source: 'itunes', title: `Battle Render ${title}`, artist: 'Saved Artist' })!)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => Response.json(String(input).includes('Audio')
      ? { source: 'drive', id: 'render-file' }
      : { source: 'youtube', id: 'render-video' }))
    const playable = await Promise.all(tracks.map(resolveBattleTrackPlayback))
    const battle: Battle<BattleTrack> = { entrants: tracks, round: playable, winners: [], match: 0, history: [], champion: null }
    const rendered = renderToStaticMarkup(createElement(BattleView, {
      battle, onPreview() {}, onChoose() {}, onUndo() {}, onReplay() {}, onExit() {},
    }))
    expect(rendered).toContain('<audio')
    expect(rendered).toContain('/api/drive-stream?fileId=render-file')
    expect(rendered).toContain('https://www.youtube.com/embed/render-video')
    expect(rendered).toContain('Battle Render Audio')
    expect(rendered).toContain('Battle Render Video')
  })
})
