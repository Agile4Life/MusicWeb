import { Track } from '@/types'

let cachedToken: { token: string; expiresAt: number } | null = null

export async function getSpotifyAccessToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.warn('Spotify Client ID or Client Secret missing in environment variables.')
    return null
  }

  if (cachedToken && Date.now() < cachedToken.expiresAt - 60000) {
    return cachedToken.token
  }

  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
    })

    if (!res.ok) {
      const errBody = await res.text()
      console.error(`Spotify auth token error (${res.status} ${res.statusText}):`, errBody)
      return null
    }

    const data = await res.json()
    if (data.access_token) {
      cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      }
      return data.access_token
    }
  } catch (err) {
    console.error('Spotify token fetch exception:', err)
  }

  return null
}

export async function searchSpotifyTracks(query: string, limit = 15): Promise<Track[]> {
  if (!query.trim()) return []

  try {
    const token = await getSpotifyAccessToken()
    if (!token) return []

    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!res.ok) {
      console.warn('Spotify search API returned error:', res.status)
      return []
    }

    const data = await res.json()
    const items = data.tracks?.items || []

    return items.map((item: any) => ({
      id: `spotify-${item.id}`,
      user_id: 'spotify',
      title: item.name,
      artist: item.artists?.map((a: any) => a.name).join(', ') || 'Nghệ sĩ chưa xác định',
      album: item.album?.name || '',
      spotify_album_id: item.album?.id || undefined,
      duration: Math.round((item.duration_ms || 0) / 1000),
      file_path: item.external_urls?.spotify || item.preview_url || '',
      cover_url: item.album?.images?.[0]?.url || item.album?.images?.[1]?.url || null,
      created_at: new Date().toISOString(),
      source: 'spotify',
      spotify_id: item.id,
    }))
  } catch (err) {
    console.error('Spotify search error:', err)
    return []
  }
}

export async function getTrendingSpotifyTracks(limit = 12): Promise<Track[]> {
  try {
    const token = await getSpotifyAccessToken()
    if (!token) return []

    // Fetch Global Top Hits / Trending Tracks from Spotify API
    const res = await fetch(`https://api.spotify.com/v1/search?q=year:2024-2026&type=track&limit=${limit}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!res.ok) return []

    const data = await res.json()
    const items = data.tracks?.items || []

    return items.map((item: any) => ({
      id: `spotify-${item.id}`,
      user_id: 'spotify',
      title: item.name,
      artist: item.artists?.map((a: any) => a.name).join(', ') || 'Nghệ sĩ chưa xác định',
      album: item.album?.name || '',
      spotify_album_id: item.album?.id || undefined,
      duration: Math.round((item.duration_ms || 0) / 1000),
      file_path: item.external_urls?.spotify || item.preview_url || '',
      cover_url: item.album?.images?.[0]?.url || item.album?.images?.[1]?.url || null,
      created_at: new Date().toISOString(),
      source: 'spotify',
      spotify_id: item.id,
    }))
  } catch (err) {
    console.warn('Spotify trending fetch error:', err)
    return []
  }
}

export interface SpotifyAlbumItem {
  id: string
  name: string
  artist: string
  cover_url: string | null
  release_date: string
  total_tracks: number
  album_type: string
}

import { fetchDeezerNewReleases } from '@/lib/deezer'

export async function fetchNewReleases(country = 'US', limit = 24): Promise<SpotifyAlbumItem[]> {
  // Stage 0: Deezer Public API (100% Free, Global, No Token Expiration)
  try {
    const deezerAlbums = await fetchDeezerNewReleases(limit)
    if (deezerAlbums && deezerAlbums.length > 0) {
      return deezerAlbums
    }
  } catch (e) {
    console.warn('Deezer new releases fallback to Spotify:', e)
  }

  try {
    const token = await getSpotifyAccessToken()
    if (!token) {
      console.warn('No Spotify access token retrieved')
      return getFallbackCachedAlbums()
    }

    const safeLimit = Math.min(limit, 30)

    // Stage 1: Official Spotify Browse New Releases (Global - Worldwide)
    try {
      const res1 = await fetch(
        `https://api.spotify.com/v1/browse/new-releases?limit=${safeLimit}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }
      )
      if (res1.ok) {
        const data1 = await res1.json()
        const items1 = data1.albums?.items || []
        if (items1.length > 0) {
          return mapSpotifyAlbumItems(items1)
        }
      }
    } catch (e) {
      console.warn('Browse new releases global error:', e)
    }

    // Stage 2: Official Spotify Browse New Releases (US / Country fallback)
    try {
      const res2 = await fetch(
        `https://api.spotify.com/v1/browse/new-releases?country=${encodeURIComponent(country)}&limit=${safeLimit}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }
      )
      if (res2.ok) {
        const data2 = await res2.json()
        const items2 = data2.albums?.items || []
        if (items2.length > 0) {
          return mapSpotifyAlbumItems(items2)
        }
      }
    } catch (e) {
      console.warn('Browse new releases country error:', e)
    }

    // Stage 3: Spotify Search API with clean query
    try {
      const searchQuery = encodeURIComponent('year:2024-2026')
      const res3 = await fetch(
        `https://api.spotify.com/v1/search?q=${searchQuery}&type=album&limit=${safeLimit}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }
      )
      if (res3.ok) {
        const data3 = await res3.json()
        const items3 = data3.albums?.items || []
        if (items3.length > 0) {
          return mapSpotifyAlbumItems(items3)
        }
      }
    } catch (e) {
      console.warn('Spotify search albums error:', e)
    }
  } catch (err) {
    console.error('Spotify new releases fetch error:', err)
  }

  // Final Fallback: Read from DB if Spotify API returned no items
  return getFallbackCachedAlbums()
}

function mapSpotifyAlbumItems(items: any[]): SpotifyAlbumItem[] {
  return items
    .filter((item: any) => item && item.id && item.name)
    .map((item: any) => ({
      id: item.id,
      name: item.name,
      artist: item.artists?.map((a: any) => a.name).join(', ') || 'Nghệ sĩ chưa xác định',
      cover_url: item.images?.[0]?.url || item.images?.[1]?.url || null,
      release_date: item.release_date || '',
      total_tracks: item.total_tracks || 0,
      album_type: item.album_type || 'album',
    }))
}

async function getFallbackCachedAlbums(): Promise<SpotifyAlbumItem[]> {
  try {
    const { createClient } = await import('@supabase/supabase-js')
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (url && key) {
      const supabase = createClient(url, key, { auth: { persistSession: false } })
      const { data } = await supabase.from('spotify_albums').select('*').limit(24)
      if (data && data.length > 0) {
        return data as SpotifyAlbumItem[]
      }
    }
  } catch {}
  return []
}

export async function fetchSpotifyAlbumMeta(albumId: string): Promise<SpotifyAlbumItem | null> {
  try {
    const token = await getSpotifyAccessToken()
    if (!token) return null

    const res = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 3600 },
    })

    if (!res.ok) {
      console.warn('Spotify album meta fetch status:', res.status)
      return null
    }

    const item = await res.json()
    return {
      id: item.id,
      name: item.name,
      artist: item.artists?.map((a: any) => a.name).join(', ') || 'Nghệ sĩ chưa xác định',
      cover_url: item.images?.[0]?.url || item.images?.[1]?.url || null,
      release_date: item.release_date || '',
      total_tracks: item.total_tracks || 0,
      album_type: item.album_type || 'album',
    }
  } catch (err) {
    console.error('Spotify album meta fetch error:', err)
    return null
  }
}

export async function fetchFullAlbumTracks(albumId: string): Promise<any[]> {
  try {
    const token = await getSpotifyAccessToken()
    if (!token) return []

    let allTracks: any[] = []
    const limit = 50
    let offset = 0
    let total = 1

    while (offset < total) {
      const res = await fetch(
        `https://api.spotify.com/v1/albums/${albumId}/tracks?limit=${limit}&offset=${offset}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          next: { revalidate: 3600 },
        }
      )

      if (!res.ok) {
        console.warn('Spotify album tracks fetch status:', res.status)
        break
      }

      const data = await res.json()
      const items = data.items || []
      total = data.total || items.length
      allTracks = allTracks.concat(items)

      if (items.length === 0) break
      offset += limit
    }

    return allTracks
  } catch (err) {
    console.error('Spotify album tracks fetch error:', err)
    return []
  }
}

