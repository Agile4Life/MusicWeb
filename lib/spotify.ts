import { Track } from '@/types'
import { isRealAlbumName } from '@/lib/albumCache'

/**
 * Only lock a track's `spotify_album_id` if the Spotify album is a multi-track non-single album
 * OR has a distinct real album name (different from the track title).
 * This prevents 1-track singles from locking `spotify_album_id` prematurely and allows
 * `/api/albums/resolve` to upgrade them to the parent studio album.
 */
export function resolveTrackSpotifyAlbumId(album: any, trackTitle?: string | null): string | undefined {
  if (!album?.id) return undefined
  const totalTracks = Number(album.total_tracks || 0)
  const albumType = String(album.album_type || '').toLowerCase()
  if (totalTracks > 1 && albumType !== 'single') {
    return String(album.id)
  }
  if (album.name && isRealAlbumName(album.name, trackTitle)) {
    return String(album.id)
  }
  return undefined
}

let cachedToken: { token: string; expiresAt: number } | null = null
let tokenInFlight: Promise<string | null> | null = null

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

  if (tokenInFlight) return tokenInFlight

  tokenInFlight = fetchSpotifyAccessToken(clientId, clientSecret)
  try {
    return await tokenInFlight
  } finally {
    tokenInFlight = null
  }
}

async function fetchSpotifyAccessToken(clientId: string, clientSecret: string): Promise<string | null> {
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

export async function searchSpotifyTracks(query: string, limit = 10): Promise<Track[]> {
  if (!query.trim()) return []
  const safeLimit = Math.min(limit, 10)

  try {
    const token = await getSpotifyAccessToken()
    if (!token) return []

    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${safeLimit}`
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
      spotify_album_id: resolveTrackSpotifyAlbumId(item.album, item.name),
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
  'chansons enfants',
  'chanson enfant',
  'comptines',
  'comptine',
  'kids united',
  'clipounets',
  'bébés',
  'nursery rhyme',
  'nursery rhymes',
  'cocomelon',
  'baby shark',
  'lullaby',
  'lullabies',
  'nhạc thiếu nhi',
  'thiếu nhi',
  'karaoke',
  'tribute to',
  'made famous by',
  'ringtone',
  '8d audio',
  'nightcore',
]

export function isCleanTrendingTrack(title?: string | null, artist?: string | null): boolean {
  const t = (title || '').toLowerCase()
  const a = (artist || '').toLowerCase()
  return !SPAM_OR_COMPILATION_KEYWORDS.some((kw) => t.includes(kw) || a.includes(kw))
}

function normalizeArtistToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/g, ' ')
    .trim()
}

function normalizeTrackCoreTitle(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/\s*\([^)]*(?:feat|ft|with|remaster|version|ver\.|live|from)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]+/gi, ' ')
    .trim()
}

const ARTIST_SEARCH_QUERY_OVERRIDES: Record<string, string> = {
  MCK: 'RPT MCK',
  Mayday: '五月天',
  'Đen': 'Đen Vâu',
}

function doesSpotifyArtistMatchTarget(
  itemArtists: Array<{ name?: string }> | undefined,
  targetArtist: string
): boolean {
  if (!Array.isArray(itemArtists) || itemArtists.length === 0) return false
  if (targetArtist === 'LiSA') {
    return itemArtists.some((a) => a?.name === 'LiSA')
  }
  if (targetArtist === 'SEVENTEEN') {
    return itemArtists.some((a) => a?.name === 'SEVENTEEN')
  }
  const targetNorm = normalizeArtistToken(targetArtist)
  if (!targetNorm) return false

  return itemArtists.some((a) => {
    const rawName = (a?.name || '').trim()
    if (!rawName) return false
    const candNorm = normalizeArtistToken(rawName)
    if (candNorm === targetNorm) return true
    if (targetArtist === 'MCK' && (candNorm === 'rpt mck' || candNorm.includes('mck'))) return true
    if (targetArtist === 'Mayday' && (rawName.includes('五月天') || candNorm === 'mayday')) return true
    if (targetArtist === 'Jolin Tsai' && (rawName.includes('蔡依林') || candNorm === 'jolin')) return true
    if (targetArtist === 'Jay Chou' && rawName.includes('周杰倫')) return true
    if (targetArtist === 'JJ Lin' && rawName.includes('林俊傑')) return true
    if (targetArtist === 'G.E.M.' && (rawName.includes('鄧紫棋') || candNorm === 'g e m')) return true
    if (targetArtist === 'Eric Chou' && rawName.includes('周興哲')) return true
    if (targetArtist === 'Eason Chan' && rawName.includes('陳奕迅')) return true
    if ((targetArtist === 'Đen' || targetArtist === 'Đen Vâu') && (candNorm === 'den' || candNorm === 'den vau')) {
      return true
    }
    return false
  })
}

/**
 * Fetch top hit tracks for specified iconic artists using Spotify Search API
 * with strict artist verification and title deduplication.
 */
export async function getTopArtistSpotifyTracks(artists: string[], tracksPerArtist = 3): Promise<Track[]> {
  try {
    const token = await getSpotifyAccessToken()
    if (!token) return []

    const promises = artists.map(async (artist) => {
      try {
        const safePerArtist = Math.min(Math.max(1, tracksPerArtist), 10)
        const searchQuery = ARTIST_SEARCH_QUERY_OVERRIDES[artist] || artist
        const fetchLimit = Math.min(Math.max(safePerArtist * 4, 8), 10)
        const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=${fetchLimit}`
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) return []
        const data = await res.json()
        const items: any[] = data.tracks?.items || []
        const seenTitles = new Set<string>()
        const matchedTracks: Track[] = []

        for (const item of items) {
          if (!item?.id || !item?.name) continue
          if (!doesSpotifyArtistMatchTarget(item.artists, artist)) continue
          const joinedArtist = item.artists?.map((a: any) => a.name).join(', ') || artist
          if (!isCleanTrendingTrack(item.name, joinedArtist)) continue

          const coreTitle = normalizeTrackCoreTitle(item.name)
          if (coreTitle && seenTitles.has(coreTitle)) continue
          if (coreTitle) seenTitles.add(coreTitle)

          matchedTracks.push({
            id: `spotify-${item.id}`,
            user_id: 'spotify',
            title: item.name,
            artist: joinedArtist,
            album: item.album?.name || '',
            spotify_album_id: resolveTrackSpotifyAlbumId(item.album, item.name),
            duration: Math.round((item.duration_ms || 0) / 1000),
            file_path: item.external_urls?.spotify || item.preview_url || '',
            cover_url: item.album?.images?.[0]?.url || item.album?.images?.[1]?.url || null,
            created_at: new Date().toISOString(),
            source: 'spotify' as const,
            spotify_id: item.id,
          })

          if (matchedTracks.length >= safePerArtist) break
        }

        return matchedTracks
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
        `https://api.spotify.com/v1/search?q=${searchQuery}&type=album&limit=${Math.min(safeLimit, 10)}`,
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
        `https://api.spotify.com/v1/search?q=${encodeURIComponent('year:2024-2026')}&type=album&limit=${Math.min(safeLimit, 10)}`,
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

async function fetchSpotifyEmbedAlbumData(
  albumId: string,
): Promise<{ meta: SpotifyAlbumItem; tracks: any[] } | null> {
  try {
    const embedUrl = `https://open.spotify.com/embed/album/${encodeURIComponent(albumId)}`
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
      },
      next: { revalidate: 3600 },
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

    const metaName = entity.name || entity.title
    const rawTrackList: any[] = entity.trackList || []
    if (!metaName || rawTrackList.length === 0) return null

    const coverUrl =
      entity.coverArt?.sources?.[0]?.url ||
      entity.images?.[0]?.url ||
      entity.visualIdentity?.image?.[0]?.url ||
      null

    const albumArtist =
      entity.subtitle ||
      entity.artists?.map((a: any) => a.name).join(', ') ||
      rawTrackList[0]?.subtitle ||
      'Nghệ sĩ chưa xác định'

    const releaseDate = entity.releaseDate?.isoString
      ? String(entity.releaseDate.isoString).split('T')[0]
      : entity.release_date || ''

    const tracks = rawTrackList.map((item: any, idx: number) => {
      const rawUri = item.uri || ''
      const spotifyId = rawUri.replace('spotify:track:', '') || item.uid || `${albumId}-${idx + 1}`
      const artistStr = item.subtitle || albumArtist
      return {
        id: spotifyId,
        name: item.title || item.name || 'Untitled Track',
        artists: artistStr.split(/,\s*/).map((name: string) => ({ name })),
        disc_number: item.disc_number || 1,
        track_number: item.track_number || idx + 1,
        duration_ms: item.duration || item.duration_ms || 0,
        preview_url: item.audioPreview?.url || item.preview_url || null,
        external_urls: { spotify: `https://open.spotify.com/track/${spotifyId}` },
      }
    })

    const meta: SpotifyAlbumItem = {
      id: entity.id || albumId,
      name: metaName,
      artist: albumArtist,
      cover_url: coverUrl,
      release_date: releaseDate,
      total_tracks: tracks.length,
      album_type: tracks.length === 1 ? 'single' : 'album',
    }

    return { meta, tracks }
  } catch (err) {
    console.warn('Spotify Embed album scraper warning:', err)
    return null
  }
}

export async function fetchSpotifyAlbumMeta(albumId: string): Promise<SpotifyAlbumItem | null> {
  try {
    const token = await getSpotifyAccessToken()
    if (token) {
      const res = await fetch(`https://api.spotify.com/v1/albums/${albumId}`, {
        headers: { Authorization: `Bearer ${token}` },
        next: { revalidate: 3600 },
      })

      if (res.ok) {
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
      }
      console.warn('Spotify album meta fetch status:', res.status)
    }
  } catch (err) {
    console.error('Spotify album meta fetch error:', err)
  }

  const embedFallback = await fetchSpotifyEmbedAlbumData(albumId)
  return embedFallback?.meta || null
}

export async function fetchFullAlbumTracks(albumId: string): Promise<any[]> {
  try {
    const token = await getSpotifyAccessToken()
    if (token) {
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

      if (allTracks.length > 0) {
        return allTracks
      }
    }
  } catch (err) {
    console.error('Spotify album tracks fetch error:', err)
  }

  const embedFallback = await fetchSpotifyEmbedAlbumData(albumId)
  return embedFallback?.tracks || []
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

const spotifyTrackCoverCache = new Map<string, string>()
const spotifyTrackCoverInFlight = new Map<string, Promise<string | null>>()

export function upgradeSpotifyCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null
  if (url.includes('charts-images.scdn.co')) return null
  if (url.includes('scdn.co') || url.includes('spotifycdn.com')) {
    return url.replace(/ab67616d0000(?:1e02|4851)/g, 'ab67616d0000b273')
  }
  return url
}

export async function resolveSpotifyTrackCover(spotifyId: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9]{22}$/.test(spotifyId)) return null
  const cached = spotifyTrackCoverCache.get(spotifyId)
  if (cached) return cached

  const existing = spotifyTrackCoverInFlight.get(spotifyId)
  if (existing) return existing

  const promise = (async (): Promise<string | null> => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(
            `https://open.spotify.com/oembed?url=${encodeURIComponent(`spotify:track:${spotifyId}`)}`,
            { signal: AbortSignal.timeout(4500) }
          )
          if (!res.ok) continue
          const data = await res.json()
          const cover = upgradeSpotifyCoverUrl(typeof data?.thumbnail_url === 'string' ? data.thumbnail_url : null)
          if (cover) {
            if (spotifyTrackCoverCache.size >= 1000) {
              const oldest = spotifyTrackCoverCache.keys().next().value
              if (oldest) spotifyTrackCoverCache.delete(oldest)
            }
            spotifyTrackCoverCache.set(spotifyId, cover)
            return cover
          }
        } catch {
          // Retry once on transient network/timeout error
        }
      }
      return null
    } finally {
      spotifyTrackCoverInFlight.delete(spotifyId)
    }
  })()

  spotifyTrackCoverInFlight.set(spotifyId, promise)
  return promise
}

async function enrichSpotifyPlaylistTrackCovers(
  tracks: SpotifyPlaylistTrack[],
  maxToEnrich = 50,
  concurrency = 10
): Promise<SpotifyPlaylistTrack[]> {
  const results = tracks.map((track) => {
    const cleanExisting = upgradeSpotifyCoverUrl(track.cover_url)
    return cleanExisting === track.cover_url ? track : { ...track, cover_url: cleanExisting }
  })

  const indicesToFetch: number[] = []
  for (let i = 0; i < results.length && indicesToFetch.length < maxToEnrich; i++) {
    if (!results[i].cover_url && /^[a-zA-Z0-9]{22}$/.test(results[i].spotify_id)) {
      indicesToFetch.push(i)
    }
  }

  if (indicesToFetch.length === 0) return results

  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, indicesToFetch.length) }, async () => {
    while (cursor < indicesToFetch.length) {
      const idx = indicesToFetch[cursor++]
      const resolvedCover = await resolveSpotifyTrackCover(results[idx].spotify_id)
      results[idx] = { ...results[idx], cover_url: resolvedCover }
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * Lấy metadata & danh sách bài hát từ trang Spotify Embed public.
 * Hoạt động 100% tin cậy cho toàn bộ playlist Public mà không bị giới hạn bởi quyền Token Spotify API.
 */
async function fetchSpotifyEmbedPlaylistData(playlistId: string, options?: { fresh?: boolean }): Promise<{ meta: SpotifyPlaylistMeta; tracks: SpotifyPlaylistTrack[] } | null> {
  try {
    const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
      },
      ...(options?.fresh
        ? { cache: 'no-store' as const, signal: AbortSignal.timeout(5000) }
        : { next: { revalidate: 60 } }),
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
        cover_url: upgradeSpotifyCoverUrl(item.coverArt?.sources?.[0]?.url || item.images?.[0]?.url || item.album?.images?.[0]?.url || null),
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
export async function fetchSpotifyPlaylistTracks(playlistId: string, options?: { fresh?: boolean }): Promise<SpotifyPlaylistTrack[]> {
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
  const embedData = await fetchSpotifyEmbedPlaylistData(playlistId, options)
  if (embedData && embedData.tracks.length > 0) {
    return enrichSpotifyPlaylistTrackCovers(embedData.tracks)
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
        {
          headers: { Authorization: `Bearer ${token}` },
          ...(options?.fresh ? { cache: 'no-store' as const, signal: AbortSignal.timeout(5000) } : {}),
        }
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
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g, '')
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

    const searchQuery = ARTIST_SEARCH_QUERY_OVERRIDES[cleanTarget] || cleanTarget
    const res = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQuery)}&type=artist&limit=10`, {
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
      const isAlias = doesSpotifyArtistMatchTarget([{ name: cleanItem }], cleanTarget)
      return isExact || isNorm || isAlias
    })

    const cjkFallback = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(cleanTarget) ? items.find((i: any) => i?.id && i?.name) : null
    if (matched.length > 0 || cjkFallback) {
      const top = matched[0] || cjkFallback
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
export async function getSpotifyArtistTopTracks(artistId: string, artistName?: string, limit = 10): Promise<Track[]> {
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

    // 2. If fewer than 5 tracks found and artistName provided, search by artist name with strict artist verification
    if (items.length < 5 && artistName) {
      const searchQuery = ARTIST_SEARCH_QUERY_OVERRIDES[artistName] || artistName
      const offsets = limit > 10 ? [0, 10] : [0]
      const pageResults = await Promise.all(
        offsets.map(async (offset) => {
          try {
            const r = await fetch(
              `https://api.spotify.com/v1/search?q=${encodeURIComponent(searchQuery)}&type=track&limit=10&offset=${offset}`,
              {
                headers: { Authorization: `Bearer ${token}` },
                next: { revalidate: 3600 },
              }
            )
            if (!r.ok) return []
            const d = await r.json()
            return d.tracks?.items || []
          } catch {
            return []
          }
        })
      )
      const searchItems = pageResults.flat()
      const seenIds = new Set(items.map((i: any) => i.id))
      for (const item of searchItems) {
        if (!item?.id || !item?.name || seenIds.has(item.id)) continue
        const matchesId = Array.isArray(item.artists) && item.artists.some((a: any) => a?.id === artistId)
        const matchesName = doesSpotifyArtistMatchTarget(item.artists, artistName)
        if (!matchesId && !matchesName) continue
        const joinedArtist = item.artists?.map((a: any) => a.name).join(', ') || artistName
        if (!isCleanTrendingTrack(item.name, joinedArtist)) continue
        seenIds.add(item.id)
        items.push(item)
      }
    }

    if (items.length > 0) {
      return items.slice(0, limit).map((item: any) => ({
        id: `spotify-${item.id}`,
        user_id: '00000000-0000-4000-a000-000000000001',
        title: item.name || 'Untitled Track',
        artist: item.artists?.map((a: any) => a.name).join(', ') || artistName || 'Unknown Artist',
        album: item.album?.name || '',
        spotify_album_id: resolveTrackSpotifyAlbumId(item.album, item.name),
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



