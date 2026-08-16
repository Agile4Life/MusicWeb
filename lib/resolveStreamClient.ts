import { findMemoryDriveTrack } from './driveTracksMap'

export interface ResolvedStreamResult {
  source: 'youtube' | 'nhaccuatui' | 'drive' | 'soundcloud'
  id: string
  title?: string
  artist?: string
  duration?: number
  coverUrl?: string | null
}

interface CacheEntry {
  result: ResolvedStreamResult | null  // null = miss
  expiresAt: number
}

const clientCache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<ResolvedStreamResult | null>>()
const CLIENT_CACHE_TTL = 5 * 60 * 1000 // 5 min client-side
const MISS_CACHE_TTL = 60 * 1000       // 1 min for misses
const MAX_CLIENT_CACHE = 300

function makeClientKey(title: string, artist: string, duration?: number): string {
  return `${title.trim().toLowerCase()}___${(artist || '').trim().toLowerCase()}___${duration || 0}`
}

/**
 * Resolve a track's playback source via the /api/resolve-stream endpoint.
 * Results are cached client-side (5 min) and deduplicated in-flight.
 */
export async function resolveStreamCached(
  track: { title: string; artist?: string | null; duration?: number | null; album?: string | null },
): Promise<ResolvedStreamResult | null> {
  const title = track.title?.trim()
  if (!title) return null

  const artist = track.artist || ''
  const duration = track.duration || undefined
  const key = makeClientKey(title, artist, duration)

  // ⚡ Instant Client-side Static Drive Check (0ms, zero network fetch)
  const memDrive = findMemoryDriveTrack(title, artist)
  if (memDrive) {
    const directResult: ResolvedStreamResult = {
      source: 'drive',
      id: memDrive.file_path,
      title: memDrive.title,
      artist: memDrive.artist,
      duration: memDrive.duration,
      coverUrl: memDrive.cover_url || null,
    }
    clientCache.set(key, { result: directResult, expiresAt: Date.now() + CLIENT_CACHE_TTL })
    return directResult
  }

  // Client-side cache check
  const cached = clientCache.get(key)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result
  }

  // In-flight dedup
  if (inFlight.has(key)) {
    return inFlight.get(key)!
  }

  const promise = (async (): Promise<ResolvedStreamResult | null> => {
    try {
      const params = new URLSearchParams({ title })
      if (artist) params.set('artist', artist)
      if (duration) params.set('duration', String(Math.round(duration)))

      const res = await fetch(`/api/resolve-stream?${params.toString()}`)
      if (!res.ok) return null

      const data = await res.json()
      if (data.miss) {
        // Cache the miss too — prevents search storms for unresolvable tracks
        if (clientCache.size >= MAX_CLIENT_CACHE) {
          const oldest = clientCache.keys().next().value
          if (oldest !== undefined) clientCache.delete(oldest)
        }
        clientCache.set(key, { result: null, expiresAt: Date.now() + MISS_CACHE_TTL })
        return null
      }

      const result: ResolvedStreamResult = {
        source: data.source,
        id: data.id || data.resolvedId || data.resolved_id,
        title: data.title,
        artist: data.artist,
        duration: data.duration,
        coverUrl: data.coverUrl,
      }

      if (clientCache.size >= MAX_CLIENT_CACHE) {
        const oldest = clientCache.keys().next().value
        if (oldest !== undefined) clientCache.delete(oldest)
      }
      clientCache.set(key, { result, expiresAt: Date.now() + CLIENT_CACHE_TTL })

      return result
    } catch {
      return null
    } finally {
      inFlight.delete(key)
    }
  })()

  inFlight.set(key, promise)
  return promise
}

/**
 * Invalidate a cached resolution (called on playback error).
 * Evicts from client cache and tells the server to re-resolve.
 */
export async function invalidateStreamResolution(
  track: { title: string; artist?: string | null; duration?: number | null },
): Promise<void> {
  const title = track.title?.trim()
  if (!title) return
  const artist = track.artist || ''
  const duration = track.duration || undefined
  const key = makeClientKey(title, artist, duration)

  // Evict from client cache
  clientCache.delete(key)

  // Tell server to invalidate — fire and forget
  try {
    const params = new URLSearchParams({ title, invalidate: '1' })
    if (artist) params.set('artist', artist)
    if (duration) params.set('duration', String(Math.round(duration)))
    fetch(`/api/resolve-stream?${params.toString()}`).catch(() => {})
  } catch {}
}
