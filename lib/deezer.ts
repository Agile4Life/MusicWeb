import { Track } from '@/types'
import { QueueTrack } from '@/types/queue'

export interface DeezerAlbumItem {
  id: string
  name: string
  artist: string
  cover_url: string | null
  release_date: string
  total_tracks: number
  album_type: string
}

/**
 * Fetch Top Worldwide Most Streamed & Chart-Topping Albums
 * (Deezer Global Top 100 Chart + Worldwide Megastars & Billboard Hits)
 */
export async function fetchDeezerNewReleases(limit = 60): Promise<DeezerAlbumItem[]> {
  try {
    // 1. Fetch Chart Albums first with a 4s timeout
    const chartRes = await fetch('https://api.deezer.com/chart/0/albums?limit=50', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 3600 },
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null)

    const chartItems = chartRes?.data || []
    if (chartItems.length >= limit) {
      return mapDeezerAlbums(chartItems.slice(0, limit))
    }

    // 2. Fetch top artist queries with timeout if needed
    const topQueries = ['taylor swift', 'the weeknd', 'drake', 'billie eilish']
    const searchPromises = topQueries.map((q) =>
      fetch(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=10`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(4000),
        next: { revalidate: 3600 },
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
    )

    const searchResults = await Promise.allSettled(searchPromises)

    const combined: any[] = [...chartItems]
    const seenIds = new Set<string>(chartItems.map((i: any) => String(i.id)))

    searchResults.forEach((res) => {
      if (res.status === 'fulfilled' && res.value?.data) {
        for (const item of res.value.data) {
          if (!item || !item.id || !item.title) continue
          const idStr = String(item.id)
          if (seenIds.has(idStr)) continue
          seenIds.add(idStr)
          combined.push(item)
        }
      }
    })

    if (combined.length > 0) {
      return mapDeezerAlbums(combined.slice(0, limit))
    }
  } catch (err) {
    console.warn('Deezer Global Worldwide albums fetch error:', err)
  }

  return []
}

/**
 * Search albums by title or artist using Deezer API
 */
export async function searchDeezerAlbums(query: string, limit = 30): Promise<DeezerAlbumItem[]> {
  if (!query || !query.trim()) return []
  try {
    const safeLimit = Math.min(limit, 50)
    const res = await fetch(
      `https://api.deezer.com/search/album?q=${encodeURIComponent(query.trim())}&limit=${safeLimit}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(4000),
        next: { revalidate: 300 },
      }
    )

    if (res.ok) {
      const data = await res.json()
      const items = data.data || []
      if (items.length > 0) {
        return mapDeezerAlbums(items)
      }
    }
  } catch (err) {
    console.warn('Deezer search albums warning:', err)
  }

  return []
}

/**
 * Fetch metadata for a specific album from Deezer API
 */
export async function fetchDeezerAlbumMeta(albumId: string): Promise<DeezerAlbumItem | null> {
  try {
    const cleanId = albumId.replace(/^(deezer|spotify)-/, '')
    if (!cleanId || !/^\d+$/.test(cleanId)) return null

    const res = await fetch(`https://api.deezer.com/album/${encodeURIComponent(cleanId)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 3600 },
    })

    if (!res.ok) {
      console.warn('Deezer album meta status:', res.status)
      return null
    }

    const item = await res.json()
    if (!item || item.error || !item.title) return null

    return {
      id: String(item.id),
      name: item.title,
      artist: item.artist?.name || 'Nghệ sĩ chưa xác định',
      cover_url: item.cover_xl || item.cover_big || item.cover_medium || item.cover || null,
      release_date: item.release_date || '',
      total_tracks: item.nb_tracks || item.tracks?.data?.length || 0,
      album_type: item.record_type || 'album',
    }
  } catch (err) {
    console.warn('Deezer album meta fetch warning:', err)
    return null
  }
}

/**
 * Fetch full tracklist for a specific album from Deezer API
 */
export async function fetchDeezerAlbumTracks(albumId: string): Promise<{ meta: DeezerAlbumItem; tracks: Track[] } | null> {
  try {
    const cleanId = albumId.replace(/^(deezer|spotify)-/, '')
    if (!cleanId || !/^\d+$/.test(cleanId)) return null

    const res = await fetch(`https://api.deezer.com/album/${encodeURIComponent(cleanId)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 3600 },
    })

    if (!res.ok) return null

    const data = await res.json()
    if (!data || data.error || !data.title) return null

    const meta: DeezerAlbumItem = {
      id: String(data.id),
      name: data.title,
      artist: data.artist?.name || 'Nghệ sĩ chưa xác định',
      cover_url: data.cover_xl || data.cover_big || data.cover_medium || data.cover || null,
      release_date: data.release_date || '',
      total_tracks: data.nb_tracks || 0,
      album_type: data.record_type || 'album',
    }

    // Fetch tracks (if not in initial album response or if paginated)
    let rawTracks: any[] = data.tracks?.data || []
    if (rawTracks.length < (data.nb_tracks || 0) && data.nb_tracks > 25) {
      try {
        const tracksRes = await fetch(`https://api.deezer.com/album/${encodeURIComponent(cleanId)}/tracks?limit=100`, {
          next: { revalidate: 3600 },
        })
        if (tracksRes.ok) {
          const tData = await tracksRes.json()
          if (tData.data && tData.data.length > 0) {
            rawTracks = tData.data
          }
        }
      } catch (tErr) {
        console.warn('Deezer album tracks pagination fetch error:', tErr)
      }
    }

    const systemUserId = '00000000-0000-4000-a000-000000000001'

    const tracks: Track[] = rawTracks.map((item: any, idx: number) => ({
      id: `deezer-${item.id}`,
      user_id: systemUserId,
      title: item.title || item.title_short || 'Untitled Track',
      artist: item.artist?.name || meta.artist,
      album: meta.name,
      spotify_album_id: meta.id,
      disc_number: item.disk_number || 1,
      track_number: item.track_position || idx + 1,
      duration: Math.round(item.duration || 0),
      file_path: item.preview || item.link || `deezer:${item.id}`,
      audio_url: item.preview || undefined,
      cover_url: meta.cover_url,
      created_at: new Date().toISOString(),
      source: 'spotify', // Seamless audio engine handling
      spotify_id: String(item.id),
    }))

    return { meta, tracks }
  } catch (err) {
    console.error('Deezer album tracks fetch error:', err)
    return null
  }
}

/**
 * 🔥 Fetch Deezer Global Chart Top Tracks (Trending)
 * GET https://api.deezer.com/chart/0/tracks
 */
export async function getTrendingDeezerTracks(limit = 16): Promise<Track[]> {
  try {
    const safeLimit = Math.min(limit, 50)
    const res = await fetch(`https://api.deezer.com/chart/0/tracks?limit=${safeLimit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []

    const data = await res.json()
    const items = data.data || []
    const systemUserId = '00000000-0000-4000-a000-000000000001'

    return items
      .filter((item: any) => item && item.id && (item.title || item.title_short))
      .map((item: any) => ({
        id: `deezer-${item.id}`,
        user_id: systemUserId,
        title: item.title || item.title_short || 'Untitled Track',
        artist: item.artist?.name || 'Nghệ sĩ chưa xác định',
        album: item.album?.title || undefined,
        duration: Math.round(item.duration || 0),
        file_path: item.preview || item.link || `deezer:${item.id}`,
        audio_url: item.preview || undefined,
        cover_url: item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || item.album?.cover || null,
        created_at: new Date().toISOString(),
        source: 'spotify', // Seamless audio engine handling
        spotify_id: String(item.id),
      }))
  } catch (err) {
    console.warn('Deezer trending fetch error:', err)
    return []
  }
}

/**
 * 🔍 Search Deezer Global Tracks
 * GET https://api.deezer.com/search?q=...
 */
export async function searchDeezerTracks(query: string, limit = 15): Promise<Track[]> {
  const cleanQuery = query.trim()
  if (!cleanQuery) return []
  try {
    const safeLimit = Math.min(limit, 50)
    const res = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(cleanQuery)}&limit=${safeLimit}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(4000),
        next: { revalidate: 300 },
      }
    )
    if (!res.ok) return []

    const data = await res.json()
    const items = data.data || []
    const systemUserId = '00000000-0000-4000-a000-000000000001'

    return items
      .filter((item: any) => item && item.id && (item.title || item.title_short))
      .map((item: any) => ({
        id: `deezer-${item.id}`,
        user_id: systemUserId,
        title: item.title || item.title_short || 'Untitled Track',
        artist: item.artist?.name || 'Nghệ sĩ chưa xác định',
        album: item.album?.title || undefined,
        duration: Math.round(item.duration || 0),
        file_path: item.preview || item.link || `deezer:${item.id}`,
        audio_url: item.preview || undefined,
        cover_url: item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || item.album?.cover || null,
        created_at: new Date().toISOString(),
        source: 'spotify', // Seamless audio engine handling
        spotify_id: String(item.id),
      }))
  } catch (err) {
    console.warn('Deezer search error:', err)
    return []
  }
}

function mapDeezerAlbums(items: any[]): DeezerAlbumItem[] {
  return items
    .filter((item: any) => item && item.id && (item.title || item.name))
    .map((item: any) => ({
      id: String(item.id),
      name: item.title || item.name,
      artist: item.artist?.name || 'Nghệ sĩ chưa xác định',
      cover_url: item.cover_xl || item.cover_big || item.cover_medium || item.cover || null,
      release_date: item.release_date || '',
      total_tracks: item.nb_tracks || 0,
      album_type: item.record_type || 'album',
    }))
}

/**
 * Find Deezer Artist ID by Name
 */
export async function searchDeezerArtist(artistName: string): Promise<{ id: number; name: string } | null> {
  if (!artistName || !artistName.trim()) return null
  try {
    const cleanName = artistName.replace(/[\(\[\{].*?[\)\]\}]/g, '').trim()
    const res = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(cleanName)}&limit=1`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      next: { revalidate: 86400 },
    })

    if (res.ok) {
      const data = await res.json()
      if (data.data && data.data.length > 0) {
        return {
          id: data.data[0].id,
          name: data.data[0].name,
        }
      }
    }
  } catch (err) {
    console.warn('Deezer artist search error:', err)
  }
  return null
}

/**
 * 📻 Fetch Deezer Artist Radio Tracks (Direct similarity recommendation)
 * GET https://api.deezer.com/artist/{artist_id}/radio
 */
export async function getDeezerArtistRadio(artistName: string, limit = 25): Promise<QueueTrack[]> {
  const artist = await searchDeezerArtist(artistName)
  if (!artist) return []

  try {
    const res = await fetch(`https://api.deezer.com/artist/${artist.id}/radio?limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      next: { revalidate: 1800 },
    })

    if (res.ok) {
      const data = await res.json()
      const items = data.data || []
      return mapDeezerTracksToQueue(items, 'deezer_artist_radio', 1.0)
    }
  } catch (err) {
    console.warn('Deezer radio fetch error:', err)
  }
  return []
}

/**
 * 👥 Fetch Related Artists & their Top Tracks
 * GET https://api.deezer.com/artist/{artist_id}/related
 * GET https://api.deezer.com/artist/{related_id}/top?limit=10
 */
export async function getDeezerRelatedArtistsTopTracks(artistName: string, limit = 25): Promise<QueueTrack[]> {
  const artist = await searchDeezerArtist(artistName)
  if (!artist) return []

  try {
    const res = await fetch(`https://api.deezer.com/artist/${artist.id}/related?limit=5`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      next: { revalidate: 86400 },
    })

    if (res.ok) {
      const data = await res.json()
      const relatedArtists = data.data || []
      if (relatedArtists.length === 0) return []

      const trackPromises = relatedArtists.map(async (rel: any) => {
        try {
          const topRes = await fetch(`https://api.deezer.com/artist/${rel.id}/top?limit=6`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            next: { revalidate: 3600 },
          })
          if (topRes.ok) {
            const topData = await topRes.json()
            return topData.data || []
          }
        } catch {
          return []
        }
        return []
      })

      const trackArrays = await Promise.all(trackPromises)
      const combined = trackArrays.flat()
      return mapDeezerTracksToQueue(combined.slice(0, limit), 'deezer_related_artist_top', 0.8)
    }
  } catch (err) {
    console.warn('Deezer related artists error:', err)
  }
  return []
}

/**
 * 🔝 Fallback: Top Tracks of Seed Artist
 * GET https://api.deezer.com/artist/{artist_id}/top?limit=10
 */
export async function getDeezerArtistTopTracks(artistName: string, limit = 15): Promise<QueueTrack[]> {
  const artist = await searchDeezerArtist(artistName)
  if (!artist) return []

  try {
    const res = await fetch(`https://api.deezer.com/artist/${artist.id}/top?limit=${limit}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      next: { revalidate: 3600 },
    })

    if (res.ok) {
      const data = await res.json()
      const items = data.data || []
      return mapDeezerTracksToQueue(items, 'deezer_artist_top_fallback', 0.7)
    }
  } catch (err) {
    console.warn('Deezer top tracks error:', err)
  }
  return []
}

function mapDeezerTracksToQueue(rawTracks: any[], reason: string, initialScore: number): QueueTrack[] {
  return (rawTracks || [])
    .filter((item: any) => item && item.id && (item.title || item.title_short))
    .map((item: any) => {
      const sourceId = String(item.id)
      return {
        id: `deezer-${sourceId}`,
        title: item.title || item.title_short || 'Untitled Track',
        artist: item.artist?.name || 'Nghệ sĩ chưa xác định',
        album: item.album?.title || undefined,
        cover_url: item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || item.album?.cover || null,
        duration: Math.round(item.duration || 0),
        isrc: item.isrc ? String(item.isrc).trim().toUpperCase() : undefined,
        source: 'deezer',
        source_id: sourceId,
        preview_url: item.preview || undefined,
        score: initialScore,
        score_reasons: [reason],
      }
    })
}

