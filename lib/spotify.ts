import { Track } from '@/types'

let cachedToken: { token: string; expiresAt: number } | null = null

export async function getSpotifyAccessToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID || '7849217775ab4acea4eeed969d5cb7fb'
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET || '87385ca17b34463eaeeadd4a17842b64'

  if (!clientId || !clientSecret) return null

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
      next: { revalidate: 3000 },
    })

    if (!res.ok) {
      console.warn('Spotify auth token failed:', res.statusText)
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
    console.error('Spotify token fetch error:', err)
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
      album: item.album?.name || 'Spotify Album',
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
    const res = await fetch(`https://api.spotify.com/v1/search?q=genre:pop%20OR%20genre:dance&type=track&limit=${limit}`, {
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
      album: item.album?.name || 'Spotify Album',
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

export async function fetchNewReleases(country = 'VN', limit = 24): Promise<SpotifyAlbumItem[]> {
  try {
    const token = await getSpotifyAccessToken()
    if (!token) return []

    // 1. Try browse/new-releases endpoint
    const res = await fetch(
      `https://api.spotify.com/v1/browse/new-releases?limit=${limit}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 3600 },
      }
    )

    if (res.ok) {
      const data = await res.json()
      const items = data.albums?.items || []
      if (items.length > 0) {
        return items.map((item: any) => ({
          id: item.id,
          name: item.name,
          artist: item.artists?.map((a: any) => a.name).join(', ') || 'Nghệ sĩ chưa xác định',
          cover_url: item.images?.[0]?.url || item.images?.[1]?.url || null,
          release_date: item.release_date || '',
          total_tracks: item.total_tracks || 0,
          album_type: item.album_type || 'album',
        }))
      }
    }

    // 2. Fallback to Search API for popular albums if browse endpoint is restricted
    const searchRes = await fetch(
      `https://api.spotify.com/v1/search?q=tag:new%20OR%20genre:pop%20OR%20v-pop&type=album&limit=${limit}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 3600 },
      }
    )

    if (searchRes.ok) {
      const sData = await searchRes.json()
      const items = sData.albums?.items || []
      return items.map((item: any) => ({
        id: item.id,
        name: item.name,
        artist: item.artists?.map((a: any) => a.name).join(', ') || 'Nghệ sĩ chưa xác định',
        cover_url: item.images?.[0]?.url || item.images?.[1]?.url || null,
        release_date: item.release_date || '',
        total_tracks: item.total_tracks || 0,
        album_type: item.album_type || 'album',
      }))
    }
  } catch (err) {
    console.error('Spotify new releases fetch error:', err)
  }
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

