import { findMemoryDriveTrack } from './driveTracksMap'
import { saveTrackResolution, getTrackResolution } from './playbackPersistence'

export interface ResolvedStreamResult {
  source: 'youtube' | 'nhaccuatui' | 'drive' | 'soundcloud'
  id: string
  title?: string
  artist?: string
  duration?: number
  coverUrl?: string | null
}

interface CacheEntry {
  result: ResolvedStreamResult | null // null = miss
  expiresAt: number
  generation: number
}

interface InFlightEntry {
  promise: Promise<ResolvedStreamResult | null>
  generation: number
}

const clientCache = new Map<string, CacheEntry>()
const inFlight = new Map<string, InFlightEntry>()
const invalidationGeneration = new Map<string, number>()
const forceRefreshGeneration = new Map<string, number>()
const CLIENT_CACHE_TTL = 5 * 60 * 1000 // 5 min client-side
const MISS_CACHE_TTL = 60 * 1000 // 1 min for misses
const MAX_CLIENT_CACHE = 300

// Cleanup orphaned in-flight entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of inFlight.entries()) {
    const currentGen = invalidationGeneration.get(key) || 0
    // Clean up entries from OLD generations (orphaned by invalidation)
    if (entry.generation < currentGen) {
      inFlight.delete(key)
    }
  }
}, 30000) // Run every 30 seconds

function makeClientKey(title: string, artist: string, duration?: number, album?: string | null): string {
  return `${title.trim().toLowerCase()}___${(artist || '').trim().toLowerCase()}___${duration || 0}___${(album || '').trim().toLowerCase()}`
}

function getGeneration(key: string): number {
  return invalidationGeneration.get(key) || 0
}

function advanceGeneration(key: string): number {
  const generation = getGeneration(key) + 1
  invalidationGeneration.set(key, generation)
  return generation
}

function cacheResult(
  key: string,
  result: ResolvedStreamResult | null,
  expiresAt: number,
  generation: number,
): void {
  // An older request must never repopulate the cache after invalidation.
  if (generation !== getGeneration(key)) return

  if (clientCache.size >= MAX_CLIENT_CACHE && !clientCache.has(key)) {
    const oldestKey = clientCache.keys().next().value
    if (oldestKey !== undefined) clientCache.delete(oldestKey)
  }

  clientCache.set(key, { result, expiresAt, generation })
}

/**
 * Resolve a track's playback source via the /api/resolve-stream endpoint.
 * Results are cached client-side (5 min) and deduplicated in-flight.
 *
 * Invalidation uses a per-key generation so an older in-flight resolution
 * cannot write stale data back into the cache or satisfy a newer request.
 */
export async function resolveStreamCached(
  track: { title: string; artist?: string | null; duration?: number | null; album?: string | null },
): Promise<ResolvedStreamResult | null> {
  const title = track.title?.trim()
  if (!title) return null

  const artist = track.artist || ''
  const duration = track.duration || undefined
  const album = track.album || undefined
  const key = makeClientKey(title, artist, duration, album)
  const generation = getGeneration(key)
  const forceRefresh = forceRefreshGeneration.get(key) === generation

  // ⚡ Instant Client-side Static Drive Check (0ms, zero network fetch)
  const memDrive = findMemoryDriveTrack(title, artist)
  if (memDrive && !forceRefresh) {
    const directResult: ResolvedStreamResult = {
      source: 'drive',
      id: memDrive.file_path,
      title: memDrive.title,
      artist: memDrive.artist,
      duration: memDrive.duration,
      coverUrl: memDrive.cover_url || null,
    }
    cacheResult(key, directResult, Date.now() + CLIENT_CACHE_TTL, generation)
    return directResult
  }

  // Check localStorage persistence (cross-session)
  const persisted = getTrackResolution(key)
  if (persisted && !forceRefresh) {
    const cachedResult: ResolvedStreamResult = { source: persisted.source as ResolvedStreamResult['source'], id: persisted.resolvedId }
    cacheResult(key, cachedResult, Date.now() + CLIENT_CACHE_TTL, generation)
    return cachedResult
  }

  // Client-side cache check
  const cached = clientCache.get(key)
  if (
    cached &&
    cached.generation === generation &&
    Date.now() < cached.expiresAt &&
    !forceRefresh
  ) {
    return cached.result
  }

  // In-flight dedup only within the current invalidation generation.
  const activeInFlight = inFlight.get(key)
  if (activeInFlight && activeInFlight.generation === generation) {
    return activeInFlight.promise
  }

  const promise = (async (): Promise<ResolvedStreamResult | null> => {
    try {
      const params = new URLSearchParams({ title })
      if (artist) params.set('artist', artist)
      if (duration) params.set('duration', String(Math.round(duration)))
      if (forceRefresh) params.set('invalidate', '1')

      const res = await fetch(`/api/resolve-stream?${params.toString()}`)
      if (!res.ok) return null

      const data = await res.json()
      if (data.miss) {
        cacheResult(key, null, Date.now() + MISS_CACHE_TTL, generation)
        // Persist miss too (short TTL) so we don't re-resolve failed tracks repeatedly
        saveTrackResolution(key, { source: 'none', resolvedId: '', ttl: MISS_CACHE_TTL })
        if (forceRefreshGeneration.get(key) === generation) {
          forceRefreshGeneration.delete(key)
        }
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

      cacheResult(key, result, Date.now() + CLIENT_CACHE_TTL, generation)
      // Persist to localStorage for cross-session restore
      saveTrackResolution(key, { source: result.source, resolvedId: result.id, ttl: 30 * 60 * 1000 })
      if (forceRefreshGeneration.get(key) === generation) {
        forceRefreshGeneration.delete(key)
      }

      return result
    } catch {
      return null
    } finally {
      // Always clean up the in-flight entry, even if generation changed during execution.
      // This prevents orphaned entries when invalidation happens mid-resolution.
      const current = inFlight.get(key)
      if (current?.generation === generation) {
        inFlight.delete(key)
      }
    }
  })()

  inFlight.set(key, { promise, generation })
  return promise
}

/**
 * Invalidate a cached resolution (called on playback error).
 * The next resolve for this key is forced to refresh on the server.
 */
export async function invalidateStreamResolution(
  track: { title: string; artist?: string | null; duration?: number | null; album?: string | null },
): Promise<void> {
  const title = track.title?.trim()
  if (!title) return
  const artist = track.artist || ''
  const duration = track.duration || undefined
  const album = track.album || undefined
  const key = makeClientKey(title, artist, duration, album)

  const generation = advanceGeneration(key)
  clientCache.delete(key)
  forceRefreshGeneration.set(key, generation)

  // Best-effort eager server invalidation. The next resolve also sends
  // invalidate=1, so correctness does not depend on this request winning a race.
  try {
    const params = new URLSearchParams({ title, invalidate: '1' })
    if (artist) params.set('artist', artist)
    if (duration) params.set('duration', String(Math.round(duration)))
    await fetch(`/api/resolve-stream?${params.toString()}`)
  } catch {
    // The forced-refresh marker above keeps the next resolve correct.
  }
}
