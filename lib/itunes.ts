import { Track } from '@/types'

/**
 * Search iTunes Music API (100% Free - Works on Cloudflare Workers, Vercel & Node.js, 0 IP blocks)
 */
function cleanArtworkUrl(url?: string | null): string | null {
  if (!url) return null
  return url
    .replace('{w}x{h}', '600x600')
    .replace(/\/\d+x\d+[^/]*\./i, '/600x600bb.')
    .replace(/\d+x\d+bb/i, '600x600bb')
}

export async function searchITunesTracks(query: string, limit = 15): Promise<Track[]> {
  if (!query.trim()) return []

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
      query.trim()
    )}&media=music&entity=song&limit=${limit}`

    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return []

    const data = await res.json()
    const results = data.results || []

    return results.map((item: any): Track => {
      const artwork = cleanArtworkUrl(item.artworkUrl100 || item.artworkUrl60)

      return {
        id: `itunes-${item.trackId}`,
        user_id: 'itunes-global',
        title: item.trackName || 'iTunes Track',
        artist: item.artistName || 'Nghệ sĩ iTunes',
        album: item.collectionName || '',
        duration: Math.round((item.trackTimeMillis || 30000) / 1000),
        file_path: item.previewUrl || '',
        cover_url: artwork,
        created_at: item.releaseDate || new Date().toISOString(),
        source: 'itunes',
        itunes_id: item.trackId,
        audio_url: item.previewUrl || '',
      }
    })
  } catch (err) {
    console.warn('iTunes search error:', err)
    return []
  }
}

/**
 * Fetch Country Top Songs Chart from Apple Music Marketing Tools RSS Feed API v2
 * Supports 'vn', 'us', 'gb', 'kr', 'jp', etc.
 */
export async function getTrendingITunesTracks(countryCode = 'vn', limit = 12): Promise<Track[]> {
  try {
    const code = (countryCode || 'vn').toLowerCase()
    const url = `https://rss.applemarketingtools.com/api/v2/${code}/music/most-played/${limit}/songs.json`
    
    let res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) {
      // Fallback to 'us' if country RSS is unavailable
      res = await fetch(`https://rss.applemarketingtools.com/api/v2/us/music/most-played/${limit}/songs.json`, {
        signal: AbortSignal.timeout(4000),
      })
    }
    if (!res.ok) return []

    const data = await res.json()
    const results = data.feed?.results || []

    return results.map((item: any, index: number): Track => {
      const artwork = cleanArtworkUrl(item.artworkUrl100)

      return {
        id: `itunes-rss-${item.id || index}`,
        user_id: 'itunes-global',
        title: item.name || 'Top Track',
        artist: item.artistName || 'Top Artist',
        album: item.collectionName || '',
        duration: 210,
        file_path: '',
        cover_url: artwork,
        created_at: item.releaseDate || new Date().toISOString(),
        source: 'itunes',
        itunes_id: item.id,
      }
    })
  } catch (err) {
    console.warn('iTunes RSS top chart error:', err)
    return []
  }
}
