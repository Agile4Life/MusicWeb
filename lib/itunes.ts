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

export async function searchITunesTracks(_query: string, _limit = 15): Promise<Track[]> {
  return []
}

export async function getTrendingITunesTracks(_countryCode = 'vn', _limit = 12): Promise<Track[]> {
  return []
}

export interface ITunesAlbumItem {
  id: string
  name: string
  artist: string
  cover_url: string | null
  release_date: string
  total_tracks: number
  album_type: string
}

/**
 * Search albums by title or artist using the iTunes Search API
 */
export async function searchITunesAlbums(query: string, limit = 30): Promise<ITunesAlbumItem[]> {
  if (!query || !query.trim()) return []
  try {
    const safeLimit = Math.min(limit, 50)
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query.trim())}&entity=album&limit=${safeLimit}`,
      { signal: AbortSignal.timeout(6000), next: { revalidate: 3600 } }
    )
    if (res.ok) {
      const data = await res.json()
      const items = data.results || []
      if (items.length > 0) return mapITunesAlbums(items)
    }
  } catch (err) {
    console.warn('iTunes search albums warning:', err)
  }
  return []
}

/**
 * Fetch the latest trending/hot albums from the Apple Music/iTunes Top Albums charts
 */
export async function getTrendingITunesAlbums(countryCode = 'us', limit = 30): Promise<ITunesAlbumItem[]> {
  try {
    const safeLimit = Math.min(limit, 50)
    const res = await fetch(
      `https://itunes.apple.com/${encodeURIComponent(countryCode)}/rss/topalbums/limit=${safeLimit}/json`,
      { signal: AbortSignal.timeout(6000), next: { revalidate: 3600 } }
    )
    if (res.ok) {
      const data = await res.json()
      const entries = data?.feed?.entry || []
      if (entries.length > 0) return mapITunesRssAlbums(entries)
    }
  } catch (err) {
    console.warn('iTunes trending albums warning:', err)
  }
  return []
}

interface ITunesRssEntry {
  'im:name'?: { label?: string }
  'im:artist'?: { label?: string }
  'im:image'?: { label?: string }[]
  'im:collectionType'?: { label?: string }
  'im:releaseDate'?: { label?: string }
  'im:itemCount'?: { label?: string }
  'im:trackCount'?: { label?: string }
  id?: { attributes?: { 'im:id'?: string } }
}

interface ITunesSearchResult {
  collectionId?: number | string
  collectionName?: string
  artistName?: string
  artworkUrl100?: string
  releaseDate?: string
  trackCount?: number
  collectionType?: string
}

interface ITunesLookupResult extends ITunesSearchResult {
  wrapperType: string
  trackId?: number
  trackName?: string
  trackTimeMillis?: number
  previewUrl?: string
}

function mapITunesRssAlbums(entries: ITunesRssEntry[]): ITunesAlbumItem[] {
  return entries
    .filter((e) => e && e.id?.attributes?.['im:id'] && e['im:name']?.label)
    .map((e) => {
      const images = e['im:image'] || []
      return {
        id: `itunes-${e.id?.attributes?.['im:id']}`,
        name: e['im:name']?.label || '',
        artist: e['im:artist']?.label || 'Nghệ sĩ chưa xác định',
        cover_url: cleanArtworkUrl(images[images.length - 1]?.label),
        release_date: String(e['im:releaseDate']?.label || '').split('T')[0] || '',
        total_tracks: Number(e['im:itemCount']?.label || e['im:trackCount']?.label || 0),
        album_type: String(e['im:collectionType']?.label || 'album').toLowerCase() === 'single' ? 'single' : 'album',
      }
    })
}

function mapITunesAlbums(items: ITunesSearchResult[]): ITunesAlbumItem[] {
  return items
    .filter((item) => item && item.collectionId && item.collectionName)
    .map((item) => ({
      id: `itunes-${item.collectionId}`,
      name: item.collectionName || '',
      artist: item.artistName || 'Nghệ sĩ chưa xác định',
      cover_url: cleanArtworkUrl(item.artworkUrl100),
      release_date: String(item.releaseDate || '').split('T')[0] || '',
      total_tracks: item.trackCount || 0,
      album_type: String(item.collectionType || 'album').toLowerCase() === 'single' ? 'single' : 'album',
    }))
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
 * Fetch full album metadata + track list from the iTunes Lookup API
 */
export async function fetchITunesAlbumTracks(albumId: string): Promise<ITunesAlbumDetail | null> {
  const cleanId = albumId.replace(/^itunes(-rss)?-/, '')
  if (!/^\d+$/.test(cleanId)) return null
  try {
    const res = await fetch(
      `https://itunes.apple.com/lookup?id=${cleanId}&entity=song&limit=200`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 3600 } }
    )
    if (!res.ok) return null
    const data = await res.json()
    const results: ITunesLookupResult[] = data.results || []
    const albumInfo = results.find((r) => r.wrapperType === 'collection')
    if (!albumInfo) return null
    const songItems = results.filter((r) => r.wrapperType === 'track')

    return {
      id: `itunes-${albumInfo.collectionId}`,
      name: albumInfo.collectionName || '',
      artist: albumInfo.artistName || 'Nghệ sĩ chưa xác định',
      cover_url: cleanArtworkUrl(albumInfo.artworkUrl100),
      release_date: String(albumInfo.releaseDate || '').split('T')[0] || '',
      total_tracks: albumInfo.trackCount || songItems.length,
      album_type: String(albumInfo.collectionType || 'album').toLowerCase() === 'single' ? 'single' : 'album',
      tracks: songItems.map((item, idx) => ({
        id: `itunes-${item.trackId || idx}`,
        user_id: '00000000-0000-4000-a000-000000000001',
        title: item.trackName || '',
        artist: item.artistName || albumInfo.artistName || 'Nghệ sĩ chưa xác định',
        album: albumInfo.collectionName || '',
        duration: Math.round((item.trackTimeMillis || 0) / 1000),
        file_path: item.previewUrl || '',
        audio_url: item.previewUrl || undefined,
        cover_url: cleanArtworkUrl(item.artworkUrl100 || albumInfo.artworkUrl100),
        spotify_album_id: `itunes-${albumInfo.collectionId}`,
        source: 'itunes' as const,
        created_at: new Date().toISOString(),
      })),
    }
  } catch (err) {
    console.warn('iTunes album tracks warning:', err)
  }
  return null
}
