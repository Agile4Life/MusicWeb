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

export const SPAM_OR_COMPILATION_KEYWORDS = [
  'billboard',
  'hot 100',
  'hot100',
  'top music',
  'top 100',
  'top 50',
  'top 20',
  'top 10',
  'top songs',
  'trending songs',
  'top hits',
  'popular music',
  'best songs',
  'music hits',
  'bảng xếp hạng',
  'ocean beats',
  'jsvibes',
  'tradingview',
  'full album',
  'compilation',
  'tổng hợp',
  'tuyển tập',
  '1 hour',
  '2 hour',
  '3 hour',
  '10 hours',
  'loop',
]

export function isCleanTrendingTrack(title?: string | null, artist?: string | null): boolean {
  const t = (title || '').toLowerCase()
  const a = (artist || '').toLowerCase()
  return !SPAM_OR_COMPILATION_KEYWORDS.some((kw) => t.includes(kw) || a.includes(kw))
}

export async function getTrendingSpotifyTracks(limit = 12): Promise<Track[]> {
  try {
    const globalArtists = [
      'Taylor Swift',
      'The Weeknd',
      'Billie Eilish',
      'Bruno Mars',
      'Sabrina Carpenter',
      'Ariana Grande',
      'Post Malone',
      'Dua Lipa',
      'Drake',
      'Olivia Rodrigo',
    ]
    const perArtist = Math.max(1, Math.ceil(limit / globalArtists.length))
    const tracks = await getTopArtistSpotifyTracks(globalArtists, perArtist)
    const clean = tracks.filter((t) => isCleanTrendingTrack(t.title, t.artist))
    return clean.slice(0, limit)
  } catch (err) {
    console.warn('Spotify trending fetch error:', err)
  }
  return []
}

/**
 * Fetch top hit tracks for specified iconic artists using Spotify Search API
 */
export async function getTopArtistSpotifyTracks(artists: string[], tracksPerArtist = 3): Promise<Track[]> {
  try {
    const token = await getSpotifyAccessToken()
    if (!token) return []

    const promises = artists.map(async (artist) => {
      try {
        const url = `https://api.spotify.com/v1/search?q=artist:${encodeURIComponent(artist)}&type=track&limit=${tracksPerArtist}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return []
        const data = await res.json()
        const items = data.tracks?.items || []
        return items.map((item: any) => ({
          id: `spotify-${item.id}`,
          user_id: 'spotify',
          title: item.name,
          artist: item.artists?.map((a: any) => a.name).join(', ') || artist,
          album: item.album?.name || '',
          spotify_album_id: item.album?.id || undefined,
          duration: Math.round((item.duration_ms || 0) / 1000),
          file_path: item.external_urls?.spotify || item.preview_url || '',
          cover_url: item.album?.images?.[0]?.url || item.album?.images?.[1]?.url || null,
          created_at: new Date().toISOString(),
          source: 'spotify' as const,
          spotify_id: item.id,
        }))
      } catch {
        return []
      }
    })

    const results = await Promise.all(promises)
    return results.flat()
  } catch {
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

/**
 * Fetch new releases directly from the Spotify API (no Deezer shortcut).
 * Used for multi-platform trending album merging.
 */
export async function fetchSpotifyNewReleases(country = 'US', limit = 30): Promise<SpotifyAlbumItem[]> {
  try {
    const token = await getSpotifyAccessToken()
    if (!token) return []
    const safeLimit = Math.min(limit, 50)

    // Spotify Search API first (reliable: browse/new-releases can 403 for some accounts)
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent('year:2024-2026')}&type=album&limit=${safeLimit}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        }
      )
      if (res.ok) {
        const data = await res.json()
        const items = data.albums?.items || []
        if (items.length > 0) return mapSpotifyAlbumItems(items)
      }
    } catch (e) {
      console.warn('Spotify search albums error:', e)
    }

    for (const url of [
      `https://api.spotify.com/v1/browse/new-releases?limit=${safeLimit}`,
      `https://api.spotify.com/v1/browse/new-releases?country=${encodeURIComponent(country)}&limit=${safeLimit}`,
    ]) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        if (res.ok) {
          const data = await res.json()
          const items = data.albums?.items || []
          if (items.length > 0) return mapSpotifyAlbumItems(items)
        }
      } catch (e) {
        console.warn('Spotify browse new releases error:', e)
      }
    }
  } catch (err) {
    console.error('Spotify new releases fetch error:', err)
  }
  return []
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

export interface SpotifyArtistResult {
  id: string
  name: string
  picture_xl: string | null
  picture_big: string | null
  genres?: string[]
}

function normalizeArtistForMatch(name: string): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

/**
 * Strict exact artist search on Spotify:
 * Returns official artist name and high-res square avatar (640x640).
 */
export async function searchSpotifyArtistExact(artistName: string): Promise<SpotifyArtistResult | null> {
  if (!artistName || !artistName.trim()) return null
  const cleanTarget = artistName.replace(/[\(\[\{].*?[\)\]\}]/g, '').trim()
  const targetNorm = normalizeArtistForMatch(cleanTarget)
  if (!targetNorm) return null

  try {
    const token = await getSpotifyAccessToken()
    if (!token) return null

    const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(cleanTarget)}&type=artist&limit=10`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 86400 },
    })

    if (!res.ok) return null
    const data = await res.json()
    const items = data.artists?.items || []

    const matched = items.filter((i: any) => {
      if (!i || !i.name) return false
      const cleanItem = i.name.trim()
      const isExact = cleanItem.toLowerCase() === cleanTarget.toLowerCase()
      const isNorm = normalizeArtistForMatch(cleanItem) === targetNorm
      return isExact || isNorm
    })

    if (matched.length > 0) {
      const top = matched[0]
      return {
        id: top.id,
        name: top.name,
        picture_xl: top.images?.[0]?.url || null,
        picture_big: top.images?.[1]?.url || top.images?.[0]?.url || null,
        genres: top.genres || [],
      }
    }
  } catch (err) {
    console.warn('Spotify artist search warning:', err)
  }

  return null
}

/**
 * Fetch Top Tracks for a Spotify Artist ID
 * Tries market=VN, then market=US, and enriches with search if needed.
 */
export async function getSpotifyArtistTopTracks(artistId: string, artistName?: string, limit = 20): Promise<Track[]> {
  if (!artistId) return []

  try {
    const token = await getSpotifyAccessToken()
    if (!token) return []

    // 1. Fetch official top tracks
    let res = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=VN`, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 3600 },
    })

    if (!res.ok || res.status === 404) {
      res = await fetch(`https://api.spotify.com/v1/artists/${artistId}/top-tracks?market=US`, {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 3600 },
      })
    }

    let items: any[] = []
    if (res.ok) {
      const data = await res.json()
      items = data.tracks || []
    }

    // 2. If fewer than 5 tracks found and artistName provided, search by artist name
    if (items.length < 5 && artistName) {
      const searchRes = await fetch(
        `https://api.spotify.com/v1/search?q=artist:${encodeURIComponent(artistName)}&type=track&limit=${limit}&market=VN`,
        {
          headers: { Authorization: `Bearer ${token}` },
          next: { revalidate: 3600 },
        }
      )
      if (searchRes.ok) {
        const searchData = await searchRes.json()
        const searchItems = searchData.tracks?.items || []
        const seenIds = new Set(items.map((i: any) => i.id))
        for (const item of searchItems) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id)
            items.push(item)
          }
        }
      }
    }

    if (items.length > 0) {
      return items.slice(0, limit).map((item: any) => ({
        id: `spotify-${item.id}`,
        user_id: '00000000-0000-4000-a000-000000000001',
        title: item.name || 'Untitled Track',
        artist: item.artists?.map((a: any) => a.name).join(', ') || artistName || 'Unknown Artist',
        album: item.album?.name || '',
        spotify_album_id: item.album?.id || undefined,
        duration: Math.round((item.duration_ms || 0) / 1000),
        file_path: item.external_urls?.spotify || item.preview_url || '',
        audio_url: item.preview_url || undefined,
        cover_url: item.album?.images?.[0]?.url || item.album?.images?.[1]?.url || null,
        created_at: new Date().toISOString(),
        source: 'spotify' as const,
        spotify_id: item.id,
      }))
    }
  } catch (err) {
    console.warn('Spotify artist top tracks warning:', err)
  }

  return []
}



