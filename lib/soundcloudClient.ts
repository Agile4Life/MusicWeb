import {
  SoundCloudRawTrack,
  isSoundCloudFullAudio,
  soundCloudTrackToAppTrack,
  getBestSoundCloudTranscoding,
  getSoundCloudHighResArtwork,
} from './soundcloud'
import { Track, SoundCloudPlaylist } from '@/types'

// Cache client_id in memory with 15-minute TTL
let cachedClientId: string | null = null
let clientIdExpiresAt: number = 0
let inFlightClientIdPromise: Promise<string> | null = null

// [FIX #2] Track a *separate* in-flight promise for forced refreshes so a
// forceRefresh=true caller never receives a stale (non-forced) in-flight
// result. Previously, if a normal (non-force) fetch was already in-flight,
// a concurrent forceRefresh call would just `return inFlightClientIdPromise`
// and silently get the OLD client_id back — defeating the whole point of
// forcing a refresh after a 401/403.
let inFlightForceRefreshPromise: Promise<string> | null = null

// In-memory stream URL cache (15-minute TTL)
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

// [FIX #3] Index into FALLBACK_CLIENT_IDS. Previously the code always used
// FALLBACK_CLIENT_IDS[0] — the other two entries were dead code. Now we
// rotate to the next candidate whenever the current one is invalidated
// (see invalidateFallbackClientId()).
let fallbackClientIdIndex = 0

function getCurrentFallbackClientId(): string {
  const id = FALLBACK_CLIENT_IDS[fallbackClientIdIndex % FALLBACK_CLIENT_IDS.length]
  if (!id) {
    throw new Error('[SoundCloud] No fallback client_id available')
  }
  return id
}

/** Advance to the next fallback client_id candidate (called after a 401/403). */
function rotateFallbackClientId(): void {
  fallbackClientIdIndex = (fallbackClientIdIndex + 1) % FALLBACK_CLIENT_IDS.length
}

/**
 * Fetch wrapper with AbortController timeout to prevent hanging connections
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { next?: { revalidate?: number } } = {},
  ms = 8000
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

const SC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * Attempts to dynamically extract a fresh client_id from the soundcloud.com
 * web bundle. Returns null on any failure (never throws).
 */
async function scrapeClientIdFromWeb(): Promise<string | null> {
  try {
    const htmlRes = await fetchWithTimeout(
      'https://soundcloud.com',
      {
        headers: {
          'User-Agent': SC_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
        next: { revalidate: 3600 },
      },
      6000
    )
    if (!htmlRes.ok) return null
    const html = await htmlRes.text()
    const scriptUrls = [...html.matchAll(/<script[^>]+src="([^">]+\.js)"/g)].map((m) => m[1])
    const targetScripts = scriptUrls.slice(-8).reverse()
    const results = await Promise.allSettled(
      targetScripts.map(async (sUrl) => {
        const sRes = await fetchWithTimeout(sUrl, {}, 5000)
        if (!sRes.ok) return null
        const js = await sRes.text()
        const match = js.match(/client_id[:=]\s*["']([a-zA-Z0-9]{32})["']/)
        return match?.[1] || null
      })
    )
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) return r.value
    }
    return null
  } catch (err) {
    console.warn('[SoundCloud] Failed dynamic client_id extraction:', err)
    return null
  }
}

/**
 * Dynamically retrieves or extracts a valid SoundCloud Client ID with
 * in-flight deduplication. Pass forceRefresh=true to bypass the TTL cache
 * (e.g. after receiving a 401/403 from SoundCloud).
 *
 * [FIX #2] forceRefresh now ALWAYS performs (or awaits) a dedicated forced
 * fetch instead of possibly returning a stale in-flight non-forced result.
 */
export async function getSoundCloudClientId(forceRefresh = false): Promise<string> {
  const envId = process.env.SOUNDCLOUD_CLIENT_ID?.trim()
  if (envId) return envId

  const now = Date.now()
  if (!forceRefresh) {
    if (cachedClientId && now < clientIdExpiresAt) {
      return cachedClientId
    }
    if (inFlightClientIdPromise) {
      return inFlightClientIdPromise
    }
  } else if (inFlightForceRefreshPromise) {
    // A forced refresh is already in progress — await that one instead of
    // starting a duplicate scrape.
    return inFlightForceRefreshPromise
  }

  const runFetch = async (): Promise<string> => {
    const scraped = await scrapeClientIdFromWeb()
    if (scraped) {
      cachedClientId = scraped
      clientIdExpiresAt = Date.now() + 15 * 60 * 1000 // 15 mins TTL
      fallbackClientIdIndex = 0 // reset fallback rotation once we have a real scraped id
      return cachedClientId
    }
    // [FIX #3] Use (and rotate through) the fallback candidate list instead
    // of always using FALLBACK_CLIENT_IDS[0].
    const fallback = getCurrentFallbackClientId()
    cachedClientId = fallback
    clientIdExpiresAt = Date.now() + 15 * 60 * 1000
    return cachedClientId
  }

  if (forceRefresh) {
    // On a forced refresh caused by a 401/403, also rotate the fallback
    // candidate so a repeatedly-revoked hardcoded id isn't retried forever.
    rotateFallbackClientId()
    inFlightForceRefreshPromise = runFetch()
    try {
      return await inFlightForceRefreshPromise
    } finally {
      inFlightForceRefreshPromise = null
    }
  }

  inFlightClientIdPromise = runFetch()
  try {
    return await inFlightClientIdPromise
  } finally {
    inFlightClientIdPromise = null
  }
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
      const headRes = await fetchWithTimeout(
        targetUrl,
        {
          method: 'HEAD',
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        },
        5000
      )
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
    const res = await fetchWithTimeout(
      resolveApi,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        next: { revalidate: 3600 },
      },
      8000
    )

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
        const userRes = await fetchWithTimeout(
          userTracksUrl,
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              Accept: 'application/json',
            },
            next: { revalidate: 600 },
          },
          8000
        )

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
      const headRes = await fetchWithTimeout(
        targetUrl,
        {
          method: 'HEAD',
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
        },
        5000
      )
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
    const res = await fetchWithTimeout(
      resolveApi,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        next: { revalidate: 3600 },
      },
      8000
    )

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
    .filter((t) => t && t.id && !t.media) // [FIX #6] was: !t.title && t.id
    .map((t) => t.id)

  const fetchedTracks: SoundCloudRawTrack[] = []

  // Batch fetch stub tracks in chunks of 50
  if (stubTrackIds.length > 0) {
    for (let i = 0; i < stubTrackIds.length; i += 50) {
      const chunk = stubTrackIds.slice(i, i + 50)
      const idsParam = chunk.join('%2C')
      const tracksApi = `https://api-v2.soundcloud.com/tracks?ids=${idsParam}&client_id=${clientId}`
      try {
        const chunkRes = await fetchWithTimeout(
          tracksApi,
          {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              Accept: 'application/json',
            },
            next: { revalidate: 600 },
          },
          8000
        )
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
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        next: { revalidate: 300 }, // Cache search queries for 5 mins
      },
      8000
    )

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
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        next: { revalidate: 3600 },
      },
      8000
    )

    if (!res.ok) return null

    const raw: SoundCloudRawTrack = await res.json()
    if (!isSoundCloudFullAudio(raw)) return null

    const appTrack = soundCloudTrackToAppTrack(raw)
    trackMetadataCache.set(rawId, {
      track: appTrack,
      raw,
      expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour TTL
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
 * Resolves stream URL for a given track ID with 401/403 invalidation and retry
 */
export async function resolveSoundCloudStreamUrl(
  trackId: string | number,
  bypassCache = false
): Promise<string | null> {
  const rawId = String(trackId).replace(/^sc-/, '')
  const now = Date.now()

  // 1. Check in-memory stream cache
  if (bypassCache) {
    streamUrlCache.delete(rawId)
  } else {
    const cachedStream = streamUrlCache.get(rawId)
    if (cachedStream && now < cachedStream.expiresAt) {
      return cachedStream.url
    }
  }

  const resolved = await resolveSoundCloudTrack(rawId)
  if (!resolved || !resolved.raw) return null

  const transcoding = getBestSoundCloudTranscoding(resolved.raw)
  if (!transcoding?.url) return null

  let clientId = await getSoundCloudClientId()
  let resolveUrl = `${transcoding.url}?client_id=${clientId}`

  try {
    let res = await fetchWithTimeout(
      resolveUrl,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      },
      6000
    )

    // Invalidate client_id and retry once if SoundCloud revoked it (401 or 403)
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      console.warn(`[SoundCloud] resolve stream returned ${res.status}, refreshing client_id...`)
      cachedClientId = null
      clientIdExpiresAt = 0
      clientId = await getSoundCloudClientId(true)
      resolveUrl = `${transcoding.url}?client_id=${clientId}`
      res = await fetchWithTimeout(
        resolveUrl,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'application/json',
          },
        },
        6000
      )
    }

    if (!res.ok) return null

    const data = await res.json()
    const streamUrl = data.url || null

    if (streamUrl) {
      // Cache stream URL in memory for 15 minutes (900s)
      streamUrlCache.set(rawId, {
        url: streamUrl,
        expiresAt: Date.now() + 15 * 60 * 1000,
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
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        next: { revalidate: 600 },
      },
      8000
    )

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
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        next: { revalidate: 600 },
      },
      8000
    )

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
