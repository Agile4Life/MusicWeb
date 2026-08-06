import { Track } from '@/types'

/**
 * Search iTunes Music API (100% Free - Works on Cloudflare Workers, Vercel & Node.js, 0 IP blocks)
 */
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
      // Get HD 600x600 artwork URL
      const artwork = item.artworkUrl100
        ? item.artworkUrl100.replace('100x100bb', '600x600bb')
        : null

      return {
        id: `itunes-${item.trackId}`,
        user_id: 'itunes-global',
        title: item.trackName || 'iTunes Track',
        artist: item.artistName || 'Nghệ sĩ iTunes',
        album: item.collectionName || 'iTunes Global',
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
 * Fetch Top Songs Chart from iTunes RSS Feed for Initial Homepage Display
 */
export async function getTrendingITunesTracks(limit = 12): Promise<Track[]> {
  try {
    const url = `https://itunes.apple.com/us/rss/topsongs/limit=${limit}/json`
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return []

    const data = await res.json()
    const entries = data.feed?.entry || []

    return entries.map((entry: any, index: number): Track => {
      const trackId = entry.id?.attributes?.['im:id'] || index
      const title = entry['im:name']?.label || 'Top Track'
      const artist = entry['im:artist']?.label || 'Top Artist'
      const images = entry['im:image'] || []
      const coverUrl = images[images.length - 1]?.label || null
      const link = entry.link?.find((l: any) => l.attributes?.type === 'audio/x-m4a')?.attributes?.href || ''

      return {
        id: `itunes-top-${trackId}`,
        user_id: 'itunes-global',
        title,
        artist,
        album: 'iTunes Top Hits',
        duration: 30,
        file_path: link,
        cover_url: coverUrl,
        created_at: new Date().toISOString(),
        source: 'itunes',
        itunes_id: trackId,
        audio_url: link,
      }
    })
  } catch (err) {
    console.warn('iTunes top chart error:', err)
    return []
  }
}

export interface OfficialAlbum {
  id: string
  name: string
  artist: string
  cover_url: string | null
  trackCount: number
  releaseDate?: string
  source: 'spotify' | 'itunes' | 'local' | 'youtube' | 'audius'
}

/**
 * Fetch Top Official Albums from iTunes RSS Feed
 */
export async function getTopITunesAlbums(limit = 20): Promise<OfficialAlbum[]> {
  try {
    const url = `https://itunes.apple.com/us/rss/topalbums/limit=${limit}/json`
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return []

    const data = await res.json()
    const entries = data.feed?.entry || []

    return entries.map((entry: any): OfficialAlbum => {
      const albumId = entry.id?.attributes?.['im:id'] || ''
      const name = entry['im:name']?.label || 'iTunes Album'
      const artist = entry['im:artist']?.label || 'Nghệ sĩ iTunes'
      const images = entry['im:image'] || []
      const coverUrl = images[images.length - 1]?.label
        ? images[images.length - 1].label.replace('170x170bb', '600x600bb')
        : null
      const trackCount = parseInt(entry['im:itemCount']?.label || '10', 10)
      const releaseDate = entry['im:releaseDate']?.attributes?.label || ''

      return {
        id: `itunes-album-${albumId}`,
        name,
        artist,
        cover_url: coverUrl,
        trackCount,
        releaseDate,
        source: 'itunes',
      }
    })
  } catch (err) {
    console.warn('iTunes top albums fetch error:', err)
    return []
  }
}

/**
 * Fetch official tracklist for an iTunes Album Collection ID
 */
export async function getITunesAlbumTracks(collectionId: string): Promise<Track[]> {
  try {
    const cleanId = collectionId.replace('itunes-album-', '')
    const url = `https://itunes.apple.com/lookup?id=${cleanId}&entity=song`
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return []

    const data = await res.json()
    const results = data.results || []

    const songItems = results.filter((item: any) => item.wrapperType === 'track')

    return songItems.map((item: any): Track => {
      const artwork = item.artworkUrl100
        ? item.artworkUrl100.replace('100x100bb', '600x600bb')
        : null

      return {
        id: `itunes-${item.trackId}`,
        user_id: 'itunes-global',
        title: item.trackName || 'iTunes Track',
        artist: item.artistName || 'Nghệ sĩ iTunes',
        album: item.collectionName || 'iTunes Album',
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
    console.warn('iTunes album tracks error:', err)
    return []
  }
}

/**
 * Search iTunes for an official album collection ID
 */
export async function searchITunesAlbum(albumName: string): Promise<string | null> {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(albumName)}&entity=album&limit=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return null
    const data = await res.json()
    const item = data.results?.[0]
    return item ? String(item.collectionId) : null
  } catch {
    return null
  }
}
