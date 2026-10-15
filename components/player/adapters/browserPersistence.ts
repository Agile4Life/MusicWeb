import type { Track } from '@/types'
import type { PlaybackPersistencePort } from '@/lib/playback/ports'
import { inferTrackSource } from '@/lib/trackSourceClassifier'
import { deduplicateQueueTracks } from '@/lib/utils'
import { PlaybackPersistenceScheduler, STORAGE_KEY_PLAYER_STATE } from '../playbackPersistenceScheduler'

const REPEAT_KEY = 'musicweb_repeat_mode'
const sources = new Set(['local', 'youtube', 'audius', 'itunes', 'spotify', 'nhaccuatui', 'deezer', 'soundcloud'])
function restoreTrack(value: unknown): Track | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !row.id) return null
  for (const key of ['title', 'artist', 'cover_url', 'file_path', 'drive_file_id', 'nhaccuatui_id', 'youtube_id', 'audio_url', 'spotify_id', 'album']) {
    if (row[key] != null && typeof row[key] !== 'string') return null
  }
  if (row.duration != null && (typeof row.duration !== 'number' || !Number.isFinite(row.duration))) return null
  if (row.source != null && (typeof row.source !== 'string' || !sources.has(row.source))) return null
  if (row.is_favorite != null && typeof row.is_favorite !== 'boolean') return null
  for (const key of ['itunes_id', 'soundcloud_id']) {
    if (row[key] != null && typeof row[key] !== 'string' && typeof row[key] !== 'number') return null
  }
  // Only validated persisted fields are hydrated; missing full Track fields are defaults.
  const minimal = row as Partial<Track>
  return inferTrackSource({
    id: row.id, user_id: '', created_at: '', title: minimal.title ?? '', artist: minimal.artist,
    cover_url: minimal.cover_url ?? null, duration: minimal.duration ?? 0, file_path: minimal.file_path ?? '',
    source: minimal.source, drive_file_id: minimal.drive_file_id, nhaccuatui_id: minimal.nhaccuatui_id,
    youtube_id: minimal.youtube_id, soundcloud_id: minimal.soundcloud_id, audio_url: minimal.audio_url,
    spotify_id: minimal.spotify_id, itunes_id: minimal.itunes_id, album: minimal.album, is_favorite: minimal.is_favorite,
  })
}
const finite = (value: unknown, fallback: number): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function createBrowserPersistence(): PlaybackPersistencePort {
  const scheduler = new PlaybackPersistenceScheduler()
  let disposed = false
  return {
    restore() {
      if (disposed) return null
      try {
        const raw = localStorage.getItem(STORAGE_KEY_PLAYER_STATE)
        if (!raw) return null
        const saved = JSON.parse(raw)
        if (!saved || typeof saved !== 'object') return null
        const track = restoreTrack(saved.track)
        if (!track) return null
        const queue = Array.isArray(saved.queue) ? saved.queue.map(restoreTrack).filter((track: Track | null): track is Track => track !== null) : []
        return { track, currentTime: finite(saved.currentTime, 0), queue: deduplicateQueueTracks(queue.length ? queue : [track]),
          currentIndex: finite(saved.currentIndex, 0), volume: finite(saved.volume, .8) }
      } catch { return null }
    },
    save(payload, immediate = false) {
      if (disposed) return
      if (immediate) scheduler.saveImmediate(payload)
      else scheduler.scheduleDebounced(payload)
    },
    updateTime(time) { if (!disposed) scheduler.updatePendingTime(time) },
    flush() { if (!disposed) scheduler.flushPending() },
    getRepeat() {
      if (disposed) return 'off'
      try {
        const repeat = localStorage.getItem(REPEAT_KEY)
        return repeat === 'all' || repeat === 'one' ? repeat : 'off'
      } catch { return 'off' }
    },
    setRepeat(value) { if (!disposed) { try { localStorage.setItem(REPEAT_KEY, value) } catch {} } },
    dispose() { if (!disposed) { disposed = true; scheduler.dispose() } },
  }
}
