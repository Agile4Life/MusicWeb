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

/**
 * Clean common suffixes like ".mp3", ".flac", "(Official Music Video)", "LIVE", etc.
 */
function cleanTrackTitle(title: string): string {
  let cleaned = title.replace(/\.(mp3|wav|flac|m4a|aac|ogg|wma)$/i, '')
  cleaned = cleaned.replace(/[\(\[\{](official|music video|mv|audio|lyric video|live|hd|4k|320kbps|flac)[\)\]\}]/gi, '')
  cleaned = cleaned.replace(/-\s*(official|mv|audio|video).*/gi, '')
  return cleaned.trim()
}

function cleanArtistName(artist: string): string {
  if (
    !artist ||
    artist === 'Chưa rõ nghệ sĩ' ||
    artist === 'Nghệ sĩ chưa xác định' ||
    artist === 'Unknown Artist' ||
    artist === 'Unknown'
  ) {
    return ''
  }
  let cleaned = artist.replace(/[\(\[\{](official|vevo)[\)\]\}]/gi, '')
  cleaned = cleaned.replace(/-\s*topic/gi, '')
  return cleaned.trim()
}

/**
 * Fetch lyrics from LRCLIB API (lrclib.net)
 * Supports auto-cleaning titles/artists and fallback search queries
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
  let cleanTitle = cleanTrackTitle(title)
  let cleanArtist = artist ? cleanArtistName(artist) : ''

  // Auto-split "Artist - Title" if artist is missing or generic
  if (cleanTitle.includes(' - ') && !cleanArtist) {
    const parts = cleanTitle.split(' - ')
    cleanArtist = cleanArtistName(parts[0])
    cleanTitle = cleanTrackTitle(parts.slice(1).join(' - '))
  }

  // 1. Try exact match using /api/get if artist is present
  if (cleanArtist) {
    try {
      const params = new URLSearchParams({
        track_name: cleanTitle,
        artist_name: cleanArtist,
      })
      if (duration && duration > 0) {
        params.append('duration', Math.round(duration).toString())
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
      console.warn('LRCLIB exact get error:', e)
    }
  }

  // 2. Fallback search queries
  const queriesToTry = Array.from(
    new Set(
      [
        cleanArtist ? `${cleanTitle} ${cleanArtist}` : null,
        cleanTitle,
      ].filter(Boolean) as string[]
    )
  )

  for (const query of queriesToTry) {
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
          // Prioritize items that have syncedLyrics
          const withSynced = results.find((r) => r.syncedLyrics && r.syncedLyrics.trim().length > 0)
          if (withSynced) return withSynced

          const withPlain = results.find((r) => r.plainLyrics && r.plainLyrics.trim().length > 0)
          if (withPlain) return withPlain

          return results[0]
        }
      }
    } catch (e) {
      console.warn('LRCLIB search error:', e)
    }
  }

  return null
}
