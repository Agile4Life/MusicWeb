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
  // Require space around hyphen (-) so hyphenated names like "M-TP" or "T-Pain" aren't split
  if (title.includes(' - ') || title.includes(' – ') || title.includes(' — ') || title.includes(' – ') || title.includes(' -')) {
    const parts = title.split(/\s+[\-\–\—]\s+|\s*[\–\—]\s*/)
    if (parts.length >= 2) {
      if (!artist || artist === 'Nghệ sĩ chưa xác định' || artist === 'YouTube Artist' || artist === 'iTunes Artist') {
        artist = parts[0].trim()
        title = parts.slice(1).join(' - ').trim()
      } else {
        const part0Norm = parts[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
        const artistNorm = artist.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
        if (part0Norm.includes(artistNorm) || artistNorm.includes(part0Norm)) {
          title = parts.slice(1).join(' - ').trim()
        }
      }
    }
  }

  // Clean noise terms from title
  title = title
    .replace(/[\(\[\{].*?[\)\]\}]/g, ' ') // Remove anything inside parens e.g. (Official MV), [Lyrics]
    .replace(/\b(official|music video|mv|audio|lyric video|lyrics|live|hd|4k|remix|reverb|slowed|speed up|sped up|lofi|1hour|1 hour|hot tiktok)\b/gi, ' ')
    .replace(/\b(?:feat|ft)\.?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Clean artist: take primary artist before ft./feat./,/slash, keeping hyphens/dots intact
  artist = artist
    .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
    .replace(/\b(official|vevo|topic)\b/gi, ' ')
    .split(/\s*(?:ft\.?|feat\.?|\/|\\|,|&)\s*/i)[0]
    .replace(/[\_\,\:\;]/g, ' ')
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

    const res = await fetch(`${process.env.NEXT_PUBLIC_LRCLIB_URL || 'https://lrclib.net'}/api/get?${params.toString()}`, {
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
  } catch {
    // ignore
  }
  return null
}

export function isInstrumentalOrBeatTrack(title: string): boolean {
  const t = (title || '').toLowerCase()
  return (
    t.includes('instrumental') ||
    t.includes('beat') ||
    t.includes('karaoke') ||
    t.includes('nhạc không lời') ||
    t.includes('nhac khong loi') ||
    t.includes('backing track') ||
    t.includes('piano cover') ||
    t.includes('guitar cover') ||
    t.includes('lofi beat') ||
    t.includes('slowed reverb instrumental') ||
    t.includes('nonstop') ||
    t.includes('vinahouse remix nonstop')
  )
}

export function calculateTitleSimilarity(a: string, b: string): number {
  const normA = (a || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const normB = (b || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (normA === normB) return 1.0
  if (!normA || !normB) return 0.0

  const wordsA = new Set(normA.split(' ').filter((w) => w.length > 1))
  const wordsB = new Set(normB.split(' ').filter((w) => w.length > 1))
  if (wordsA.size === 0 || wordsB.size === 0) return 0.0

  let intersection = 0
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++
  }
  const jaccard = intersection / (wordsA.size + wordsB.size - intersection)

  const lenRatio = Math.min(normA.length, normB.length) / Math.max(normA.length, normB.length)
  if ((normA.includes(normB) || normB.includes(normA)) && lenRatio >= 0.75) {
    return Math.max(jaccard, 0.85)
  }

  return jaccard
}

async function trySearchApi(
  query: string,
  targetTitle?: string,
  targetArtist?: string,
  targetAlbum?: string,
  targetDuration?: number
): Promise<LrclibResponse | null> {
  try {
    const searchUrl = `${process.env.NEXT_PUBLIC_LRCLIB_URL || 'https://lrclib.net'}/api/search?q=${encodeURIComponent(query)}`
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
            // 1. Strict Title Similarity Validation (Prevent matching completely different songs)
            if (targetTitle && targetTitle.trim().length > 0) {
              const sim = calculateTitleSimilarity(targetTitle, r.trackName)
              if (sim < 0.70) return false
            }

            // 2. Strict Artist Validation
            if (targetArtist && targetArtist.trim().length > 0) {
              const candidateArtistNorm = (r.artistName || '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim()
              const targetArtistNorm = targetArtist
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .trim()

              const isGenericArtist =
                targetArtistNorm === 'various artists' ||
                targetArtistNorm === 'soundcloud' ||
                targetArtistNorm === 'youtube artist' ||
                targetArtistNorm === 'itunes artist'

              if (!isGenericArtist) {
                if (targetArtistNorm.length <= 3) {
                  if (candidateArtistNorm !== targetArtistNorm) return false
                } else {
                  const isArtistMatched =
                    candidateArtistNorm.includes(targetArtistNorm) ||
                    targetArtistNorm.includes(candidateArtistNorm)
                  if (!isArtistMatched) return false
                }
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
        const strictCandidates = matchCandidates(25)
        const validCandidates = strictCandidates.length > 0 ? strictCandidates : matchCandidates(45)

        if (validCandidates.length > 0) {
          const withSynced = validCandidates.find((r) => r.syncedLyrics && r.syncedLyrics.trim().length > 0)
          if (withSynced) return withSynced

          const withPlain = validCandidates.find((r) => r.plainLyrics && r.plainLyrics.trim().length > 0)
          if (withPlain) return withPlain

          return validCandidates[0]
        }
      }
    }
  } catch {
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
  isSoundCloud = false,
}: {
  title: string
  artist?: string | null
  album?: string | null
  duration?: number | null
  youtubeId?: string | null
  isSoundCloud?: boolean
}): Promise<LrclibResponse | null> {
  const { cleanTitle, cleanArtist, cleanAlbum } = extractCleanTitleAndArtist(title, artist, album)

  // Instrumental / Beat tracks have no lyrics — prevent incorrect matching
  if (isInstrumentalOrBeatTrack(title) || isInstrumentalOrBeatTrack(cleanTitle)) {
    return null
  }

  const durRound = duration && duration > 0 ? Math.round(duration) : 0
  const cacheKey = `${cleanTitle.toLowerCase()}__${cleanArtist.toLowerCase()}__${(cleanAlbum || '').toLowerCase()}__${durRound}__${isSoundCloud ? 'sc' : 'std'}`

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
      if (cleanAlbum && !isSoundCloud) {
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
      if (cleanArtist && !isSoundCloud) {
        const data3 = await trySearchApi(`${cleanTitle} ${cleanArtist}`, cleanTitle, cleanArtist, undefined, durRound)
        if (data3?.syncedLyrics) {
          lyricsCache.set(cacheKey, data3)
          return data3
        }
        if (data3 && !fallback) fallback = data3
      }

      // Step F: YouTube Music Lyrics Fallback if LRCLIB returned no lyrics (Do NOT run for SoundCloud tracks)
      if (!isSoundCloud && (!fallback || (!fallback.syncedLyrics && !fallback.plainLyrics))) {
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
