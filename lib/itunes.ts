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
        spotify_album_id: item.collectionId ? `itunes-${item.collectionId}` : undefined,
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

export interface ITunesAlbumDetail {
  id: string
  name: string
  artist: string
  cover_url: string | null
  release_date: string
  total_tracks: number
  album_type: string
  tracks: Track[]
}

/**
 * Fetch full album tracks and metadata using iTunes Lookup API
 */
export async function fetchITunesAlbumTracks(albumId: string): Promise<ITunesAlbumDetail | null> {
  try {
    const cleanId = albumId.replace(/^(itunes|itunes-rss|spotify|deezer)-/, '')
    if (!cleanId || !/^\d+$/.test(cleanId)) return null

    const res = await fetch(`https://itunes.apple.com/lookup?id=${cleanId}&entity=song`, {
      signal: AbortSignal.timeout(4500),
    })
    if (!res.ok) return null

    const data = await res.json()
    const results: any[] = data.results || []
    if (results.length === 0) return null

    const collectionItem = results.find((r) => r.wrapperType === 'collection') || results[0]
    const trackItems = results.filter((r) => r.wrapperType === 'track')

    const coverUrl = cleanArtworkUrl(collectionItem.artworkUrl100 || collectionItem.artworkUrl60)
    const systemUserId = '00000000-0000-4000-a000-000000000001'

    const tracks: Track[] = trackItems.map((item: any, idx: number) => ({
      id: `itunes-${item.trackId || idx}`,
      user_id: systemUserId,
      title: item.trackName || 'Untitled Track',
      artist: item.artistName || collectionItem.artistName || 'iTunes Artist',
      album: collectionItem.collectionName || item.collectionName || '',
      spotify_album_id: `itunes-${collectionItem.collectionId}`,
      disc_number: item.discNumber || 1,
      track_number: item.trackNumber || idx + 1,
      duration: Math.round((item.trackTimeMillis || 0) / 1000),
      file_path: item.previewUrl || '',
      audio_url: item.previewUrl || undefined,
      cover_url: cleanArtworkUrl(item.artworkUrl100) || coverUrl,
      created_at: item.releaseDate || new Date().toISOString(),
      source: 'itunes',
      itunes_id: item.trackId,
    }))

    return {
      id: `itunes-${collectionItem.collectionId}`,
      name: collectionItem.collectionName || 'iTunes Album',
      artist: collectionItem.artistName || 'iTunes Artist',
      cover_url: coverUrl,
      release_date: collectionItem.releaseDate ? collectionItem.releaseDate.split('T')[0] : '',
      total_tracks: collectionItem.trackCount || tracks.length,
      album_type: collectionItem.collectionType === 'Single' ? 'single' : 'album',
      tracks,
    }
  } catch (err) {
    console.warn('iTunes album tracks lookup error:', err)
    return null
  }
}
