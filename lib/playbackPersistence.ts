/**
 * Playback state persistence to localStorage.
 * Stores queue, current index, current track, and resolved stream URLs
 * so the app can restore playback context on next open.
 *
 * Storage format:
 * {
 *   queue: Track[],
 *   currentIndex: number,
 *   currentTime: number,
 *   currentTrack: Track,
 *   streamUrls: { [trackId]: { url: string, ts: number, expiresAt: number } },
 *   resolutions: { [title+artist+album]: { source, id/youtube_id, expiresAt } }
 * }
 *
 * LRU eviction kicks in when serialized size exceeds MAX_BYTES (~2MB).
 */

import type { Track } from '@/types'

const STORAGE_KEY = 'musicweb_playback_v2'
const MAX_BYTES = 2 * 1024 * 1024 // 2MB — leaves room for other localStorage data
const STREAM_URL_TTL = 5 * 60 * 1000 // 5 min — short TTL for signed stream URLs
const STREAM_URL_MAX_ENTRIES = 200

// ── Serialization helpers ─────────────────────────────────────────────────────

interface StreamUrlEntry {
  url: string
  nhaccuatui_id?: string
  youtube_id?: string
  ts: number
  expiresAt: number
}

interface TrackResolutionEntry {
  source: string
  resolvedId: string
  ts: number
  expiresAt: number
  /** Cached YouTube video ID — avoids re-searching the same track. */
  youtubeVideoId?: string
}

export interface PlaybackState {
  queue: Track[]
  currentIndex: number
  currentTime: number
  currentTrack: Track | null
  streamUrls: Record<string, StreamUrlEntry>
  resolutions: Record<string, TrackResolutionEntry>
  savedAt: number
}

// ── Storage read/write with LRU eviction ─────────────────────────────────────

function safeRead<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    // Validate basic shape to avoid storing garbage
    if (typeof parsed !== 'object' || parsed === null) return fallback
    return parsed as T
  } catch {
    return fallback
  }
}

/** Retain a contiguous queue window around the selected track. */
function trimQueue(state: PlaybackState, limit: number): void {
  const index = state.currentIndex
  const validIndex = index >= 0 && index < state.queue.length
  const start = validIndex
    ? Math.max(0, Math.min(index - Math.floor(limit / 2), state.queue.length - limit))
    : 0
  state.queue = state.queue.slice(start, start + limit)
  state.currentIndex = validIndex ? index - start : -1
}

function safeWrite(key: string, data: PlaybackState): boolean {
  if (typeof window === 'undefined') return false
  try {
    // Eviction must operate on the incoming snapshot, without mutating live playback.
    const state: PlaybackState = {
      ...data,
      queue: [...data.queue],
      streamUrls: { ...data.streamUrls },
      resolutions: { ...data.resolutions },
    }
    const now = Date.now()
    for (const [id, entry] of Object.entries(state.streamUrls)) {
      if (entry.expiresAt <= now) delete state.streamUrls[id]
    }
    for (const [id, entry] of Object.entries(state.resolutions)) {
      if (entry.expiresAt <= now) delete state.resolutions[id]
    }
    const cacheEntries = [
      ...Object.entries(state.streamUrls).map(([id, entry]) => ({ id, ts: entry.ts, kind: 'url' as const })),
      ...Object.entries(state.resolutions).map(([id, entry]) => ({ id, ts: entry.ts, kind: 'resolution' as const })),
    ].sort((a, b) => a.ts - b.ts)
    const encoder = new TextEncoder()
    let cacheIndex = 0
    while (true) {
      const serialized = JSON.stringify(state)
      if (encoder.encode(serialized).byteLength <= MAX_BYTES) {
        try {
          localStorage.setItem(key, serialized)
          return true
        } catch {
          // A browser quota may be smaller than our budget. Retry the new snapshot.
        }
      }
      const entry = cacheEntries[cacheIndex++]
      if (entry) {
        if (entry.kind === 'url') delete state.streamUrls[entry.id]
        else delete state.resolutions[entry.id]
      } else if (state.queue.length > 1) {
        trimQueue(state, Math.max(1, Math.floor(state.queue.length / 2)))
      } else {
        // Keep the previous valid save if the selected track itself cannot fit.
        return false
      }
    }
  } catch {
    return false
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Load saved playback state from localStorage. Returns null if nothing saved or expired. */
export function loadPlaybackState(): PlaybackState | null {
  const raw = (() => {
    if (typeof window === 'undefined') return null
    try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
  })()
  if (!raw) return null
  let state: PlaybackState | null = null
  try { state = JSON.parse(raw) } catch { return null }
  if (!state) return null

  // Check if state is too old (> 24 hours)
  if (Date.now() - state.savedAt > 24 * 60 * 60 * 1000) {
    clearPlaybackState()
    return null
  }

  // Filter out expired stream URLs
  const now = Date.now()
  const freshUrls: Record<string, StreamUrlEntry> = {}
  for (const [k, v] of Object.entries(state.streamUrls)) {
    if (v.expiresAt > now) {
      freshUrls[k] = v
    }
  }
  state.streamUrls = freshUrls

  // Filter out expired resolutions
  const freshRes: Record<string, TrackResolutionEntry> = {}
  for (const [k, v] of Object.entries(state.resolutions)) {
    if (v.expiresAt > now) {
      freshRes[k] = v
    }
  }
  state.resolutions = freshRes

  return state
}

/** Save current playback state to localStorage. Fire-and-forget. */
export function savePlaybackState(state: PlaybackState): void {
  state.savedAt = Date.now()
  safeWrite(STORAGE_KEY, state)
}

/** Clear all saved playback state (call on logout). */
export function clearPlaybackState(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

/** Save a resolved stream URL for a track. Call after successfully resolving a stream. */
export function saveStreamUrl(
  trackId: string,
  url: string,
  options: {
    nhaccuatui_id?: string
    youtube_id?: string
    ttl?: number
  } = {}
): void {
  const state = safeRead<PlaybackState>(STORAGE_KEY, {
    queue: [], currentIndex: -1, currentTime: 0,
    currentTrack: null, streamUrls: {}, resolutions: {}, savedAt: Date.now()
  })

  // Evict oldest entries if at capacity
  const urlCount = Object.keys(state.streamUrls).length
  if (urlCount >= STREAM_URL_MAX_ENTRIES) {
    const entries = Object.entries(state.streamUrls)
      .sort(([, a], [, b]) => a.ts - b.ts)
    // Remove oldest 20%
    const toRemove = Math.ceil(STREAM_URL_MAX_ENTRIES * 0.2)
    for (let i = 0; i < toRemove; i++) {
      const [k] = entries[i]
      delete state.streamUrls[k]
    }
  }

  state.streamUrls[trackId] = {
    url,
    nhaccuatui_id: options.nhaccuatui_id,
    youtube_id: options.youtube_id,
    ts: Date.now(),
    expiresAt: Date.now() + (options.ttl ?? STREAM_URL_TTL),
  }

  safeWrite(STORAGE_KEY, state)
}

/** Get a saved stream URL for a track. Returns null if not found or expired. */
export function getStreamUrl(trackId: string): { url: string; nhaccuatui_id?: string; youtube_id?: string } | null {
  const state = safeRead<PlaybackState>(STORAGE_KEY, {
    queue: [], currentIndex: -1, currentTime: 0,
    currentTrack: null, streamUrls: {}, resolutions: {}, savedAt: 0
  })

  const entry = state.streamUrls[trackId]
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    delete state.streamUrls[trackId]
    safeWrite(STORAGE_KEY, state)
    return null
  }

  return { url: entry.url, nhaccuatui_id: entry.nhaccuatui_id, youtube_id: entry.youtube_id }
}

/** Save a resolved track (e.g., Spotify → NCT match). Call after resolveStreamCached.
 *  Optionally save the YouTube video ID to skip future YouTube searches. */
export function saveTrackResolution(
  key: string,
  resolution: { source: string; resolvedId: string; ttl?: number; youtubeVideoId?: string }
): void {
  const state = safeRead<PlaybackState>(STORAGE_KEY, {
    queue: [], currentIndex: -1, currentTime: 0,
    currentTrack: null, streamUrls: {}, resolutions: {}, savedAt: Date.now()
  })

  state.resolutions[key] = {
    source: resolution.source,
    resolvedId: resolution.resolvedId,
    ts: Date.now(),
    expiresAt: Date.now() + (resolution.ttl ?? 30 * 60 * 1000),
    youtubeVideoId: resolution.youtubeVideoId,
  }

  safeWrite(STORAGE_KEY, state)
}

/** Delete a saved track resolution from persistence (e.g., when invalidated). */
export function deleteTrackResolution(key: string): void {
  const state = safeRead<PlaybackState>(STORAGE_KEY, {
    queue: [], currentIndex: -1, currentTime: 0,
    currentTrack: null, streamUrls: {}, resolutions: {}, savedAt: 0
  })
  if (state.resolutions[key]) {
    delete state.resolutions[key]
    safeWrite(STORAGE_KEY, state)
  }
}

/** Get a saved track resolution. Returns null if not found, expired, or recorded as an unplayable miss ('none').
 *  Also returns youtubeVideoId if cached. */
export function getTrackResolution(key: string): { source: string; resolvedId: string; youtubeVideoId?: string } | null {
  const state = safeRead<PlaybackState>(STORAGE_KEY, {
    queue: [], currentIndex: -1, currentTime: 0,
    currentTrack: null, streamUrls: {}, resolutions: {}, savedAt: 0
  })

  const entry = state.resolutions[key]
  if (!entry) return null
  if (entry.expiresAt < Date.now()) {
    delete state.resolutions[key]
    safeWrite(STORAGE_KEY, state)
    return null
  }

  // Treat 'none' or missing resolvedId as null to prevent returning a truthy unplayable object
  if (entry.source === 'none' || !entry.resolvedId) {
    return null
  }

  return { source: entry.source, resolvedId: entry.resolvedId, youtubeVideoId: entry.youtubeVideoId }
}

/**
 * Get cached YouTube video ID for a track (title + artist + album key).
 * Returns null if not cached or expired. This lets fallbackToYouTube skip the
 * YouTube Data API search and go straight to InnerTube, saving ~700ms.
 */
export function getCachedYouTubeId(
  title: string,
  artist?: string | null,
  album?: string | null
): string | null {
  const key = makeResolutionKey(title, artist, album)
  const entry = getTrackResolution(key)
  return entry?.youtubeVideoId ?? null
}

/** Build the same resolution key used by resolveStreamClient.ts */
function makeResolutionKey(title: string, artist?: string | null, album?: string | null): string {
  return `${title.trim().toLowerCase()}___${(artist || '').trim().toLowerCase()}___${(album || '').trim().toLowerCase()}`
}
