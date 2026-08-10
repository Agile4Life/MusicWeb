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

export async function fetchITunesAlbumTracks(_albumId: string): Promise<ITunesAlbumDetail | null> {
  return null
}
