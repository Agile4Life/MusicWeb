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
 * Smart Title, Artist & Album Normalizer for LRCLIB API lookup
 */
export function extractCleanTitleAndArtist(
  rawTitle: string,
  rawArtist?: string | null,
  rawAlbum?: string | null
): { cleanTitle: string; cleanArtist: string; cleanAlbum?: string } {
  let title = (rawTitle || '').replace(/\.(mp3|wav|flac|m4a|aac|ogg|wma)$/i, '').trim()
  let artist = (rawArtist || '').trim()
  let album = (rawAlbum || '').trim()

  const GENERIC_ALBUMS = [
    'google drive',
    'google drive sync',
    'youtube music',
    'apple music top hits',
    'itunes global',
    'spotify album',
  ]

  if (album && GENERIC_ALBUMS.includes(album.toLowerCase())) {
    album = ''
  }

  // If title is in format "Artist - Title", split it if artist is missing or matches
  if (title.includes(' - ') || title.includes(' – ') || title.includes(' — ')) {
    const parts = title.split(/\s*[\-\–\—]\s*/)
    if (parts.length >= 2) {
      if (!artist || artist === 'Nghệ sĩ chưa xác định' || artist === 'YouTube Artist' || artist === 'iTunes Artist') {
        artist = parts[0]
        title = parts.slice(1).join(' - ')
      } else {
        const part0Norm = parts[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        const artistNorm = artist.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        if (part0Norm.includes(artistNorm) || artistNorm.includes(part0Norm)) {
          title = parts.slice(1).join(' - ')
        }
      }
    }
  }

  // Clean noise terms from title
  title = title
    .replace(/[\(\[\{].*?[\)\]\}]/g, ' ') // Remove anything inside parens e.g. (Official MV), [Lyrics]
    .replace(/\b(official|music video|mv|audio|lyric video|lyrics|live|hd|4k|remix|reverb|slowed|speed up|sped up|lofi|1hour|1 hour|hot tiktok)\b/gi, ' ')
    .replace(/feat\.?|ft\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Clean artist: take primary artist before ft./feat./,/slash
  artist = artist
    .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
    .replace(/\b(official|vevo|topic)\b/gi, ' ')
    .split(/\s*(?:ft\.?|feat\.?|\/|\\|,|&)\s*/i)[0]
    .replace(/[\-\_\,\.\:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  album = album
    .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
    .replace(/\b(official|edition|deluxe|version)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return { cleanTitle: title || rawTitle, cleanArtist: artist, cleanAlbum: album || undefined }
}

async function tryGetApi(
  trackName: string,
  artistName: string,
  albumName?: string,
  duration = 0
): Promise<LrclibResponse | null> {
  try {
    const params = new URLSearchParams({
      track_name: trackName,
      artist_name: artistName,
    })
    if (albumName) {
      params.append('album_name', albumName)
    }
    if (duration > 0) {
      params.append('duration', duration.toString())
    }

    const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: {
        'Lrclib-Client': 'MusicWeb/1.0.0 (https://github.com/MusicWeb)',
      },
    })

    if (res.ok) {
      const data: LrclibResponse = await res.json()
      if (data.syncedLyrics || data.plainLyrics) {
        return data
      }
    }
  } catch (e) {
    // ignore
  }
  return null
}

async function trySearchApi(
  query: string,
  targetArtist?: string,
  targetAlbum?: string,
  targetDuration?: number
): Promise<LrclibResponse | null> {
  try {
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`
    const res = await fetch(searchUrl, {
      headers: {
        'Lrclib-Client': 'MusicWeb/1.0.0 (https://github.com/MusicWeb)',
      },
    })

    if (res.ok) {
      const results: LrclibResponse[] = await res.json()
      if (Array.isArray(results) && results.length > 0) {
        const matchCandidates = (maxDurDiff: number, requireAlbum = false) =>
          results.filter((r) => {
            if (targetArtist && targetArtist.trim().length > 0) {
              const candidateArtistNorm = (r.artistName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
              const targetArtistNorm = targetArtist.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
              if (targetArtistNorm.length <= 2) {
                if (candidateArtistNorm !== targetArtistNorm) return false
              } else {
                const isArtistMatched =
                  candidateArtistNorm.includes(targetArtistNorm) ||
                  targetArtistNorm.includes(candidateArtistNorm)
                if (!isArtistMatched) return false
              }
            }
            if (requireAlbum && targetAlbum && targetAlbum.trim().length > 0) {
              const candidateAlbNorm = (r.albumName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
              const targetAlbNorm = targetAlbum.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
              if (!candidateAlbNorm.includes(targetAlbNorm) && !targetAlbNorm.includes(candidateAlbNorm)) {
                return false
              }
            }
            if (targetDuration && targetDuration > 0 && r.duration > 0) {
              const durationDiff = Math.abs(r.duration - targetDuration)
              if (durationDiff > maxDurDiff) return false
            }
            return true
          })

        // 1. Try strict album match first if targetAlbum provided
        if (targetAlbum) {
          const albumCandidates = matchCandidates(25, true)
          if (albumCandidates.length > 0) {
            const synced = albumCandidates.find((r) => r.syncedLyrics && r.syncedLyrics.trim().length > 0)
            if (synced) return synced
            const plain = albumCandidates.find((r) => r.plainLyrics && r.plainLyrics.trim().length > 0)
            if (plain) return plain
          }
        }

        // 2. Try duration tolerance (25s then 45s)
        const validCandidates = matchCandidates(25).length > 0 ? matchCandidates(25) : matchCandidates(45)

        if (validCandidates.length > 0) {
          const withSynced = validCandidates.find((r) => r.syncedLyrics && r.syncedLyrics.trim().length > 0)
          if (withSynced) return withSynced

          const withPlain = validCandidates.find((r) => r.plainLyrics && r.plainLyrics.trim().length > 0)
          if (withPlain) return withPlain

          return validCandidates[0]
        }
      }
    }
  } catch (e) {
    // ignore
  }
  return null
}

/**
 * Fetch lyrics from LRCLIB API (lrclib.net) with in-memory caching & album verification
 * Prioritizes exact Album matching + syncedLyrics before fallback
 */
export async function fetchLyricsFromLrclib({
  title,
  artist,
  album,
  duration,
}: {
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | null
}): Promise<LrclibResponse | null> {
  const { cleanTitle, cleanArtist, cleanAlbum } = extractCleanTitleAndArtist(title, artist, album)
  const durRound = duration && duration > 0 ? Math.round(duration) : 0
  const cacheKey = `${cleanTitle.toLowerCase()}__${cleanArtist.toLowerCase()}__${(cleanAlbum || '').toLowerCase()}__${durRound}`

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
      let fallback: LrclibResponse | null = null

      // Stage 1: Try exact /api/get with Album verification
      if (cleanArtist && cleanAlbum) {
        const data0 = await tryGetApi(cleanTitle, cleanArtist, cleanAlbum, durRound)
        if (data0?.syncedLyrics) {
          lyricsCache.set(cacheKey, data0)
          return data0
        }
        if (data0?.plainLyrics && !fallback) fallback = data0
      }

      if (cleanArtist) {
        // Stage 2: Try /api/get with cleanTitle & cleanArtist & duration
        const data1 = await tryGetApi(cleanTitle, cleanArtist, undefined, durRound)
        if (data1?.syncedLyrics) {
          lyricsCache.set(cacheKey, data1)
          return data1
        }
        if (data1?.plainLyrics && !fallback) fallback = data1

        // Stage 3: Try /api/get WITHOUT duration parameter
        const data2 = await tryGetApi(cleanTitle, cleanArtist, undefined, 0)
        if (data2?.syncedLyrics) {
          lyricsCache.set(cacheKey, data2)
          return data2
        }
        if (data2?.plainLyrics && !fallback) fallback = data2
      }

      // Stage 4: Try /api/search with q = "cleanTitle cleanArtist cleanAlbum"
      const query1 = cleanAlbum
        ? `${cleanTitle} ${cleanArtist} ${cleanAlbum}`
        : cleanArtist
        ? `${cleanTitle} ${cleanArtist}`
        : cleanTitle
      const data3 = await trySearchApi(query1, cleanArtist, cleanAlbum, durRound)
      if (data3?.syncedLyrics) {
        lyricsCache.set(cacheKey, data3)
        return data3
      }
      if (data3 && !fallback) fallback = data3

      // Stage 5: Try /api/search with q = "cleanTitle" (Title only)
      if (cleanArtist) {
        const data4 = await trySearchApi(cleanTitle, cleanArtist, cleanAlbum, durRound)
        if (data4?.syncedLyrics) {
          lyricsCache.set(cacheKey, data4)
          return data4
        }
        if (data4 && !fallback) fallback = data4
      }

      lyricsCache.set(cacheKey, fallback)
      return fallback
    } finally {
      lyricsInFlight.delete(cacheKey)
    }
  })()

  lyricsInFlight.set(cacheKey, fetchPromise)
  return fetchPromise
}
