import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@/types'
import { classifyTrack, inferTrackSource } from '../trackSourceClassifier'
import { inferTrackSource as inferFavoriteSource } from '../favoriteTracks'
import { createBrowserPersistence } from '@/components/player/adapters/browserPersistence'
import { normalizeBattleTrack } from '../songBattleSources'
import { isPreviewUrl } from '../googleDriveUpload'

const base: Track = {
  id: 'saved-track', title: 'Daylight', artist: 'Taylor Swift', duration: 210,
  file_path: '', source: 'spotify', user_id: 'user', created_at: '', cover_url: null,
}
const urls = {
  itunes: 'https://audio-ssl.itunes.apple.com/preview.mp3',
  audius: 'https://discoveryprovider.audius.co/v1/tracks/123/stream',
}
function legacyTrack(source: keyof typeof urls, overrides: Partial<Track> = {}): Track {
  return {
    ...base, id: `${source}-123`, source, file_path: urls[source], audio_url: urls[source],
    [`${source}_id`]: '123', spotify_album_id: 'itunes-rss-456', ...overrides,
  } as unknown as Track
}

afterEach(() => vi.unstubAllGlobals())

describe('retired provider compatibility', () => {
  it('recognizes saved Audius transport signatures on arbitrary discovery hosts', () => {
    const url = 'https://discovery-provider.example/v1/tracks/abc/stream?app_name=MUSICWEB_PRO'
    const track = normalizeBattleTrack({ id: 'saved-uuid', source: 'musicweb', title: 'Song', stream_url: url })
    expect(track?.stream_url).toBeUndefined()
    expect(isPreviewUrl(url)).toBe(true)
  })

  it.each([
    'https://drive.google.com/file/d/1sT-kP6Z9ABCDEF1234567890/view',
    'https://supported-audio.example/song.flac',
  ])('retains a completed local/Drive resolution across subsequent migration: %s', (filePath) => {
    const migrated = inferTrackSource(legacyTrack('itunes'))
    const resolved = { ...migrated, source: 'local', file_path: filePath } as Track
    const normalized = inferTrackSource(resolved)
    expect(normalized.file_path).toBe(filePath)
    expect(normalized.source).toBe('local')
    expect(classifyTrack(normalized).needsCatalogResolution).toBe(false)
    expect(normalized.id).toBe(migrated.id)
  })

  it('clears retired album/link metadata without changing a supported track identity or transport', () => {
    const supported: Track = {
      ...base, id: 'spotify-supported', spotify_id: 'supported-id',
      file_path: 'https://open.spotify.com/track/supported-id',
      spotify_album_id: 'itunes-456', source_url: 'https://music.apple.com/album/old',
    }
    const normalized = inferTrackSource(supported)
    expect(normalized.spotify_album_id).toBeUndefined()
    expect(normalized.source_url).toBeUndefined()
    expect(normalized.spotify_id).toBe(supported.spotify_id)
    expect(normalized.file_path).toBe(supported.file_path)
    expect(supported.spotify_album_id).toBe('itunes-456')
  })

  it.each(['itunes', 'audius'] as const)('never reopens %s transport URLs from a saved battle deck', (source) => {
    const track = normalizeBattleTrack({ ...legacyTrack(source), stream_url: urls[source], preview_url: urls[source] })
    expect(track?.title).toBe(base.title)
    expect(track?.stream_url).toBeUndefined()
    expect(track?.preview_url).toBeNull()
    expect(isPreviewUrl(urls[source])).toBe(true)
  })

  it.each(['itunes', 'audius'] as const)('resolves saved %s metadata through supported providers instead of its transport URL', (source) => {
    const saved = legacyTrack(source)
    const normalized = inferTrackSource(saved)
    expect(normalized.source).toBe('spotify')
    expect(normalized.id).toBe(saved.id)
    expect(normalized.title).toBe(saved.title)
    expect(normalized.file_path).toBe('')
    expect(normalized.audio_url).toBeUndefined()
    expect(normalized.spotify_album_id).toBeUndefined()
    expect(normalized).not.toHaveProperty(`${source}_id`)
    expect(classifyTrack(saved)).toMatchObject({ source: 'spotify', needsCatalogResolution: true, isDirectPlayable: false })
    expect(saved.file_path).toBe(urls[source])
  })

  it('preserves an already resolved native provider ID on an old saved track', () => {
    const normalized = inferTrackSource(legacyTrack('itunes', { nhaccuatui_id: 'native-123' }))
    expect(normalized.source).toBe('nhaccuatui')
    expect(normalized.nhaccuatui_id).toBe('native-123')
    expect(normalized).not.toHaveProperty('itunes_id')
    expect(classifyTrack(normalized).needsCatalogResolution).toBe(false)
  })

  it('normalizes retired favorite metadata instead of returning its old source unchanged', () => {
    const normalized = inferFavoriteSource(legacyTrack('audius'))
    expect(normalized.source).toBe('spotify')
    expect(normalized.audio_url).toBeUndefined()
  })

  it('restores legacy queues without hydrating a retired stream URL', () => {
    const saved = legacyTrack('itunes')
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ track: saved, queue: [saved], currentIndex: 0, currentTime: 9 }), setItem: vi.fn() })
    const persistence = createBrowserPersistence()
    const restored = persistence.restore()
    expect(restored?.track).toMatchObject({ id: saved.id, source: 'spotify', file_path: '' })
    expect(restored?.track?.audio_url).toBeUndefined()
    expect(restored?.queue).toHaveLength(1)
    persistence.dispose()
  })
})
