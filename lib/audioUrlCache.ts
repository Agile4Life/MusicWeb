/**
 * In-memory audio URL cache helpers with per-source TTLs.
 *
 * Signed stream URLs (SoundCloud, NhacCuaTui) expire much sooner than stable
 * proxy URLs, so every read path MUST go through `readFreshAudioUrl` instead of
 * reading the Map directly — otherwise an expired URL is replayed and fails.
 */

export interface AudioUrlCacheEntry {
  url: string
  ts: number
}

export const DEFAULT_URL_CACHE_TTL = 30 * 60 * 1000 // stable URLs
export const SOUNDCLOUD_URL_CACHE_TTL = 10 * 60 * 1000 // signed tokens last ~15-20 min
export const NCT_URL_CACHE_TTL = 5 * 60 * 1000

interface TtlTrackLike {
  id?: string | null
  source?: string | null
  soundcloud_id?: string | number | null
  file_path?: string | null
  source_url?: string | null
}

export function isSoundCloudTrack(track: TtlTrackLike): boolean {
  return Boolean(
    track.source === 'soundcloud' ||
      track.soundcloud_id ||
      track.id?.startsWith('sc-') ||
      (track.file_path && track.file_path.includes('soundcloud.com')) ||
      (track.source_url && track.source_url.includes('soundcloud.com'))
  )
}

export function getAudioUrlCacheTtl(track: TtlTrackLike): number {
  if (track.source === 'nhaccuatui') return NCT_URL_CACHE_TTL
  if (isSoundCloudTrack(track)) return SOUNDCLOUD_URL_CACHE_TTL
  return DEFAULT_URL_CACHE_TTL
}

/**
 * Returns a cached URL only if it is still fresh for the track's source.
 * Expired entries are evicted. Fresh hits are re-inserted to refresh LRU order.
 */
export function readFreshAudioUrl(
  cache: Map<string, AudioUrlCacheEntry>,
  track: TtlTrackLike,
  now: number = Date.now()
): string | null {
  const id = track.id
  if (!id) return null
  const entry = cache.get(id)
  if (!entry) return null
  if (now - entry.ts >= getAudioUrlCacheTtl(track)) {
    cache.delete(id)
    return null
  }
  cache.delete(id)
  cache.set(id, entry)
  return entry.url
}
