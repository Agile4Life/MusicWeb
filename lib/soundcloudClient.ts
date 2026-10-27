import {
  SoundCloudRawTrack,
  isSoundCloudFullAudio,
  soundCloudTrackToAppTrack,
  getBestSoundCloudTranscoding,
  getSoundCloudHighResArtwork,
} from './soundcloud'
import { Track, SoundCloudPlaylist } from '@/types'

interface SoundCloudGlobalState {
  cachedClientId: string | null
  clientIdExpiresAt: number
  inFlightClientIdPromise: Promise<string> | null
  inFlightForceRefreshPromise: Promise<string> | null
  fallbackClientIdIndex: number
  streamUrlCache: Map<string, { url: string; expiresAt: number }>
  inFlightSoundCloudStream: Map<string, Promise<string | null>>
  trackMetadataCache: Map<
    string,
    { track: Track; raw: SoundCloudRawTrack; expiresAt: number }
  >
  permalinkIdCache: Map<string, { id: string; expiresAt: number }>
  hlsManifestCache: Map<string, { info: SoundCloudHlsManifestInfo; expiresAt: number }>
  hlsMediaBufferCache: Map<
    string,
    { buffer: Uint8Array; contentType: string; expiresAt: number }
  >
  inFlightHlsMediaBuffer: Map<
    string,
    Promise<{ buffer: Uint8Array; contentType: string } | null>
  >
}

const globalForSoundCloud = globalThis as unknown as {
  __musicWebSoundCloudState?: SoundCloudGlobalState
}

const scState: SoundCloudGlobalState =
  globalForSoundCloud.__musicWebSoundCloudState ??
  (globalForSoundCloud.__musicWebSoundCloudState = {
    cachedClientId: null,
    clientIdExpiresAt: 0,
    inFlightClientIdPromise: null,
    inFlightForceRefreshPromise: null,
    fallbackClientIdIndex: 0,
    streamUrlCache: new Map(),
    inFlightSoundCloudStream: new Map(),
    trackMetadataCache: new Map(),
    permalinkIdCache: new Map(),
    hlsManifestCache: new Map(),
    hlsMediaBufferCache: new Map(),
    inFlightHlsMediaBuffer: new Map(),
  })

const streamUrlCache = scState.streamUrlCache
const inFlightSoundCloudStream = scState.inFlightSoundCloudStream
const trackMetadataCache = scState.trackMetadataCache
const permalinkIdCache = scState.permalinkIdCache
const hlsManifestCache = scState.hlsManifestCache

function cacheRawTrackMetadata(raw: SoundCloudRawTrack, appTrack?: Track): Track {
  const mapped = appTrack ?? soundCloudTrackToAppTrack(raw)
  const now = Date.now()
  if (raw?.id) {
    const cleanId = String(raw.id)
    trackMetadataCache.set(cleanId, {
      track: mapped,
      raw,
      expiresAt: now + 60 * 60 * 1000,
    })
    if (raw.permalink_url) {
      permalinkIdCache.set(raw.permalink_url.trim().replace(/\/+$/, ''), {
        id: cleanId,
        expiresAt: now + 60 * 60 * 1000,
      })
    }
  }
  return mapped
}

// Fallback known public client IDs
const FALLBACK_CLIENT_IDS = [
  'UMY1dzQ68n2QbCuypNe8JOivmV2FO2Ep',
  'nXIZT4VQQYkgHs75vpIYbnINQciCkV5Y',
  'iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX',
]

function getCurrentFallbackClientId(): string {
  const id = FALLBACK_CLIENT_IDS[scState.fallbackClientIdIndex % FALLBACK_CLIENT_IDS.length]
  if (!id) {
    throw new Error('[SoundCloud] No fallback client_id available')
  }
  return id
}

/** Advance to the next fallback client_id candidate (called after a 401/403). */
function rotateFallbackClientId(): void {
  scState.fallbackClientIdIndex =
    (scState.fallbackClientIdIndex + 1) % FALLBACK_CLIENT_IDS.length
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
  const externalSignal = options.signal
  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
  }
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort)
    }
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
      5000
    )
    if (!htmlRes.ok) return null
    const html = await htmlRes.text()
    const scriptUrls = [...html.matchAll(/<script[^>]+src="([^">]+\.js)"/g)].map((m) => m[1])
    const targetScripts = scriptUrls.slice(-8).reverse()
    if (targetScripts.length === 0) return null

    const bundleAbort = new AbortController()
    try {
      const found = await Promise.any(
        targetScripts.map(async (sUrl) => {
          const sRes = await fetchWithTimeout(
            sUrl,
            { signal: bundleAbort.signal },
            4500
          )
          if (!sRes.ok) throw new Error(`Bundle HTTP ${sRes.status}`)
          const js = await sRes.text()
          const match = js.match(/client_id[:=]\s*["']([a-zA-Z0-9]{32})["']/)
          if (!match?.[1]) throw new Error('No client_id in bundle')
          return match[1]
        })
      )
      bundleAbort.abort()
      return found
    } catch {
      return null
    }
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
    if (scState.cachedClientId && now < scState.clientIdExpiresAt) {
      return scState.cachedClientId
    }
    if (scState.inFlightClientIdPromise) {
      return scState.inFlightClientIdPromise
    }
  } else if (scState.inFlightForceRefreshPromise) {
    // A forced refresh is already in progress — await that one instead of
    // starting a duplicate scrape.
    return scState.inFlightForceRefreshPromise
  }

  const runFetch = async (): Promise<string> => {
    const scraped = await scrapeClientIdFromWeb()
    if (scraped) {
      scState.cachedClientId = scraped
      scState.clientIdExpiresAt = Date.now() + 60 * 60 * 1000 // 60 mins TTL
      scState.fallbackClientIdIndex = 0 // reset fallback rotation once we have a real scraped id
      return scState.cachedClientId
    }
    // [FIX #3] Use (and rotate through) the fallback candidate list instead
    // of always using FALLBACK_CLIENT_IDS[0].
    const fallback = getCurrentFallbackClientId()
    scState.cachedClientId = fallback
    scState.clientIdExpiresAt = Date.now() + 15 * 60 * 1000
    return scState.cachedClientId
  }

  if (forceRefresh) {
    // On a forced refresh caused by a 401/403, also rotate the fallback
    // candidate so a repeatedly-revoked hardcoded id isn't retried forever.
    rotateFallbackClientId()
    scState.inFlightForceRefreshPromise = runFetch()
    try {
      return await scState.inFlightForceRefreshPromise
    } finally {
      scState.inFlightForceRefreshPromise = null
    }
  }

  scState.inFlightClientIdPromise = runFetch()
  try {
    return await scState.inFlightClientIdPromise
  } finally {
    scState.inFlightClientIdPromise = null
  }
}

async function fetchSoundCloudApiWithClientId(
  buildUrl: (clientId: string) => string,
  options: RequestInit & { next?: { revalidate?: number } },
  timeoutMs = 8000
): Promise<{ res: Response; clientId: string }> {
  let clientId = await getSoundCloudClientId()
  let res = await fetchWithTimeout(buildUrl(clientId), options, timeoutMs)
  if (!res.ok && (res.status === 401 || res.status === 403)) {
    scState.cachedClientId = null
    scState.clientIdExpiresAt = 0
    clientId = await getSoundCloudClientId(true)
    res = await fetchWithTimeout(buildUrl(clientId), options, timeoutMs)
  }
  return { res, clientId }
}

/**
 * Resolves any SoundCloud URL (Track or Playlist, including on.soundcloud.com shortlinks)
 */
export async function resolveSoundCloudUrl(inputUrl: string): Promise<Track[]> {
  let targetUrl = inputUrl.trim()
  if (!targetUrl) return []

  // Fast path: check permalinkIdCache + trackMetadataCache for single track permalinks
  const cleanPermalink = targetUrl.replace(/\/+$/, '')
  const now = Date.now()
  const cachedPermalink = permalinkIdCache.get(cleanPermalink)
  if (cachedPermalink && now < cachedPermalink.expiresAt) {
    const cachedMeta = trackMetadataCache.get(cachedPermalink.id)
    if (cachedMeta && now < cachedMeta.expiresAt) {
      return [cachedMeta.track]
    }
  }

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

  try {
    const { res, clientId } = await fetchSoundCloudApiWithClientId(
      (cid) =>
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(
          targetUrl
        )}&client_id=${cid}`,
      {
        headers: {
          'User-Agent': SC_USER_AGENT,
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
        const { res: userRes } = await fetchSoundCloudApiWithClientId(
          (cid) =>
            `https://api-v2.soundcloud.com/users/${data.id}/tracks?client_id=${cid}&limit=50&access=playable`,
          {
            headers: {
              'User-Agent': SC_USER_AGENT,
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
          return rawTracks
            .filter(isSoundCloudFullAudio)
            .map((raw) => cacheRawTrackMetadata(raw))
        }
      } catch (userErr) {
        console.error('[SoundCloud] Failed to fetch user profile tracks:', userErr)
      }
    }

    // 3. If it resolved to a single Track
    if (isSoundCloudFullAudio(data)) {
      const appTrack = cacheRawTrackMetadata(data)
      if (cleanPermalink.includes('soundcloud.com/') && data.id) {
        permalinkIdCache.set(cleanPermalink, {
          id: String(data.id),
          expiresAt: Date.now() + 60 * 60 * 1000,
        })
      }
      return [appTrack]
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

  try {
    const { res, clientId } = await fetchSoundCloudApiWithClientId(
      (cid) =>
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(
          targetUrl
        )}&client_id=${cid}`,
      {
        headers: {
          'User-Agent': SC_USER_AGENT,
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
              'User-Agent': SC_USER_AGENT,
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

  return allOrderedTracks
    .filter(isSoundCloudFullAudio)
    .map((raw) => cacheRawTrackMetadata(raw))
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

  const fetchLimit = Math.min(Math.max(limit * 2, 30), 100)

  try {
    const { res } = await fetchSoundCloudApiWithClientId(
      (cid) =>
        `https://api-v2.soundcloud.com/search/tracks?q=${encodeURIComponent(
          trimmed
        )}&client_id=${cid}&limit=${fetchLimit}&offset=${offset}&access=playable`,
      {
        headers: {
          'User-Agent': SC_USER_AGENT,
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

    return fullAudioTracks.slice(0, limit).map((raw) => cacheRawTrackMetadata(raw))
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Resolves full track metadata by SoundCloud ID, Permalink URL, or Supabase DB UUID
 */
export async function resolveSoundCloudTrack(
  trackId: string | number
): Promise<{ track: Track; raw: SoundCloudRawTrack } | null> {
  let rawId = String(trackId).trim()
  if (!rawId) return null

  if (rawId.startsWith('soundcloud:')) {
    rawId = rawId.replace('soundcloud:', '')
  }

  // 1. If target is a SoundCloud permalink URL
  if (rawId.includes('soundcloud.com')) {
    const cleanPermalink = rawId.replace(/\/+$/, '')
    const cachedPermalink = permalinkIdCache.get(cleanPermalink)
    if (cachedPermalink && Date.now() < cachedPermalink.expiresAt) {
      return resolveSoundCloudTrack(cachedPermalink.id)
    }
    const resolvedTracks = await resolveSoundCloudUrl(rawId)
    if (resolvedTracks.length > 0 && resolvedTracks[0].soundcloud_id) {
      return resolveSoundCloudTrack(resolvedTracks[0].soundcloud_id)
    }
    return null
  }

  // 2. If target is a Supabase DB UUID, look up file_path in database
  if (UUID_REGEX.test(rawId)) {
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey)
        const { data: dbTrack } = await supabase
          .from('tracks')
          .select('file_path, title, artist')
          .eq('id', rawId)
          .single()
        const fp = (dbTrack?.file_path || '').trim()
        if (
          fp &&
          (fp.startsWith('soundcloud:') ||
            fp.includes('soundcloud.com') ||
            /^\d+$/.test(fp.replace(/^sc-/, '')))
        ) {
          return resolveSoundCloudTrack(fp)
        }
        if (dbTrack?.title) {
          const query = [dbTrack.title, dbTrack.artist].filter(Boolean).join(' ').trim()
          const candidates = await searchSoundCloudTracks(query, 5)
          if (candidates.length > 0 && candidates[0].soundcloud_id) {
            return resolveSoundCloudTrack(candidates[0].soundcloud_id)
          }
        }
      }
    } catch (dbErr) {
      console.warn('[SoundCloud] DB lookup for UUID track failed:', dbErr)
    }
    return null
  }

  rawId = rawId.replace(/^sc-/, '')
  const now = Date.now()

  // 3. Check in-memory track cache
  const cached = trackMetadataCache.get(rawId)
  if (cached && now < cached.expiresAt) {
    return { track: cached.track, raw: cached.raw }
  }

  try {
    const { res } = await fetchSoundCloudApiWithClientId(
      (cid) => `https://api-v2.soundcloud.com/tracks/${rawId}?client_id=${cid}`,
      {
        headers: {
          'User-Agent': SC_USER_AGENT,
          Accept: 'application/json',
        },
        next: { revalidate: 3600 },
      },
      8000
    )

    if (!res.ok) return null

    const raw: SoundCloudRawTrack = await res.json()
    if (!isSoundCloudFullAudio(raw)) return null

    const appTrack = cacheRawTrackMetadata(raw)

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
 * Resolves stream URL for a given track ID, Permalink URL, or Supabase DB UUID with 401/403 retry
 */
export async function resolveSoundCloudStreamUrl(
  trackId: string | number,
  bypassCache = false
): Promise<string | null> {
  let rawId = String(trackId).trim()
  if (!rawId) return null

  if (rawId.startsWith('soundcloud:')) {
    rawId = rawId.replace('soundcloud:', '')
  }

  // 1. If target is a SoundCloud permalink URL
  if (rawId.includes('soundcloud.com')) {
    const cleanPermalink = rawId.replace(/\/+$/, '')
    const cachedPermalink = permalinkIdCache.get(cleanPermalink)
    if (cachedPermalink && Date.now() < cachedPermalink.expiresAt) {
      return resolveSoundCloudStreamUrl(cachedPermalink.id, bypassCache)
    }
    const resolvedTracks = await resolveSoundCloudUrl(rawId)
    if (resolvedTracks.length > 0 && resolvedTracks[0].soundcloud_id) {
      return resolveSoundCloudStreamUrl(resolvedTracks[0].soundcloud_id, bypassCache)
    }
    return null
  }

  // 2. If target is a Supabase DB UUID, look up file_path in database
  if (UUID_REGEX.test(rawId)) {
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const supabaseKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey)
        const { data: dbTrack } = await supabase
          .from('tracks')
          .select('file_path, title, artist')
          .eq('id', rawId)
          .single()
        const fp = (dbTrack?.file_path || '').trim()
        if (
          fp &&
          (fp.startsWith('soundcloud:') ||
            fp.includes('soundcloud.com') ||
            /^\d+$/.test(fp.replace(/^sc-/, '')))
        ) {
          return resolveSoundCloudStreamUrl(fp, bypassCache)
        }
        if (dbTrack?.title) {
          const query = [dbTrack.title, dbTrack.artist].filter(Boolean).join(' ').trim()
          const candidates = await searchSoundCloudTracks(query, 5)
          if (candidates.length > 0 && candidates[0].soundcloud_id) {
            return resolveSoundCloudStreamUrl(candidates[0].soundcloud_id, bypassCache)
          }
        }
      }
    } catch (dbErr) {
      console.warn('[SoundCloud] DB lookup for UUID stream failed:', dbErr)
    }
    return null
  }

  rawId = rawId.replace(/^sc-/, '')
  const now = Date.now()

  // 3. Check in-memory stream cache
  if (bypassCache) {
    streamUrlCache.delete(rawId)
    inFlightSoundCloudStream.delete(rawId)
  } else {
    const cachedStream = streamUrlCache.get(rawId)
    if (cachedStream && now < cachedStream.expiresAt) {
      return cachedStream.url
    }
    const existingInFlight = inFlightSoundCloudStream.get(rawId)
    if (existingInFlight) {
      return existingInFlight
    }
  }

  const promise = (async (): Promise<string | null> => {
    const resolved = await resolveSoundCloudTrack(rawId)
    if (!resolved || !resolved.raw) return null

    const transcoding = getBestSoundCloudTranscoding(resolved.raw)
    if (!transcoding?.url) return null

    try {
      const { res } = await fetchSoundCloudApiWithClientId(
        (cid) => `${transcoding.url}?client_id=${cid}`,
        {
          headers: {
            'User-Agent': SC_USER_AGENT,
            Accept: 'application/json',
          },
        },
        6000
      )

      if (!res.ok) return null

      const data = await res.json()
      const streamUrl: string | null = data.url || null
      if (!streamUrl || streamUrl.includes('/cbcs/') || streamUrl.includes('/preview/')) {
        return null
      }

      if (streamUrl.includes('.m3u8')) {
        const hlsInfo = await parseSoundCloudHlsManifest(streamUrl)
        if (!hlsInfo) {
          return null
        }
      }

      // Cache stream URL in memory for 15 minutes (900s)
      streamUrlCache.set(rawId, {
        url: streamUrl,
        expiresAt: Date.now() + 15 * 60 * 1000,
      })

      return streamUrl
    } catch (err) {
      console.error(`[SoundCloud] Failed to resolve stream for ${trackId}:`, err)
      return null
    } finally {
      inFlightSoundCloudStream.delete(rawId)
    }
  })()

  if (!bypassCache) {
    inFlightSoundCloudStream.set(rawId, promise)
  }

  return promise
}

export interface SoundCloudHlsManifestInfo {
  contentType: string
  urls: string[]
  hasInitMap?: boolean
  durationSeconds?: number
}

export function patchInitMp4Duration(
  initBytes: Uint8Array,
  durationSeconds: number,
): Uint8Array {
  if (
    !(initBytes instanceof Uint8Array) ||
    initBytes.byteLength < 16 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return initBytes
  }

  const out = new Uint8Array(initBytes)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  let mvhdTimescale = 1000

  function walkBoxes(start: number, end: number): void {
    let offset = start
    while (offset + 8 <= end) {
      const size = view.getUint32(offset, false)
      const type = String.fromCharCode(
        out[offset + 4],
        out[offset + 5],
        out[offset + 6],
        out[offset + 7],
      )
      const boxEnd = size === 0 ? end : offset + size
      if (size < 8 || boxEnd > end) break

      if (type === 'moov' || type === 'trak' || type === 'mdia') {
        walkBoxes(offset + 8, boxEnd)
      } else if (type === 'mvhd') {
        const version = out[offset + 8]
        if (version === 0 && offset + 28 <= boxEnd) {
          const timescale = view.getUint32(offset + 20, false)
          if (timescale > 0) {
            mvhdTimescale = timescale
            view.setUint32(offset + 24, Math.round(durationSeconds * timescale), false)
          }
        } else if (version === 1 && offset + 36 <= boxEnd) {
          const timescale = view.getUint32(offset + 28, false)
          if (timescale > 0) {
            mvhdTimescale = timescale
            view.setBigUint64(
              offset + 32,
              BigInt(Math.round(durationSeconds * timescale)),
              false,
            )
          }
        }
      } else if (type === 'tkhd') {
        const version = out[offset + 8]
        if (version === 0 && offset + 32 <= boxEnd) {
          view.setUint32(
            offset + 28,
            Math.round(durationSeconds * mvhdTimescale),
            false,
          )
        } else if (version === 1 && offset + 44 <= boxEnd) {
          view.setBigUint64(
            offset + 36,
            BigInt(Math.round(durationSeconds * mvhdTimescale)),
            false,
          )
        }
      } else if (type === 'mdhd') {
        const version = out[offset + 8]
        if (version === 0 && offset + 28 <= boxEnd) {
          const timescale = view.getUint32(offset + 20, false)
          if (timescale > 0) {
            view.setUint32(offset + 24, Math.round(durationSeconds * timescale), false)
          }
        } else if (version === 1 && offset + 36 <= boxEnd) {
          const timescale = view.getUint32(offset + 28, false)
          if (timescale > 0) {
            view.setBigUint64(
              offset + 32,
              BigInt(Math.round(durationSeconds * timescale)),
              false,
            )
          }
        }
      }

      offset = boxEnd
    }
  }

  walkBoxes(0, out.byteLength)
  return out
}

export function stripFmp4SegmentIndexBoxes(segmentBytes: Uint8Array): Uint8Array {
  if (!(segmentBytes instanceof Uint8Array) || segmentBytes.byteLength < 8) {
    return segmentBytes
  }
  const view = new DataView(
    segmentBytes.buffer,
    segmentBytes.byteOffset,
    segmentBytes.byteLength,
  )
  let offset = 0
  while (offset + 8 <= segmentBytes.byteLength) {
    const size = view.getUint32(offset, false)
    if (size < 8 || offset + size > segmentBytes.byteLength) break
    const type = String.fromCharCode(
      segmentBytes[offset + 4],
      segmentBytes[offset + 5],
      segmentBytes[offset + 6],
      segmentBytes[offset + 7],
    )
    if (type === 'styp' || type === 'sidx') {
      offset += size
      continue
    }
    break
  }
  return offset > 0 ? segmentBytes.subarray(offset) : segmentBytes
}

export function parseFmp4SegmentSidx(
  segmentBytes: Uint8Array,
): { subsegmentDuration: number; timescale: number } | null {
  if (!(segmentBytes instanceof Uint8Array) || segmentBytes.byteLength < 24) {
    return null
  }
  const view = new DataView(
    segmentBytes.buffer,
    segmentBytes.byteOffset,
    segmentBytes.byteLength,
  )
  let offset = 0
  while (offset + 8 <= segmentBytes.byteLength) {
    const size = view.getUint32(offset, false)
    if (size < 8 || offset + size > segmentBytes.byteLength) break
    const type = String.fromCharCode(
      segmentBytes[offset + 4],
      segmentBytes[offset + 5],
      segmentBytes[offset + 6],
      segmentBytes[offset + 7],
    )
    if (type === 'sidx' && size >= 24) {
      const version = segmentBytes[offset + 8]
      const timescale = view.getUint32(offset + 16, false)
      const countOffset = offset + 20 + (version === 0 ? 8 : 16) + 2
      if (countOffset + 2 > offset + size) return null
      const refCount = view.getUint16(countOffset, false)
      let totalDuration = 0
      let refPos = countOffset + 2
      for (let i = 0; i < refCount && refPos + 12 <= offset + size; i++) {
        totalDuration += view.getUint32(refPos + 4, false)
        refPos += 12
      }
      if (timescale > 0 && totalDuration > 0) {
        return { subsegmentDuration: totalDuration, timescale }
      }
      return null
    }
    if (type === 'moof') break
    offset += size
  }
  return null
}

export function buildMasterFmp4SidxBox(
  segments: ReadonlyArray<{ byteLength: number; durationTicks: number }>,
  timescale = 44100,
): Uint8Array {
  const count = segments.length
  const safeTimescale = timescale > 0 ? timescale : 44100
  const boxSize = 32 + count * 12
  const out = new Uint8Array(boxSize)
  const view = new DataView(out.buffer)
  view.setUint32(0, boxSize, false)
  out[4] = 0x73 // 's'
  out[5] = 0x69 // 'i'
  out[6] = 0x64 // 'd'
  out[7] = 0x78 // 'x'
  view.setUint32(8, 0, false) // version 0, flags 0
  view.setUint32(12, 1, false) // reference_id = 1
  view.setUint32(16, safeTimescale, false)
  view.setUint32(20, 0, false) // earliest_presentation_time = 0
  view.setUint32(24, 0, false) // first_offset = 0 (first moof immediately follows sidx)
  view.setUint16(28, 0, false) // reserved = 0
  view.setUint16(30, count, false)

  let pos = 32
  for (const seg of segments) {
    view.setUint32(pos, seg.byteLength & 0x7fffffff, false)
    view.setUint32(pos + 4, seg.durationTicks >>> 0, false)
    view.setUint32(pos + 8, 0x90000000, false) // starts_with_SAP = 1, SAP_type = 1
    pos += 12
  }
  return out
}

const HLS_BUFFER_CACHE_MAX_ENTRIES = 10
const HLS_BUFFER_CACHE_TTL_MS = 10 * 60 * 1000
const hlsMediaBufferCache = scState.hlsMediaBufferCache
const inFlightHlsMediaBuffer = scState.inFlightHlsMediaBuffer

export async function assembleSoundCloudHlsMedia(
  hlsInfo: SoundCloudHlsManifestInfo,
  signal?: AbortSignal,
): Promise<{ buffer: Uint8Array; contentType: string } | null> {
  if (!hlsInfo || !Array.isArray(hlsInfo.urls) || hlsInfo.urls.length === 0) {
    return null
  }
  try {
    const buffers = await Promise.all(
      hlsInfo.urls.map(async (segUrl) => {
        const res = await fetchWithTimeout(
          segUrl,
          { headers: { 'User-Agent': SC_USER_AGENT }, signal },
          10000,
        )
        if (!res.ok) {
          throw new Error(`Segment fetch failed with status ${res.status}`)
        }
        return new Uint8Array(await res.arrayBuffer())
      }),
    )

    const isFmp4 =
      Boolean(hlsInfo.hasInitMap) || hlsInfo.contentType === 'audio/mp4'
    if (isFmp4 && buffers.length >= 2) {
      let timescale = 44100
      let totalDurationTicks = 0
      const strippedSegments: Uint8Array[] = []
      const segMeta: { byteLength: number; durationTicks: number }[] = []

      for (let i = 1; i < buffers.length; i++) {
        const sidxInfo = parseFmp4SegmentSidx(buffers[i])
        if (sidxInfo?.timescale) {
          timescale = sidxInfo.timescale
        }
        const stripped = stripFmp4SegmentIndexBoxes(buffers[i])
        const durationTicks =
          sidxInfo?.subsegmentDuration || Math.round(10 * timescale)
        totalDurationTicks += durationTicks
        strippedSegments.push(stripped)
        segMeta.push({
          byteLength: stripped.byteLength,
          durationTicks,
        })
      }

      const exactDurationSeconds =
        totalDurationTicks > 0 && timescale > 0
          ? totalDurationTicks / timescale
          : hlsInfo.durationSeconds || 0
      const initPatched = patchInitMp4Duration(buffers[0], exactDurationSeconds)
      const masterSidx = buildMasterFmp4SidxBox(segMeta, timescale)

      let totalBytes = initPatched.byteLength + masterSidx.byteLength
      for (const seg of strippedSegments) {
        totalBytes += seg.byteLength
      }

      const assembled = new Uint8Array(totalBytes)
      let writeOffset = 0
      assembled.set(initPatched, writeOffset)
      writeOffset += initPatched.byteLength
      assembled.set(masterSidx, writeOffset)
      writeOffset += masterSidx.byteLength
      for (const seg of strippedSegments) {
        assembled.set(seg, writeOffset)
        writeOffset += seg.byteLength
      }

      return {
        buffer: assembled,
        contentType: hlsInfo.contentType || 'audio/mp4',
      }
    }

    let totalBytes = 0
    for (const seg of buffers) {
      totalBytes += seg.byteLength
    }
    const assembled = new Uint8Array(totalBytes)
    let writeOffset = 0
    for (const seg of buffers) {
      assembled.set(seg, writeOffset)
      writeOffset += seg.byteLength
    }
    return {
      buffer: assembled,
      contentType: hlsInfo.contentType || 'audio/mpeg',
    }
  } catch {
    return null
  }
}

export async function resolveSoundCloudHlsBuffer(
  trackId: string | number,
  m3u8Url: string,
  bypassCache = false,
): Promise<{ buffer: Uint8Array; contentType: string } | null> {
  const cleanId = String(trackId || '').trim().replace(/^sc-/, '')
  const cacheKey = cleanId || m3u8Url
  const now = Date.now()

  if (bypassCache) {
    hlsMediaBufferCache.delete(cacheKey)
    inFlightHlsMediaBuffer.delete(cacheKey)
  } else {
    const cached = hlsMediaBufferCache.get(cacheKey)
    if (cached && now < cached.expiresAt) {
      // Refresh LRU insertion order
      hlsMediaBufferCache.delete(cacheKey)
      hlsMediaBufferCache.set(cacheKey, cached)
      return { buffer: cached.buffer, contentType: cached.contentType }
    }
    const existing = inFlightHlsMediaBuffer.get(cacheKey)
    if (existing) {
      return existing
    }
  }

  const promise = (async () => {
    try {
      const hlsInfo = await parseSoundCloudHlsManifest(m3u8Url)
      if (!hlsInfo) return null
      const assembled = await assembleSoundCloudHlsMedia(hlsInfo)
      if (!assembled) return null

      if (hlsMediaBufferCache.size >= HLS_BUFFER_CACHE_MAX_ENTRIES) {
        const oldestKey = hlsMediaBufferCache.keys().next().value
        if (oldestKey !== undefined) {
          hlsMediaBufferCache.delete(oldestKey)
        }
      }
      hlsMediaBufferCache.set(cacheKey, {
        buffer: assembled.buffer,
        contentType: assembled.contentType,
        expiresAt: Date.now() + HLS_BUFFER_CACHE_TTL_MS,
      })
      return assembled
    } finally {
      inFlightHlsMediaBuffer.delete(cacheKey)
    }
  })()

  if (!bypassCache) {
    inFlightHlsMediaBuffer.set(cacheKey, promise)
  }

  return promise
}

export async function parseSoundCloudHlsManifest(
  m3u8Url: string,
  timeoutMs = 4000,
): Promise<SoundCloudHlsManifestInfo | null> {
  try {
    if (!m3u8Url || m3u8Url.includes('/cbcs/')) return null
    const now = Date.now()
    const cached = hlsManifestCache.get(m3u8Url)
    if (cached && now < cached.expiresAt) {
      return cached.info
    }

    const res = await fetchWithTimeout(
      m3u8Url,
      { headers: { 'User-Agent': SC_USER_AGENT } },
      timeoutMs,
    )
    if (!res.ok) return null
    const text = await res.text()
    if (!text || text.includes('#EXT-X-KEY') || text.includes('/cbcs/')) {
      return null
    }
    const mapMatch = text.match(/#EXT-X-MAP:URI="([^"]+)"/)
    const mapUrl = mapMatch ? mapMatch[1] : null
    let durationSeconds = 0
    for (const match of text.matchAll(/#EXTINF:([0-9]+(?:\.[0-9]+)?)/g)) {
      const segDur = Number.parseFloat(match[1])
      if (Number.isFinite(segDur) && segDur > 0) {
        durationSeconds += segDur
      }
    }
    const segmentUrls = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('http://') || line.startsWith('https://'))
    if (segmentUrls.length === 0) return null

    const info: SoundCloudHlsManifestInfo = {
      contentType: mapUrl ? 'audio/mp4' : 'audio/mpeg',
      urls: mapUrl ? [mapUrl, ...segmentUrls] : segmentUrls,
      hasInitMap: Boolean(mapUrl),
      durationSeconds,
    }

    if (hlsManifestCache.size >= 60) {
      const oldestKey = hlsManifestCache.keys().next().value
      if (oldestKey !== undefined) {
        hlsManifestCache.delete(oldestKey)
      }
    }
    hlsManifestCache.set(m3u8Url, {
      info,
      expiresAt: Date.now() + 10 * 60 * 1000,
    })

    return info
  } catch {
    return null
  }
}

/**
 * Verifies that a SoundCloud track candidate can actually be resolved and played
 * (including via the configured SoundCloud Worker if enabled).
 * Rejects geo-blocked / Go+ / snippet / DRM tracks that pass initial search metadata
 * in one region but fail when the Worker or stream resolver attempts playback.
 */
function isPlayableSoundCloudDirectUrl(url?: string | null): url is string {
  if (typeof url !== 'string' || (!url.startsWith('https://') && !url.startsWith('/api/soundcloud/stream'))) {
    return false
  }
  const lower = url.toLowerCase()
  if (lower.includes('/cbcs/') || lower.includes('/preview/')) {
    return false
  }
  return true
}

export async function verifySoundCloudTrackPlayable(
  trackId: string | number,
  timeoutMs = 3000,
): Promise<boolean> {
  const cleanId = String(trackId || '').trim().replace(/^sc-/, '')
  if (!cleanId) return false

  const cachedStream = streamUrlCache.get(cleanId)
  if (cachedStream && Date.now() < cachedStream.expiresAt && isPlayableSoundCloudDirectUrl(cachedStream.url)) {
    return true
  }

  const workerUrl = process.env.NEXT_PUBLIC_SOUNDCLOUD_WORKER_URL?.trim()
  const isNumericId = /^\d+$/.test(cleanId)
  if (workerUrl && isNumericId) {
    try {
      const cleanWorkerOrigin = workerUrl.replace(/\/+$/, '')
      const target = `${cleanWorkerOrigin}/stream?id=${encodeURIComponent(cleanId)}&format=json`
      const res = await fetchWithTimeout(
        target,
        { headers: { Accept: 'application/json' }, cache: 'no-store' },
        timeoutMs,
      )
      if (res.status === 404 || res.status === 403 || res.status === 400) {
        return false
      }
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (isPlayableSoundCloudDirectUrl(data?.url) && !String(data.url).toLowerCase().includes('.m3u8')) {
          if (!String(data.url).startsWith(cleanWorkerOrigin)) {
            streamUrlCache.set(cleanId, {
              url: data.url,
              expiresAt: Date.now() + 15 * 60 * 1000,
            })
          }
          return true
        }
        return false
      }
    } catch {
      // Fall through to direct stream resolution if Worker probe timed out
    }
  }

  const directUrl = await resolveSoundCloudStreamUrl(cleanId)
  return isPlayableSoundCloudDirectUrl(directUrl)
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

  try {
    const { res } = await fetchSoundCloudApiWithClientId(
      (cid) =>
        `https://api-v2.soundcloud.com/search/playlists?q=${encodeURIComponent(
          trimmed
        )}&client_id=${cid}&limit=${limit}&access=playable`,
      {
        headers: {
          'User-Agent': SC_USER_AGENT,
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

  try {
    const { res, clientId } = await fetchSoundCloudApiWithClientId(
      (cid) => `https://api-v2.soundcloud.com/playlists/${rawId}?client_id=${cid}`,
      {
        headers: {
          'User-Agent': SC_USER_AGENT,
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
