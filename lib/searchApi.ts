import { Track } from '@/types'

export interface GlobalSearchTracks {
  local: Track[]
  youtube: Track[]
  audius: Track[]
  itunes: Track[]
  spotify: Track[]
}

interface CacheItem {
  data: GlobalSearchTracks
  timestamp: number
}

const searchCache = new Map<string, CacheItem>()
const inFlightRequests = new Map<string, Promise<GlobalSearchTracks>>()
const CACHE_TTL = 3 * 60 * 1000 // 3 minutes

export async function fetchUnifiedSearch(
  query: string,
  source = 'all',
  isTrending = false
): Promise<GlobalSearchTracks> {
  const trimmed = query.trim().toLowerCase()
  const cacheKey = isTrending ? `trending_${source}` : `${trimmed}_${source}`

  if (!isTrending && !trimmed) {
    return { local: [], youtube: [], audius: [], itunes: [], spotify: [] }
  }

  // 1. Check in-memory LRU cache first
  const cached = searchCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  // 2. Check in-flight request to deduplicate concurrent duplicate fetches
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)!
  }

  // 3. Initiate single HTTP fetch
  const fetchPromise = (async (): Promise<GlobalSearchTracks> => {
    try {
      const url = isTrending
        ? `/api/search?trending=true&source=${encodeURIComponent(source)}`
        : `/api/search?q=${encodeURIComponent(query.trim())}&source=${encodeURIComponent(source)}`

      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Search API returned status ${res.status}`)
      }

      const data = await res.json()
      const result: GlobalSearchTracks = {
        local: Array.isArray(data.local) ? data.local : [],
        youtube: Array.isArray(data.youtube) ? data.youtube : [],
        audius: Array.isArray(data.audius) ? data.audius : [],
        itunes: Array.isArray(data.itunes) ? data.itunes : [],
        spotify: Array.isArray(data.spotify) ? data.spotify : [],
      }

      // Evict oldest if cache exceeds 150 items
      if (searchCache.size > 150) {
        const oldestKey = searchCache.keys().next().value
        if (oldestKey) searchCache.delete(oldestKey)
      }
      searchCache.set(cacheKey, { data: result, timestamp: Date.now() })

      return result
    } catch (err) {
      console.warn('Unified Search Fetch Error:', err)
      return { local: [], youtube: [], audius: [], itunes: [], spotify: [] }
    } finally {
      inFlightRequests.delete(cacheKey)
    }
  })()

  inFlightRequests.set(cacheKey, fetchPromise)
  return fetchPromise
}
