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
const QUEUE_MAX_ENTRIES = 500

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

function safeWrite(key: string, data: unknown): boolean {
  if (typeof window === 'undefined') return false
  try {
    const serialized = JSON.stringify(data)
    // LRU eviction if too large
    if (serialized.length > MAX_BYTES) {
      const evicted = evictLRU(key, serialized)
      if (!evicted) return false
    }
    localStorage.setItem(key, serialized)
    return true
  } catch {
    // localStorage full — try evicting and retrying
    evictToMakeSpace(key, data)
    return false
  }
}

function evictToMakeSpace(key: string, data: unknown): void {
  if (typeof window === 'undefined') return
  try {
    const serialized = JSON.stringify(data)
    // Remove oldest stream URLs and resolutions until it fits
    const state = safeRead<PlaybackState>(STORAGE_KEY, {
      queue: [], currentIndex: -1, currentTime: 0,
      currentTrack: null, streamUrls: {}, resolutions: {}, savedAt: 0
    })

    // Sort stream URLs by expiry, remove oldest
    const sortedUrls = Object.entries(state.streamUrls)
      .sort(([, a], [, b]) => a.expiresAt - b.expiresAt)

    while (sortedUrls.length > 10) {
      const [k] = sortedUrls.shift()!
      delete state.streamUrls[k]
    }

    // Sort resolutions by expiry, remove oldest
    const sortedRes = Object.entries(state.resolutions)
      .sort(([, a], [, b]) => a.expiresAt - b.expiresAt)

    while (sortedRes.length > 50) {
      const [k] = sortedRes.shift()!
      delete state.resolutions[k]
    }

    // Truncate queue if still too big
    if (JSON.stringify(state).length > MAX_BYTES * 0.8) {
      state.queue = state.queue.slice(0, 50)
    }

    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    // Last resort: clear everything
    localStorage.removeItem(key)
  }
}

function evictLRU(key: string, serialized: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const state = safeRead<PlaybackState>(key, {
      queue: [], currentIndex: -1, currentTime: 0,
      currentTrack: null, streamUrls: {}, resolutions: {}, savedAt: 0
    })

    // Remove expired entries first
    const now = Date.now()
    for (const [k, v] of Object.entries(state.streamUrls)) {
      if (v.expiresAt < now) delete state.streamUrls[k]
    }
    for (const [k, v] of Object.entries(state.resolutions)) {
      if (v.expiresAt < now) delete state.resolutions[k]
    }

    // If still too large, truncate queue and remove oldest stream URLs
    if (JSON.stringify(state).length > MAX_BYTES) {
      state.queue = state.queue.slice(0, 50)
    }
    if (JSON.stringify(state).length > MAX_BYTES) {
      const entries = Object.entries(state.streamUrls)
        .sort(([, a], [, b]) => b.ts - a.ts) // newest first
      while (entries.length > 50 && JSON.stringify(state).length > MAX_BYTES) {
        const [k] = entries.pop()!
        delete state.streamUrls[k]
      }
    }

    localStorage.setItem(key, JSON.stringify(state))
    return true
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

/** Save a resolved track (e.g., Spotify → NCT match). Call after resolveStreamCached. */
export function saveTrackResolution(
  key: string,
  resolution: { source: string; resolvedId: string; ttl?: number }
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

/** Get a saved track resolution. Returns null if not found, expired, or recorded as an unplayable miss ('none'). */
export function getTrackResolution(key: string): { source: string; resolvedId: string } | null {
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

  return { source: entry.source, resolvedId: entry.resolvedId }
}
