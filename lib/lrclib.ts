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
  targetTitle?: string,
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
            // 1. Strict Title Validation: avoid matching "Chúng ta không thuộc về nhau" for "Không thuộc về"
            if (targetTitle && targetTitle.trim().length > 0) {
              const candidateTitleNorm = (r.trackName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').trim()
              const targetTitleNorm = targetTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').trim()

              if (candidateTitleNorm !== targetTitleNorm) {
                const lenRatio = Math.min(candidateTitleNorm.length, targetTitleNorm.length) / Math.max(candidateTitleNorm.length, targetTitleNorm.length)
                if (lenRatio < 0.75) return false
                if (!candidateTitleNorm.includes(targetTitleNorm) && !targetTitleNorm.includes(candidateTitleNorm)) return false
              }
            }

            // 2. Strict Artist Validation
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
            } else {
              // If targetArtist is NOT provided, require exact title match to avoid cross-artist mismatch
              if (targetTitle) {
                const candidateTitleNorm = (r.trackName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').trim()
                const targetTitleNorm = targetTitle.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').trim()
                if (candidateTitleNorm !== targetTitleNorm) return false
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
  youtubeId,
}: {
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | null
  youtubeId?: string | null
}): Promise<LrclibResponse | null> {
  const { cleanTitle, cleanArtist, cleanAlbum } = extractCleanTitleAndArtist(title, artist, album)
  const durRound = duration && duration > 0 ? Math.round(duration) : 0
  const cacheKey = `${cleanTitle.toLowerCase()}__${cleanArtist.toLowerCase()}__${(cleanAlbum || '').toLowerCase()}__${durRound}`

  // 1. Check in-memory LRU cache
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey)!
  }

  // 2. Check in-flight requests (deduplication)
  if (lyricsInFlight.has(cacheKey)) {
    return lyricsInFlight.get(cacheKey)!
  }

  const fetchPromise = (async (): Promise<LrclibResponse | null> => {
    try {
      let fallback: LrclibResponse | null = null

      // Step A: If cleanAlbum exists, try with album first
      if (cleanAlbum) {
        const data0 = await tryGetApi(cleanTitle, cleanArtist, cleanAlbum, durRound)
        if (data0?.syncedLyrics) {
          lyricsCache.set(cacheKey, data0)
          return data0
        }
        if (data0) fallback = data0
      }

      // Step B: Direct lookup without album
      const data1 = await tryGetApi(cleanTitle, cleanArtist, undefined, durRound)
      if (data1?.syncedLyrics) {
        lyricsCache.set(cacheKey, data1)
        return data1
      }
      if (data1 && !fallback) fallback = data1

      // Step C: Try search API with title + artist
      const data2 = await trySearchApi(cleanTitle, cleanTitle, cleanArtist, cleanAlbum, durRound)
      if (data2?.syncedLyrics) {
        lyricsCache.set(cacheKey, data2)
        return data2
      }
      if (data2 && !fallback) fallback = data2

      // Step D: Try search API with title + artist (without album restriction)
      if (cleanArtist) {
        const data3 = await trySearchApi(`${cleanTitle} ${cleanArtist}`, cleanTitle, cleanArtist, undefined, durRound)
        if (data3?.syncedLyrics) {
          lyricsCache.set(cacheKey, data3)
          return data3
        }
        if (data3 && !fallback) fallback = data3
      }

      // Step F: YouTube Music Lyrics Fallback if LRCLIB returned no lyrics or no synced lyrics
      if (!fallback || (!fallback.syncedLyrics && !fallback.plainLyrics)) {
        try {
          const ytParams = new URLSearchParams()
          if (youtubeId) ytParams.append('videoId', youtubeId)
          if (cleanTitle) ytParams.append('title', cleanTitle)
          if (cleanArtist) ytParams.append('artist', cleanArtist)

          const ytRes = await fetch(`/api/youtube/lyrics?${ytParams.toString()}`)
          if (ytRes.ok) {
            const ytData = await ytRes.json()
            if (ytData && ytData.plainLyrics) {
              const ytResponse: LrclibResponse = {
                id: 999999,
                trackName: ytData.trackName || title,
                artistName: ytData.artistName || artist || 'YouTube Music',
                duration: durRound,
                instrumental: false,
                plainLyrics: ytData.plainLyrics,
                syncedLyrics: null,
              }
              lyricsCache.set(cacheKey, ytResponse)
              return ytResponse
            }
          }
        } catch (ytErr) {
          console.warn('YouTube Music lyrics fallback warning:', ytErr)
        }
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
