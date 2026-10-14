import {
  type NhacCuaTuiSearchItem,
  normalizeNhacCuaTuiSearchResponse,
  normalizeNhacCuaTuiSongResponse,
} from './nhaccuatui'

export interface NctCachedSong {
  audioUrl: string
  title?: string
  artist?: string
  duration?: number | null
  coverUrl?: string | null
  lyric?: string | null
  expiresAt: number
}

interface NctCachedSearch {
  items: NhacCuaTuiSearchItem[]
  expiresAt: number
}

const GLOBAL_NCT_CACHE_KEY = Symbol.for('__musicweb_nct_audio_cache__')
const GLOBAL_NCT_INFLIGHT_KEY = Symbol.for('__musicweb_nct_inflight__')
const GLOBAL_NCT_SEARCH_CACHE_KEY = Symbol.for('__musicweb_nct_search_cache__')
const GLOBAL_NCT_SEARCH_INFLIGHT_KEY = Symbol.for('__musicweb_nct_search_inflight__')
const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

export const NCT_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes (signed URLs valid ~15-20 min)
export const NCT_CACHE_MAX_ENTRIES = 2000
export const NCT_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
export const NCT_SEARCH_CACHE_MAX_ENTRIES = 500

type NctCacheMap = Map<string, NctCachedSong>
type NctInFlightMap = Map<string, Promise<NctCachedSong | null>>
type NctSearchCacheMap = Map<string, NctCachedSearch>
type NctSearchInFlightMap = Map<string, Promise<NhacCuaTuiSearchItem[]>>

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

function getSearchCacheMap(): NctSearchCacheMap {
  const g = globalThis as unknown as Record<symbol, NctSearchCacheMap | undefined>
  if (!g[GLOBAL_NCT_SEARCH_CACHE_KEY]) {
    g[GLOBAL_NCT_SEARCH_CACHE_KEY] = new Map<string, NctCachedSearch>()
  }
  return g[GLOBAL_NCT_SEARCH_CACHE_KEY]!
}

function getSearchInFlightMap(): NctSearchInFlightMap {
  const g = globalThis as unknown as Record<symbol, NctSearchInFlightMap | undefined>
  if (!g[GLOBAL_NCT_SEARCH_INFLIGHT_KEY]) {
    g[GLOBAL_NCT_SEARCH_INFLIGHT_KEY] = new Map<string, Promise<NhacCuaTuiSearchItem[]>>()
  }
  return g[GLOBAL_NCT_SEARCH_INFLIGHT_KEY]!
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
  getSearchCacheMap().clear()
  getSearchInFlightMap().clear()
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

function getNctSongApiUrl(id: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = `/api/song/${encodeURIComponent(id)}`
  url.search = ''
  return url
}

function getNctSearchApiUrl(query: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = '/api/search'
  url.search = ''
  url.searchParams.set('q', query)
  return url
}

function getNctSearchCacheKey(query: string): string {
  const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLowerCase()
  const baseUrl = process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL
  return `${baseUrl}:::${normalizedQuery}`
}

export function getNctSearchCache(query: string): NhacCuaTuiSearchItem[] | null {
  const trimmed = query?.trim()
  if (!trimmed) return null
  const cacheKey = getNctSearchCacheKey(trimmed)
  const searchCache = getSearchCacheMap()
  const cached = searchCache.get(cacheKey)
  if (!cached) return null
  if (Date.now() >= cached.expiresAt) {
    searchCache.delete(cacheKey)
    return null
  }
  return cached.items
}

export function setNctSearchCache(query: string, items: NhacCuaTuiSearchItem[]): void {
  const trimmed = query?.trim()
  if (!trimmed || items.length === 0) return
  const cacheKey = getNctSearchCacheKey(trimmed)
  const searchCache = getSearchCacheMap()
  if (searchCache.size >= NCT_SEARCH_CACHE_MAX_ENTRIES && !searchCache.has(cacheKey)) {
    const oldest = searchCache.keys().next().value
    if (oldest !== undefined) searchCache.delete(oldest)
  }
  searchCache.set(cacheKey, {
    items,
    expiresAt: Date.now() + NCT_SEARCH_CACHE_TTL_MS,
  })
}

/**
 * Search NhacCuaTui upstream with in-memory TTL caching and in-flight deduplication.
 */
export async function searchNctCached(
  query: string,
  timeoutMs = 3500,
): Promise<NhacCuaTuiSearchItem[]> {
  const trimmed = query?.trim().replace(/\s+/g, ' ')
  if (!trimmed) return []

  const cached = getNctSearchCache(trimmed)
  if (cached) return cached

  const cacheKey = getNctSearchCacheKey(trimmed)
  const inFlightMap = getSearchInFlightMap()
  const existing = inFlightMap.get(cacheKey)
  if (existing) return existing

  const promise = (async (): Promise<NhacCuaTuiSearchItem[]> => {
    try {
      const res = await fetch(getNctSearchApiUrl(trimmed), {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) return []
      const payload: unknown = await res.json()
      const items = normalizeNhacCuaTuiSearchResponse(payload)
      if (items.length > 0) {
        setNctSearchCache(trimmed, items)
      }
      return items
    } catch {
      return []
    } finally {
      inFlightMap.delete(cacheKey)
    }
  })()

  inFlightMap.set(cacheKey, promise)
  return promise
}

/**
 * Resolve and validate an NCT song's playable audioUrl with bounded timeout,
 * in-flight deduplication, and automatic shared cache warming.
 */
export async function resolveNctSongDetailCached(
  id: string,
  timeoutMs = 2500,
): Promise<NctCachedSong | null> {
  const trimmed = id?.trim()
  if (!trimmed) return null

  const cached = getNctAudioCache(trimmed)
  if (cached?.audioUrl) return cached

  const existing = getNctInFlight(trimmed)
  if (existing) return existing

  const promise = (async (): Promise<NctCachedSong | null> => {
    try {
      const res = await fetch(getNctSongApiUrl(trimmed).toString(), {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) return null
      const payload: unknown = await res.json()
      const song = normalizeNhacCuaTuiSongResponse(payload)
      if (!song?.audioUrl) return null

      setNctAudioCache(trimmed, {
        audioUrl: song.audioUrl,
        title: song.title,
        artist: song.artist,
        duration: song.duration ?? null,
        coverUrl: song.coverUrl || null,
        lyric: song.lyric ?? null,
      })
      return getNctAudioCache(trimmed)
    } catch {
      return null
    } finally {
      deleteNctInFlight(trimmed)
    }
  })()

  setNctInFlight(trimmed, promise)
  return promise
}
