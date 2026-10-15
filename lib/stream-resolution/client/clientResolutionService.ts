import type { ClientResolutionDeps, ClientResolutionService, ResolutionTrack, ResolvedStreamResult } from './contracts'

interface CacheEntry {
  result: ResolvedStreamResult | null // null = miss
  expiresAt: number
  generation: number
}

interface InFlightEntry {
  promise: Promise<ResolvedStreamResult | null>
  generation: number
}

export function createClientResolutionService(deps: ClientResolutionDeps): ClientResolutionService {
  let disposed = false
  const clientCache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, InFlightEntry>()
  const invalidationGeneration = new Map<string, number>()
  const forceRefreshGeneration = new Map<string, number>()
  const CLIENT_CACHE_TTL = 5 * 60 * 1000 // 5 min client-side
  const MISS_CACHE_TTL = 60 * 1000 // 1 min for misses
  const MAX_CLIENT_CACHE = 300

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
    if (disposed || generation !== getGeneration(key)) return

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
  async function resolve(
    track: ResolutionTrack,
  ): Promise<ResolvedStreamResult | null> {
    if (disposed) return null
    const title = track.title?.trim()
    if (!title) return null

    const artist = track.artist || ''
    const duration = track.duration || undefined
    const album = track.album || undefined
    const key = makeClientKey(title, artist, duration, album)
    const generation = getGeneration(key)
    const forceRefresh = forceRefreshGeneration.get(key) === generation

    // ⚡ Instant Client-side Static Drive Check (0ms, zero network fetch)
    const memDrive = deps.findMemoryDriveTrack(title, artist, duration)
    if (memDrive && !forceRefresh) {
      const directResult: ResolvedStreamResult = {
        source: 'drive',
        id: memDrive.file_path,
        title: memDrive.title,
        artist: memDrive.artist,
        duration: memDrive.duration,
        coverUrl: memDrive.cover_url || null,
      }
      cacheResult(key, directResult, deps.now() + CLIENT_CACHE_TTL, generation)
      return directResult
    }

    // Check localStorage persistence (cross-session)
    const persisted = deps.persistence.get(key)
    if (persisted && !forceRefresh) {
      if (persisted.source === 'none' || !persisted.resolvedId) {
        return null
      }
      const cachedResult: ResolvedStreamResult = { source: persisted.source as ResolvedStreamResult['source'], id: persisted.resolvedId }
      cacheResult(key, cachedResult, deps.now() + CLIENT_CACHE_TTL, generation)
      return cachedResult
    }

    // Client-side cache check
    const cached = clientCache.get(key)
    if (
      cached &&
      cached.generation === generation &&
      deps.now() < cached.expiresAt &&
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
        if (album) params.set('album', album)
        if (forceRefresh) params.set('invalidate', '1')

        // Explicit memory/disk caches own TTL and invalidation. Browser caching
        // could otherwise reuse an older normal or invalidate=1 response.
        const res = await deps.fetch(`/api/resolve-stream?${params.toString()}`, { cache: 'no-store' })
        if (!res.ok) return null

        const data = await res.json()
        // Memory and disk share the same ownership boundary. Discard responses
        // that crossed invalidation before saving either a hit or a miss.
        if (disposed || generation !== getGeneration(key)) return null
        if (data.miss) {
          cacheResult(key, null, deps.now() + MISS_CACHE_TTL, generation)
          // Persist miss too (short TTL) so we don't re-resolve failed tracks repeatedly
          deps.persistence.save(key, { source: 'none', resolvedId: '', ttl: MISS_CACHE_TTL })
          if (forceRefreshGeneration.get(key) === generation) {
            forceRefreshGeneration.delete(key)
          }
          return null
        }

        const resultId = data.id || data.resolvedId || data.resolved_id
        const result: ResolvedStreamResult = {
          source: data.source,
          id: resultId,
          title: data.title,
          artist: data.artist,
          duration: data.duration,
          coverUrl: data.coverUrl,
          streamUrl: data.streamUrl || (data.source === 'youtube' ? null : deps.buildStreamUrl(data.source, resultId)),
        }

        cacheResult(key, result, deps.now() + CLIENT_CACHE_TTL, generation)
        // Persist to localStorage for cross-session restore
        deps.persistence.save(key, { source: result.source, resolvedId: result.id, ttl: 30 * 60 * 1000 })
        if (forceRefreshGeneration.get(key) === generation) {
          forceRefreshGeneration.delete(key)
        }

        return result
      } catch {
        return null
      }
    })()

    inFlight.set(key, { promise, generation })
    try {
      return await promise
    } finally {
      // Registration precedes cleanup even when an injected fetch throws
      // synchronously. An older owner must never remove its replacement.
      const current = inFlight.get(key)
      if (current?.promise === promise) {
        inFlight.delete(key)
      }
    }
  }

  /**
   * Invalidate a cached resolution (called on playback error).
   * The next resolve for this key is forced to refresh on the server.
   */
  async function invalidate(
    track: ResolutionTrack,
  ): Promise<void> {
    if (disposed) return
    const title = track.title?.trim()
    if (!title) return
    const artist = track.artist || ''
    const duration = track.duration || undefined
    const album = track.album || undefined
    const key = makeClientKey(title, artist, duration, album)

    const generation = advanceGeneration(key)
    clientCache.delete(key)
    inFlight.delete(key)
    deps.persistence.delete(key)
    forceRefreshGeneration.set(key, generation)

    // Best-effort eager server invalidation. The next resolve also sends
    // invalidate=1, so correctness does not depend on this request winning a race.
    try {
      const params = new URLSearchParams({ title, invalidate: '1' })
      if (artist) params.set('artist', artist)
      if (duration) params.set('duration', String(Math.round(duration)))
      if (album) params.set('album', album)
      await deps.fetch(`/api/resolve-stream?${params.toString()}`, { cache: 'no-store' })
    } catch {
      // The forced-refresh marker above keeps the next resolve correct.
    }
  }

  return {
    resolve,
    invalidate,
    dispose() {
      if (disposed) return
      disposed = true
      clientCache.clear()
      inFlight.clear()
      invalidationGeneration.clear()
      forceRefreshGeneration.clear()
    },
  }
}
