import {
  SoundCloudRawTrack,
  isSoundCloudFullAudio,
  soundCloudTrackToAppTrack,
  getBestSoundCloudTranscoding,
} from './soundcloud'
import { Track } from '@/types'

// Cache client_id in memory with 2-hour TTL
let cachedClientId: string | null = null
let clientIdExpiresAt: number = 0

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
      const rawTracks: SoundCloudRawTrack[] = data.tracks || []
      return rawTracks.filter(isSoundCloudFullAudio).map(soundCloudTrackToAppTrack)
    }

    // 2. If it resolved to a single Track
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

    return {
      track: soundCloudTrackToAppTrack(raw),
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
    return data.url || null
  } catch (err) {
    console.error(`[SoundCloud] Failed to resolve stream for ${trackId}:`, err)
    return null
  }
}
