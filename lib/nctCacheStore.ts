export interface NctCachedSong {
  audioUrl: string
  title?: string
  artist?: string
  duration?: number | null
  coverUrl?: string | null
  expiresAt: number
}

const GLOBAL_NCT_CACHE_KEY = Symbol.for('__musicweb_nct_audio_cache__')
const GLOBAL_NCT_INFLIGHT_KEY = Symbol.for('__musicweb_nct_inflight__')

export const NCT_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes (signed URLs valid ~15-20 min)
export const NCT_CACHE_MAX_ENTRIES = 2000

type NctCacheMap = Map<string, NctCachedSong>
type NctInFlightMap = Map<string, Promise<NctCachedSong | null>>

function getCacheMap(): NctCacheMap {
  const g = globalThis as unknown as Record<symbol, NctCacheMap | undefined>
  if (!g[GLOBAL_NCT_CACHE_KEY]) {
    g[GLOBAL_NCT_CACHE_KEY] = new Map<string, NctCachedSong>()
  }
  return g[GLOBAL_NCT_CACHE_KEY]!
}

function getInFlightMap(): NctInFlightMap {
  const g = globalThis as unknown as Record<symbol, NctInFlightMap | undefined>
  if (!g[GLOBAL_NCT_INFLIGHT_KEY]) {
    g[GLOBAL_NCT_INFLIGHT_KEY] = new Map<string, Promise<NctCachedSong | null>>()
  }
  return g[GLOBAL_NCT_INFLIGHT_KEY]!
}

export function getNctAudioCache(id: string): NctCachedSong | null {
  const trimmed = id?.trim()
  if (!trimmed) return null
  const cache = getCacheMap()
  const entry = cache.get(trimmed)
  if (!entry) return null
  if (Date.now() >= entry.expiresAt) {
    cache.delete(trimmed)
    return null
  }
  return entry
}

export function setNctAudioCache(
  id: string,
  song: Omit<NctCachedSong, 'expiresAt'> & { expiresAt?: number }
): void {
  const trimmed = id?.trim()
  if (!trimmed || !song.audioUrl) return
  const cache = getCacheMap()
  if (cache.size >= NCT_CACHE_MAX_ENTRIES && !cache.has(trimmed)) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(trimmed, {
    ...song,
    expiresAt: song.expiresAt ?? Date.now() + NCT_CACHE_TTL_MS,
  })
}

export function deleteNctAudioCache(id: string): void {
  const trimmed = id?.trim()
  if (!trimmed) return
  getCacheMap().delete(trimmed)
  getInFlightMap().delete(trimmed)
}

export function clearAllNctAudioCache(): void {
  getCacheMap().clear()
  getInFlightMap().clear()
}

export function getNctInFlight(id: string): Promise<NctCachedSong | null> | undefined {
  const trimmed = id?.trim()
  if (!trimmed) return undefined
  return getInFlightMap().get(trimmed)
}

export function setNctInFlight(id: string, promise: Promise<NctCachedSong | null>): void {
  const trimmed = id?.trim()
  if (!trimmed) return
  getInFlightMap().set(trimmed, promise)
}

export function deleteNctInFlight(id: string): void {
  const trimmed = id?.trim()
  if (!trimmed) return
  getInFlightMap().delete(trimmed)
}
