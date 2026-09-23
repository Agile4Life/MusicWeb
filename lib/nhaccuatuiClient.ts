import {
  findBestNhacCuaTuiMatch,
  normalizePublicNhacCuaTuiSongResponse,
  normalizeNhacCuaTuiSearchResponse,
  type NhacCuaTuiSearchItem,
  type NhacCuaTuiMatchTarget,
  type NhacCuaTuiSong,
} from './nhaccuatui'
import type { Track } from '@/types'

function getNhacCuaTuiStreamProxyBase(): string | null {
  const raw = process.env.NEXT_PUBLIC_NCT_STREAM_CACHE_URL?.trim()
  if (!raw) return null

  try {
    const url = new URL(raw, typeof window !== 'undefined' ? window.location.href : 'http://localhost')
    const pathname = url.pathname.replace(/\/+$/, '')
    const normalizedPath = pathname.endsWith('/api/stream')
      ? pathname
      : `${pathname}/api/stream`

    return `${url.origin}${normalizedPath}`
  } catch {
    return null
  }
}

export function getNhacCuaTuiStreamUrl(
  track: Pick<Track, 'source' | 'nhaccuatui_id'>,
): string | null {
  if (track.source !== 'nhaccuatui' || !track.nhaccuatui_id) return null
  const proxyBase = getNhacCuaTuiStreamProxyBase()
  const endpoint = proxyBase ?? '/api/nhaccuatui/stream'
  return `${endpoint}?id=${encodeURIComponent(track.nhaccuatui_id)}`
}

async function readJson(response: Response): Promise<unknown | null> {
  if (!response.ok) return null

  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function searchNhacCuaTui(query: string): Promise<NhacCuaTuiSearchItem[]> {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) return []

  try {
    const response = await fetch(`/api/nhaccuatui/search?q=${encodeURIComponent(trimmedQuery)}`, {
      cache: 'no-store',
    })
    const payload = await readJson(response)
    if (!payload || typeof payload !== 'object') return []

    const items = (payload as { items?: unknown }).items
    return normalizeNhacCuaTuiSearchResponse(items)
  } catch {
    return []
  }
}

// In-flight and short-term cache for song metadata (coalesces duplicate bursts on track switch)
const inFlightSongRequests = new Map<string, Promise<NhacCuaTuiSong | null>>()
const songMetadataCache = new Map<string, { song: NhacCuaTuiSong; ts: number }>()
const SONG_METADATA_CACHE_TTL = 3 * 60 * 1000 // 3 minutes
const SONG_METADATA_MAX_ENTRIES = 300

export function clearCachedNctSong(id: string): void {
  const trimmed = id.trim()
  if (!trimmed) return
  songMetadataCache.delete(trimmed)
  inFlightSongRequests.delete(trimmed)
}

export function clearAllCachedNctSongs(): void {
  songMetadataCache.clear()
  inFlightSongRequests.clear()
}

export async function resolveNhacCuaTuiSong(id: string): Promise<NhacCuaTuiSong | null> {
  const trimmedId = id.trim()
  if (!trimmedId) return null

  // 1. Check in-memory metadata cache
  const cached = songMetadataCache.get(trimmedId)
  if (cached && Date.now() - cached.ts < SONG_METADATA_CACHE_TTL) {
    return cached.song
  }

  // 2. Coalesce in-flight requests for the same song ID
  const existingInFlight = inFlightSongRequests.get(trimmedId)
  if (existingInFlight) {
    return existingInFlight
  }

  const promise = (async (): Promise<NhacCuaTuiSong | null> => {
    try {
      const response = await fetch(`/api/nhaccuatui/song/${encodeURIComponent(trimmedId)}`, {
        cache: 'no-store',
      })
      const payload = await readJson(response)
      if (!payload || typeof payload !== 'object') return null

      const song = (payload as { song?: unknown }).song
      const normalized = normalizePublicNhacCuaTuiSongResponse(song || payload)
      if (normalized) {
        if (songMetadataCache.size >= SONG_METADATA_MAX_ENTRIES) {
          const oldest = songMetadataCache.keys().next().value
          if (oldest !== undefined) songMetadataCache.delete(oldest)
        }
        songMetadataCache.set(trimmedId, { song: normalized, ts: Date.now() })
      }
      return normalized
    } catch {
      return null
    } finally {
      inFlightSongRequests.delete(trimmedId)
    }
  })()

  inFlightSongRequests.set(trimmedId, promise)
  return promise
}

export async function resolveNhacCuaTuiAudio(
  target: NhacCuaTuiMatchTarget,
): Promise<NhacCuaTuiSong | null> {
  const query = `${target.title || ''} ${target.artist || ''}`.trim()
  const candidates = await searchNhacCuaTui(query)
  const match = findBestNhacCuaTuiMatch(candidates, target)
  return match ? resolveNhacCuaTuiSong(match.id) : null
}

export async function resolveNhacCuaTuiTrack(
  track: Pick<Track, 'title' | 'artist' | 'album' | 'duration' | 'source' | 'nhaccuatui_id'>,
): Promise<NhacCuaTuiSong | null> {
  if (track.nhaccuatui_id) return resolveNhacCuaTuiSong(track.nhaccuatui_id)

  return resolveNhacCuaTuiAudio({
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
  })
}

// ── Module-level NCT stream URL cache ────────────────────────────────────────
// Mirrors the server-side /api/nhaccuatui/resolve-stream cache.
// Pre-populated by prewarmNctStreamUrl() so getAudioUrlCached() gets a
// synchronous cache hit (0ms network) when the user clicks play.
const nctStreamUrlCache = new Map<string, { url: string; ts: number }>()
const NCT_STREAM_URL_CACHE_TTL = 5 * 60 * 1000 // 5 min safe TTL to prevent 403 expired signed tokens
const nctResolveInFlight = new Map<string, Promise<string | null>>()
const nctPrewarmGeneration = new Map<string, number>()

/** Fire-and-forget pre-warm: fetches stream URL + metadata and caches the proxy URL.
 *  Call this for all upcoming NCT tracks so play is instant on click. */
export async function prewarmNctStreamUrl(nhaccuatuiId: string): Promise<void> {
  const trimmedId = nhaccuatuiId?.trim()
  if (!trimmedId) return

  // Deduplicate concurrent pre-warm calls for the same ID
  const inFlight = nctResolveInFlight.get(trimmedId)
  if (inFlight) {
    await inFlight.catch(() => {})
    return
  }

  const currentGen = (nctPrewarmGeneration.get(trimmedId) || 0) + 1
  nctPrewarmGeneration.set(trimmedId, currentGen)
  if (nctPrewarmGeneration.size > 200) {
    const oldest = nctPrewarmGeneration.keys().next().value
    if (oldest) nctPrewarmGeneration.delete(oldest)
  }

  const promise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(
        `/api/nhaccuatui/resolve-stream?id=${encodeURIComponent(trimmedId)}`,
        { cache: 'no-store' }
      )
      if (!res.ok) return null
      const data = await res.json() as { url?: string }
      if (!data?.url) return null

      // Store the CORS-safe proxy URL (not the raw signed CDN URL which lacks CORS headers)
      const proxyUrl = getNhacCuaTuiStreamUrl({ source: 'nhaccuatui', nhaccuatui_id: trimmedId }) || data.url
      // Only cache if this prewarm request was not superseded or invalidated while in-flight
      if (nctPrewarmGeneration.get(trimmedId) === currentGen) {
        nctStreamUrlCache.set(trimmedId, { url: proxyUrl, ts: Date.now() })
      }
      return proxyUrl
    } catch {
      return null
    } finally {
      nctResolveInFlight.delete(trimmedId)
    }
  })()

  nctResolveInFlight.set(trimmedId, promise)
  await promise
}

/** Synchronous cache lookup for getAudioUrlCached. Returns null on miss — caller
 *  should fall back to the full fetch path. */
export function getCachedNctStreamUrl(nhaccuatuiId: string): string | null {
  const entry = nctStreamUrlCache.get(nhaccuatuiId)
  if (!entry) return null
  if (Date.now() - entry.ts >= NCT_STREAM_URL_CACHE_TTL) {
    nctStreamUrlCache.delete(nhaccuatuiId)
    return null
  }
  return entry.url
}

/** Clear a cached NCT stream URL — call when a stream becomes invalid so the next
 *  play attempt re-resolves from the server instead of returning the stale URL. */
export function clearCachedNctStreamUrl(nhaccuatuiId: string): void {
  const trimmed = nhaccuatuiId?.trim()
  if (!trimmed) return
  nctStreamUrlCache.delete(trimmed)
  // Invalidate any in-flight prewarm requests by bumping the generation
  nctPrewarmGeneration.set(trimmed, (nctPrewarmGeneration.get(trimmed) || 0) + 1)
}
