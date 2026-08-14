import {
  SoundCloudRawTrack,
  isSoundCloudFullAudio,
  soundCloudTrackToAppTrack,
  getBestSoundCloudTranscoding,
  getSoundCloudHighResArtwork,
} from './soundcloud'
import { Track, SoundCloudPlaylist } from '@/types'

// Cache client_id in memory with 2-hour TTL
let cachedClientId: string | null = null
let clientIdExpiresAt: number = 0

// In-memory stream URL cache (2-hour TTL)
const streamUrlCache = new Map<string, { url: string; expiresAt: number }>()

// In-memory track metadata cache (1-hour TTL)
const trackMetadataCache = new Map<
  string,
  { track: Track; raw: SoundCloudRawTrack; expiresAt: number }
>()

// Fallback known public client IDs
const FALLBACK_CLIENT_IDS = [
  'UMY1dzQ68n2QbCuypNe8JOivmV2FO2Ep',
  'nXIZT4VQQYkgHs75vpIYbnINQciCkV5Y',
  'iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX',
]

/**
 * Dynamically retrieves or extracts a valid SoundCloud Client ID
 */
export async function getSoundCloudClientId(): Promise<string> {
  const envId = process.env.SOUNDCLOUD_CLIENT_ID?.trim()
  if (envId) return envId

  const now = Date.now()
  if (cachedClientId && now < clientIdExpiresAt) {
    return cachedClientId
  }

  // 1. Try to extract latest client_id dynamically from soundcloud.com web bundle
  try {
    const htmlRes = await fetch('https://soundcloud.com', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      next: { revalidate: 3600 },
    })

    if (htmlRes.ok) {
      const html = await htmlRes.text()
      const scriptUrls = [...html.matchAll(/<script[^>]+src="([^">]+\.js)"/g)].map((m) => m[1])

      // Look into the last 6 bundle scripts
      for (const sUrl of scriptUrls.slice(-8).reverse()) {
        try {
          const sRes = await fetch(sUrl)
          if (sRes.ok) {
            const js = await sRes.text()
            const match = js.match(/client_id[:=]\s*["']([a-zA-Z0-9]{32})["']/)
            if (match && match[1]) {
              cachedClientId = match[1]
              clientIdExpiresAt = now + 2 * 60 * 60 * 1000 // 2 hours TTL
              return cachedClientId
            }
          }
        } catch {
          // ignore individual script failure
        }
      }
    }
  } catch (err) {
    console.warn('[SoundCloud] Failed dynamic client_id extraction:', err)
  }

  // 2. Fallback to candidate list
  cachedClientId = FALLBACK_CLIENT_IDS[0]
  clientIdExpiresAt = now + 15 * 60 * 1000 // 15 mins TTL
  return cachedClientId
}

/**
 * Resolves any SoundCloud URL (Track or Playlist, including on.soundcloud.com shortlinks)
 */
export async function resolveSoundCloudUrl(inputUrl: string): Promise<Track[]> {
  let targetUrl = inputUrl.trim()
  if (!targetUrl) return []

  // If short link on.soundcloud.com, follow redirect to extract canonical permalink
  if (targetUrl.includes('on.soundcloud.com')) {
    try {
      const headRes = await fetch(targetUrl, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      })
      if (headRes.url && headRes.url.includes('soundcloud.com')) {
        targetUrl = headRes.url
      }
    } catch (e) {
      console.warn('[SoundCloud] Failed to expand shortlink:', e)
    }
  }

  const clientId = await getSoundCloudClientId()
  const resolveApi = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(
    targetUrl
  )}&client_id=${clientId}`

  try {
    const res = await fetch(resolveApi, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      next: { revalidate: 3600 },
    })

    if (!res.ok) {
      console.warn(`[SoundCloud] URL Resolve returned ${res.status}`)
      return []
    }

    const data = await res.json()

    // 1. If it resolved to a Playlist / Album
    if (data.kind === 'playlist' || Array.isArray(data.tracks)) {
      const rawTracksList: any[] = data.tracks || []
      return resolveAllPlaylistTracks(rawTracksList, clientId)
    }

    // 2. If it resolved to a User Profile Page (e.g. soundcloud.com/vanhung03042)
    if (data.kind === 'user' && data.id) {
      try {
        const userTracksUrl = `https://api-v2.soundcloud.com/users/${data.id}/tracks?client_id=${clientId}&limit=50&access=playable`
        const userRes = await fetch(userTracksUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'application/json',
          },
          next: { revalidate: 600 },
        })

        if (userRes.ok) {
          const userTracksData = await userRes.json()
          const rawTracks: SoundCloudRawTrack[] = Array.isArray(userTracksData)
            ? userTracksData
            : userTracksData.collection || []
          return rawTracks.filter(isSoundCloudFullAudio).map(soundCloudTrackToAppTrack)
        }
      } catch (userErr) {
        console.error('[SoundCloud] Failed to fetch user profile tracks:', userErr)
      }
    }

    // 3. If it resolved to a single Track
    if (isSoundCloudFullAudio(data)) {
      return [soundCloudTrackToAppTrack(data)]
    }

    return []
  } catch (err) {
    console.error('[SoundCloud] URL Resolve error:', err)
    return []
  }
}

/**
 * Resolves full SoundCloud playlist metadata and all tracks from any playlist URL or shortlink
 */
export async function resolveSoundCloudPlaylistUrl(
  inputUrl: string
): Promise<{ playlist: SoundCloudPlaylist; tracks: Track[] } | null> {
  let targetUrl = inputUrl.trim()
  if (!targetUrl) return null

  // If short link on.soundcloud.com, follow redirect
  if (targetUrl.includes('on.soundcloud.com')) {
    try {
      const headRes = await fetch(targetUrl, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      })
      if (headRes.url && headRes.url.includes('soundcloud.com')) {
        targetUrl = headRes.url
      }
    } catch (e) {
      console.warn('[SoundCloud] Failed to expand shortlink:', e)
    }
  }

  const clientId = await getSoundCloudClientId()
  const resolveApi = `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(
    targetUrl
  )}&client_id=${clientId}`

  try {
    const res = await fetch(resolveApi, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      next: { revalidate: 3600 },
    })

    if (!res.ok) return null
    const pl = await res.json()

    // Must be a playlist or have a collection of tracks
    if (pl.kind !== 'playlist' && !Array.isArray(pl.tracks)) {
      return null
    }

    const fullAudioTracks = await resolveAllPlaylistTracks(pl.tracks || [], clientId)
    const rawArt = pl.artwork_url || pl.tracks?.[0]?.artwork_url || pl.user?.avatar_url
    const highResArt = getSoundCloudHighResArtwork(rawArt)

    const playlist: SoundCloudPlaylist = {
      id: pl.id,
      title: pl.title || 'SoundCloud Playlist',
      artwork_url: highResArt,
      track_count: fullAudioTracks.length,
      duration: pl.duration ? Math.round(pl.duration / 1000) : 0,
      permalink_url: pl.permalink_url,
      user: {
        id: pl.user?.id,
        username: pl.user?.username || 'SoundCloud Creator',
        avatar_url: getSoundCloudHighResArtwork(pl.user?.avatar_url) || undefined,
      },
      is_album: !!pl.is_album,
      tracks: fullAudioTracks,
    }

    return { playlist, tracks: fullAudioTracks }
  } catch (err) {
    console.error('[SoundCloud] Failed to resolve playlist URL:', err)
    return null
  }
}

/**
 * Resolves all tracks from a SoundCloud playlist response, including batch-fetching
 * any stub track items ({ id: ... }) that SoundCloud only partially returned.
 */
async function resolveAllPlaylistTracks(
  rawTracksList: any[],
  clientId: string
): Promise<Track[]> {
  if (!Array.isArray(rawTracksList) || rawTracksList.length === 0) return []

  const initialFullTracks: SoundCloudRawTrack[] = rawTracksList.filter(
    (t) => t && t.title && t.media
  )
  const stubTrackIds: (number | string)[] = rawTracksList
    .filter((t) => t && !t.title && t.id)
    .map((t) => t.id)

  const fetchedTracks: SoundCloudRawTrack[] = []

  // Batch fetch stub tracks in chunks of 50
  if (stubTrackIds.length > 0) {
    for (let i = 0; i < stubTrackIds.length; i += 50) {
      const chunk = stubTrackIds.slice(i, i + 50)
      const idsParam = chunk.join('%2C')
      const tracksApi = `https://api-v2.soundcloud.com/tracks?ids=${idsParam}&client_id=${clientId}`
      try {
        const chunkRes = await fetch(tracksApi, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'application/json',
          },
          next: { revalidate: 600 },
        })
        if (chunkRes.ok) {
          const chunkData = await chunkRes.json()
          if (Array.isArray(chunkData)) {
            fetchedTracks.push(...chunkData)
          }
        }
      } catch (err) {
        console.warn('[SoundCloud] Failed to batch fetch stub tracks chunk:', err)
      }
    }
  }

  // Merge while strictly preserving the original playlist track order
  const trackMap = new Map<string | number, SoundCloudRawTrack>()
  initialFullTracks.forEach((t) => trackMap.set(t.id, t))
  fetchedTracks.forEach((t) => trackMap.set(t.id, t))

  const allOrderedTracks: SoundCloudRawTrack[] = rawTracksList
    .map((t) => (t && t.id ? trackMap.get(t.id) : null))
    .filter(Boolean) as SoundCloudRawTrack[]

  return allOrderedTracks.filter(isSoundCloudFullAudio).map(soundCloudTrackToAppTrack)
}

/**
 * Search SoundCloud tracks by query or URL, filtering only full-audio results
 */
export async function searchSoundCloudTracks(
  query: string,
  limit: number = 50,
  offset: number = 0
): Promise<Track[]> {
  const trimmed = query?.trim()
  if (!trimmed) return []

  // If query is a SoundCloud link, resolve it directly!
  if (
    trimmed.includes('soundcloud.com/') ||
    trimmed.includes('on.soundcloud.com/') ||
    trimmed.startsWith('https://soundcloud.app.goo.gl')
  ) {
    return resolveSoundCloudUrl(trimmed)
  }

  const clientId = await getSoundCloudClientId()
  const fetchLimit = Math.min(Math.max(limit * 2, 30), 100)

  const url = `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(
    trimmed
  )}&client_id=${clientId}&limit=${fetchLimit}&offset=${offset}&access=playable`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      next: { revalidate: 300 }, // Cache search queries for 5 mins
    })

    if (!res.ok) {
      console.warn(`[SoundCloud] Search failed with status ${res.status}`)
      return []
    }

    const data = await res.json()
    const rawTracks: SoundCloudRawTrack[] = data.collection || []

    // Strict Full Audio Filter
    const fullAudioTracks = rawTracks.filter(isSoundCloudFullAudio)

    return fullAudioTracks.slice(0, limit).map(soundCloudTrackToAppTrack)
  } catch (err) {
    console.error('[SoundCloud] Search error:', err)
    return []
  }
}

/**
 * Fetch popular / explore tracks by genre or topic tag
 */
export async function getSoundCloudExploreTracks(
  genreOrTag: string = 'all-music',
  limit: number = 20
): Promise<Track[]> {
  const queryTag = genreOrTag === 'all-music' ? 'vietnam' : genreOrTag
  return searchSoundCloudTracks(queryTag, limit)
}

/**
 * Resolves full track metadata by SoundCloud ID
 */
export async function resolveSoundCloudTrack(
  trackId: string | number
): Promise<{ track: Track; raw: SoundCloudRawTrack } | null> {
  const rawId = String(trackId).replace(/^sc-/, '')
  const now = Date.now()

  // 1. Check in-memory track cache
  const cached = trackMetadataCache.get(rawId)
  if (cached && now < cached.expiresAt) {
    return { track: cached.track, raw: cached.raw }
  }

  const clientId = await getSoundCloudClientId()
  const url = `https://api-v2.soundcloud.com/tracks/${rawId}?client_id=${clientId}`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      next: { revalidate: 3600 },
    })

    if (!res.ok) return null

    const raw: SoundCloudRawTrack = await res.json()
    if (!isSoundCloudFullAudio(raw)) return null

    const appTrack = soundCloudTrackToAppTrack(raw)
    trackMetadataCache.set(rawId, {
      track: appTrack,
      raw,
      expiresAt: now + 60 * 60 * 1000, // 1 hour TTL
    })

    return {
      track: appTrack,
      raw,
    }
  } catch (err) {
    console.error(`[SoundCloud] Failed to resolve track ${trackId}:`, err)
    return null
  }
}

/**
 * Resolves stream URL for a given track ID
 */
export async function resolveSoundCloudStreamUrl(
  trackId: string | number
): Promise<string | null> {
  const rawId = String(trackId).replace(/^sc-/, '')
  const now = Date.now()

  // 1. Check in-memory stream cache (instant hit <1ms)
  const cachedStream = streamUrlCache.get(rawId)
  if (cachedStream && now < cachedStream.expiresAt) {
    return cachedStream.url
  }

  const resolved = await resolveSoundCloudTrack(rawId)
  if (!resolved || !resolved.raw) return null

  const transcoding = getBestSoundCloudTranscoding(resolved.raw)
  if (!transcoding?.url) return null

  const clientId = await getSoundCloudClientId()
  const resolveUrl = `${transcoding.url}?client_id=${clientId}`

  try {
    const res = await fetch(resolveUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    })

    if (!res.ok) return null

    const data = await res.json()
    const streamUrl = data.url || null

    if (streamUrl) {
      // Cache stream URL in memory for 2 hours (SoundCloud signed media tokens last ~4 hours)
      streamUrlCache.set(rawId, {
        url: streamUrl,
        expiresAt: now + 2 * 60 * 60 * 1000,
      })
    }

    return streamUrl
  } catch (err) {
    console.error(`[SoundCloud] Failed to resolve stream for ${trackId}:`, err)
    return null
  }
}

/**
 * Search SoundCloud playlists / albums by query or genre
 */
export async function searchSoundCloudPlaylists(
  query: string,
  limit: number = 8
): Promise<SoundCloudPlaylist[]> {
  const trimmed = query?.trim()
  if (!trimmed) return []

  const clientId = await getSoundCloudClientId()
  const url = `https://api-v2.soundcloud.com/search/playlists?q=${encodeURIComponent(
    trimmed
  )}&client_id=${clientId}&limit=${limit}&access=playable`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      next: { revalidate: 600 },
    })

    if (!res.ok) return []
    const data = await res.json()
    const rawList = data.collection || []

    return rawList.map((pl: any): SoundCloudPlaylist => {
      const rawArt = pl.artwork_url || pl.tracks?.[0]?.artwork_url || pl.user?.avatar_url
      const highResArt = getSoundCloudHighResArtwork(rawArt)

      return {
        id: pl.id,
        title: pl.title || 'SoundCloud Playlist',
        artwork_url: highResArt,
        track_count: pl.track_count || (Array.isArray(pl.tracks) ? pl.tracks.length : 0),
        duration: pl.duration ? Math.round(pl.duration / 1000) : 0,
        permalink_url: pl.permalink_url,
        user: {
          id: pl.user?.id,
          username: pl.user?.username || 'SoundCloud Creator',
          avatar_url: getSoundCloudHighResArtwork(pl.user?.avatar_url) || undefined,
        },
        is_album: !!pl.is_album,
      }
    })
  } catch (err) {
    console.error('[SoundCloud] Search playlists error:', err)
    return []
  }
}

/**
 * Fetch full tracklist for a specific SoundCloud playlist ID
 */
export async function getSoundCloudPlaylistTracks(
  playlistId: string | number
): Promise<{ playlist: SoundCloudPlaylist; tracks: Track[] } | null> {
  const rawId = String(playlistId).replace(/^sc-pl-/, '')
  const clientId = await getSoundCloudClientId()
  const url = `https://api-v2.soundcloud.com/playlists/${rawId}?client_id=${clientId}`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      next: { revalidate: 600 },
    })

    if (!res.ok) return null
    const pl = await res.json()
    const fullAudioTracks = await resolveAllPlaylistTracks(pl.tracks || [], clientId)

    const rawArt = pl.artwork_url || pl.tracks?.[0]?.artwork_url || pl.user?.avatar_url
    const highResArt = getSoundCloudHighResArtwork(rawArt)

    const playlist: SoundCloudPlaylist = {
      id: pl.id,
      title: pl.title || 'SoundCloud Playlist',
      artwork_url: highResArt,
      track_count: fullAudioTracks.length,
      duration: pl.duration ? Math.round(pl.duration / 1000) : 0,
      permalink_url: pl.permalink_url,
      user: {
        id: pl.user?.id,
        username: pl.user?.username || 'SoundCloud Creator',
        avatar_url: getSoundCloudHighResArtwork(pl.user?.avatar_url) || undefined,
      },
      is_album: !!pl.is_album,
      tracks: fullAudioTracks,
    }

    return { playlist, tracks: fullAudioTracks }
  } catch (err) {
    console.error(`[SoundCloud] Failed to get playlist ${playlistId}:`, err)
    return null
  }
}
