export interface LrclibResponse {
  id: number
  trackName: string
  artistName: string
  albumName?: string
  duration: number
  instrumental: boolean
  plainLyrics: string | null
  syncedLyrics: string | null
}

const lyricsCache = new Map<string, LrclibResponse | null>()
const lyricsInFlight = new Map<string, Promise<LrclibResponse | null>>()

/**
 * Fetch lyrics from LRCLIB API (lrclib.net) with in-memory caching & deduplication
 * First attempts exact match via /api/get, then falls back to /api/search
 */
export async function fetchLyricsFromLrclib({
  title,
  artist,
  duration,
}: {
  title: string
  artist?: string | null
  duration?: number | null
}): Promise<LrclibResponse | null> {
  const cleanTitle = cleanTrackTitle(title)
  const cleanArtist = artist ? cleanArtistName(artist) : ''
  const durRound = duration && duration > 0 ? Math.round(duration) : 0
  const cacheKey = `${cleanTitle.toLowerCase()}__${cleanArtist.toLowerCase()}__${durRound}`

  // 1. Check in-memory LRU cache
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!
  }

  // 2. Check in-flight deduplication Map
  if (lyricsInFlight.has(cacheKey)) {
    return lyricsInFlight.get(cacheKey)!
  }

  const fetchPromise = (async (): Promise<LrclibResponse | null> => {
    try {
      // 1. Try exact match using /api/get if artist is present
      if (cleanArtist) {
        try {
          const params = new URLSearchParams({
            track_name: cleanTitle,
            artist_name: cleanArtist,
          })
          if (durRound > 0) {
            params.append('duration', durRound.toString())
          }

          const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
            headers: {
              'Lrclib-Client': 'MusicWeb/1.0.0 (https://github.com/MusicWeb)',
            },
          })

          if (res.ok) {
            const data: LrclibResponse = await res.json()
            if (data.syncedLyrics || data.plainLyrics) {
              lyricsCache.set(cacheKey, data)
              return data
            }
          }
        } catch (e) {
          console.warn('LRCLIB exact get error:', e)
        }
      }

      // 2. Fallback to /api/search
      try {
        const query = cleanArtist ? `${cleanTitle} ${cleanArtist}` : cleanTitle
        const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`

        const res = await fetch(searchUrl, {
          headers: {
            'Lrclib-Client': 'MusicWeb/1.0.0 (https://github.com/MusicWeb)',
          },
        })

        if (res.ok) {
          const results: LrclibResponse[] = await res.json()
          if (Array.isArray(results) && results.length > 0) {
            const withSynced = results.find((r) => r.syncedLyrics && r.syncedLyrics.trim().length > 0)
            if (withSynced) {
              lyricsCache.set(cacheKey, withSynced)
              return withSynced
            }

            const withPlain = results.find((r) => r.plainLyrics && r.plainLyrics.trim().length > 0)
            if (withPlain) {
              lyricsCache.set(cacheKey, withPlain)
              return withPlain
            }

            lyricsCache.set(cacheKey, results[0])
            return results[0]
          }
        }
      } catch (e) {
        console.warn('LRCLIB search error:', e)
      }

      lyricsCache.set(cacheKey, null)
      return null
    } finally {
      lyricsInFlight.delete(cacheKey)
    }
  })()

  lyricsInFlight.set(cacheKey, fetchPromise)
  return fetchPromise
}

/**
 * Clean common suffixes like ".mp3", ".flac", "(Official Music Video)", "LIVE", etc.
 */
function cleanTrackTitle(title: string): string {
  let cleaned = title.replace(/\.(mp3|wav|flac|m4a|aac|ogg|wma)$/i, '')
  cleaned = cleaned.replace(/[\(\[\{](official|music video|mv|audio|lyric video|live|hd|4k)[\)\]\}]/gi, '')
  cleaned = cleaned.replace(/-\s*(official|mv|audio|video).*/gi, '')
  return cleaned.trim()
}

function cleanArtistName(artist: string): string {
  let cleaned = artist.replace(/[\(\[\{](official|vevo)[\)\]\}]/gi, '')
  cleaned = cleaned.replace(/-\s*topic/gi, '')
  return cleaned.trim()
}
