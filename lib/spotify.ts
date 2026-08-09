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
    if (token) {
      const res = await fetch(`https://api.spotify.com/v1/search?q=year:2024-2026&type=track&limit=${limit}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (res.ok) {
        const data = await res.json()
        const items = data.tracks?.items || []

        if (items.length > 0) {
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
        }
      }
    }
  } catch (err) {
    console.warn('Spotify trending fetch error, using iTunes fallback:', err)
  }

  // Fallback to iTunes Top Global Hits if Spotify API credentials are not set
  const { searchITunesTracks } = await import('./itunes')
  return searchITunesTracks('top spotify global hits 2026', limit)
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

/**
 * Trích xuất Spotify playlist ID từ URL chia sẻ, dạng:
 * https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123
 * spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
 * hoặc chỉ ID trần (22 ký tự base62)
 */
export function extractSpotifyPlaylistId(input: string): string | null {
  if (!input) return null
  const trimmed = input.trim()

  // Bare ID
  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) {
    return trimmed
  }

  // spotify:playlist:ID URI form
  const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]{22})$/)
  if (uriMatch) return uriMatch[1]

  // open.spotify.com/playlist/ID URL form (with or without query string)
  const urlMatch = trimmed.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]{22})/)
  if (urlMatch) return urlMatch[1]

  return null
}

export interface SpotifyPlaylistTrack {
  spotify_id: string
  title: string
  artist: string
  album: string
  duration: number // seconds
  cover_url: string | null
  isrc: string | null
}

export interface SpotifyPlaylistMeta {
  id: string
  name: string
  description: string
  owner: string
  cover_url: string | null
  total_tracks: number
  isPublic: boolean
}

/**
 * Lấy metadata & danh sách bài hát từ trang Spotify Embed public.
 * Hoạt động 100% tin cậy cho toàn bộ playlist Public mà không bị giới hạn bởi quyền Token Spotify API.
 */
async function fetchSpotifyEmbedPlaylistData(playlistId: string): Promise<{ meta: SpotifyPlaylistMeta; tracks: SpotifyPlaylistTrack[] } | null> {
  try {
    const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
      },
      next: { revalidate: 60 },
    })

    if (!res.ok) return null

    const html = await res.text()
    const matchData =
      html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/) ||
      html.match(/<script id="resource" type="application\/json">([\s\S]*?)<\/script>/)

    if (!matchData || !matchData[1]) return null

    const json = JSON.parse(matchData[1])
    const entity =
      json?.props?.pageProps?.state?.data?.entity ||
      json?.props?.pageProps?.entity ||
      json?.props?.pageProps ||
      {}

    const coverUrl =
      entity.coverArt?.sources?.[0]?.url ||
      entity.images?.[0]?.url ||
      entity.visualIdentity?.image?.[0]?.url ||
      null

    const metaName = entity.name || entity.title || 'Spotify Playlist'
    if (!metaName || metaName === 'Spotify Playlist' && !entity.trackList) return null

    const meta: SpotifyPlaylistMeta = {
      id: playlistId,
      name: metaName,
      description: entity.description || '',
      owner: entity.owner?.name || entity.owner?.display_name || 'Spotify User',
      cover_url: coverUrl,
      total_tracks: entity.trackList?.length || 0,
      isPublic: true,
    }

    const rawTrackList = entity.trackList || []
    const tracks: SpotifyPlaylistTrack[] = rawTrackList.map((item: any) => {
      const rawUri = item.uri || ''
      const spotifyId = rawUri.replace('spotify:track:', '') || item.uid || `sp-${Math.random().toString(36).substring(2, 9)}`
      const title = item.title || item.name || 'Untitled Track'
      const artist = item.subtitle || item.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist'
      const album = item.album?.name || ''
      const duration = Math.round((item.duration || item.duration_ms || 0) / 1000)

      return {
        spotify_id: spotifyId,
        title,
        artist,
        album,
        duration,
        cover_url: item.coverArt?.sources?.[0]?.url || coverUrl,
        isrc: item.isrc || null,
      }
    })

    return { meta: { ...meta, total_tracks: tracks.length || meta.total_tracks }, tracks }
  } catch (err) {
    console.warn('Spotify Embed scraper warning:', err)
    return null
  }
}

/**
 * Lấy metadata cơ bản của playlist (tên, chủ sở hữu, số bài, ảnh bìa).
 * Trả về null nếu playlist private/không tồn tại — client_credentials token
 * chỉ đọc được playlist public, không đọc được "chỉ mình tôi" hay private collaborative.
 */
export async function fetchSpotifyPlaylistMeta(playlistId: string): Promise<SpotifyPlaylistMeta | null> {
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/spotify/playlist?id=${encodeURIComponent(playlistId)}&type=meta`)
      if (!res.ok) return null
      return await res.json()
    } catch (err) {
      console.error('Spotify playlist meta client fetch error:', err)
      return null
    }
  }

  // 1. Try Spotify Embed Scraper (Fastest, 100% Reliable, Bypass 403 API token restrictions)
  const embedData = await fetchSpotifyEmbedPlaylistData(playlistId)
  if (embedData && embedData.meta) {
    return embedData.meta
  }

  // 2. Fallback: Official Spotify API
  try {
    const token = await getSpotifyAccessToken()
    if (!token) return null

    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    )

    if (!res.ok) {
      console.warn('Spotify playlist meta fetch status:', res.status)
      return null
    }

    const data = await res.json()
    return {
      id: data.id,
      name: data.name || 'Untitled Playlist',
      description: data.description || '',
      owner: data.owner?.display_name || data.owner?.id || 'Unknown',
      cover_url: data.images?.[0]?.url || data.images?.[1]?.url || null,
      total_tracks: data.tracks?.total || 0,
      isPublic: data.public !== false,
    }
  } catch (err) {
    console.error('Spotify playlist meta fetch error:', err)
    return null
  }
}

/**
 * Lấy toàn bộ track trong playlist, tự động phân trang (Spotify trả tối đa 100 item/lần).
 * Bỏ qua local files và episode (podcast) nếu playlist có lẫn — chỉ giữ track nhạc thật.
 */
export async function fetchSpotifyPlaylistTracks(playlistId: string): Promise<SpotifyPlaylistTrack[]> {
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch(`/api/spotify/playlist?id=${encodeURIComponent(playlistId)}&type=tracks`)
      if (!res.ok) return []
      return await res.json()
    } catch (err) {
      console.error('Spotify playlist tracks client fetch error:', err)
      return []
    }
  }

  // 1. Try Spotify Embed Scraper (Fastest, 100% Reliable)
  const embedData = await fetchSpotifyEmbedPlaylistData(playlistId)
  if (embedData && embedData.tracks.length > 0) {
    return embedData.tracks
  }

  // 2. Fallback: Official Spotify API via Token
  try {
    const token = await getSpotifyAccessToken()
    if (!token) return []

    const allTracks: SpotifyPlaylistTrack[] = []
    const limit = 100
    let offset = 0
    let total = 1

    while (offset < total) {
      const res = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )

      if (!res.ok) {
        console.warn('Spotify playlist tracks fetch status:', res.status)
        break
      }

      const data = await res.json()
      total = data.total ?? 0
      const items = data.items || []

      for (const item of items) {
        const track = item?.track || item?.item || item
        if (!track) continue
        if (track.is_local) continue
        if (track.type && track.type !== 'track') continue

        const title = track.name || ''
        if (!title) continue

        const trackId = track.id || `sp-${Math.random().toString(36).substring(2, 9)}`

        allTracks.push({
          spotify_id: trackId,
          title: title,
          artist: track.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist',
          album: track.album?.name || '',
          duration: Math.round((track.duration_ms || 0) / 1000),
          cover_url: track.album?.images?.[0]?.url || track.album?.images?.[1]?.url || null,
          isrc: track.external_ids?.isrc || null,
        })
      }

      if (items.length === 0) break
      offset += limit
    }

    return allTracks
  } catch (err) {
    console.error('Spotify playlist tracks fetch error:', err)
    return []
  }
}


