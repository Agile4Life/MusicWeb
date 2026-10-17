import type { Track } from '@/types'

export const STORAGE_KEY_PLAYER_STATE = 'musicweb_player_state'
export const MAX_PERSISTED_TRACKS = 150
export const PERSISTENCE_DEBOUNCE_MS = 15000 // 15s cadence during continuous playback

export function toMinimalPersistedTrack(track: Track): Partial<Track> {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    cover_url: track.cover_url,
    duration: track.duration,
    source: track.source,
    file_path: track.file_path,
    file_ext: track.file_ext,
    drive_file_id: track.drive_file_id,
    nhaccuatui_id: track.nhaccuatui_id,
    youtube_id: track.youtube_id,
    soundcloud_id: track.soundcloud_id,
    soundcloud_permalink_url: track.soundcloud_permalink_url,
    audio_url: track.audio_url,
    source_url: track.source_url,
    spotify_id: track.spotify_id,
    spotify_album_id: track.spotify_album_id,
    itunes_id: track.itunes_id,
    album: track.album,
    view_count: track.view_count,
    is_favorite: track.is_favorite,
  }
}

export interface PersistStatePayload {
  track: Track | null
  currentTime: number
  queue: Track[]
  currentIndex: number
  volume: number
}

export interface PersistenceSchedulerDeps {
  now(): number
  write(key: string, value: string): void
  after(ms: number, callback: () => void): () => void
  onIdle(callback: () => void): () => void
}

const defaultDeps: PersistenceSchedulerDeps = {
  now: () => Date.now(),
  write: (key, value) => { if (typeof localStorage !== 'undefined') localStorage.setItem(key, value) },
  after: (ms, callback) => { const id = setTimeout(callback, ms); return () => clearTimeout(id) },
  onIdle: callback => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      const id = window.requestIdleCallback(callback, { timeout: 2000 })
      return () => { if ('cancelIdleCallback' in window) window.cancelIdleCallback(id) }
    }
    callback()
    return () => {}
  },
}

export class PlaybackPersistenceScheduler {
  private pendingPayload: PersistStatePayload | null = null
  private cancelTimer: (() => void) | null = null
  private cancelIdle: (() => void) | null = null
  private generation = 0
  private disposed = false

  constructor(private readonly deps: PersistenceSchedulerDeps = defaultDeps) {}

  public saveImmediate(payload: PersistStatePayload): void {
    if (this.disposed) return
    this.cancelScheduled()
    this.pendingPayload = null
    this.writeToStorage(payload)
  }

  public scheduleDebounced(payload: PersistStatePayload): void {
    if (this.disposed) return
    this.pendingPayload = { ...payload }
    if (this.cancelTimer || this.cancelIdle) return
    const generation = this.generation
    this.cancelTimer = this.deps.after(PERSISTENCE_DEBOUNCE_MS, () => {
      if (generation !== this.generation || this.disposed) return
      this.cancelTimer = null
      let completed = false
      const cancel = this.deps.onIdle(() => {
        completed = true
        if (generation !== this.generation || this.disposed) return
        this.cancelIdle = null
        if (this.pendingPayload) {
          const payload = this.pendingPayload
          this.pendingPayload = null
          this.writeToStorage(payload)
        }
      })
      if (!completed) this.cancelIdle = cancel
    })
  }

  public updatePendingTime(currentTime: number): void {
    if (this.pendingPayload && !this.disposed) this.pendingPayload.currentTime = currentTime
  }

  public flushPending(): void {
    if (this.disposed) return
    this.cancelScheduled()
    if (this.pendingPayload) {
      const payload = this.pendingPayload
      this.pendingPayload = null
      this.writeToStorage(payload)
    }
  }

  public cancelScheduled(): void {
    this.generation++
    this.cancelTimer?.()
    this.cancelIdle?.()
    this.cancelTimer = null
    this.cancelIdle = null
  }

  /** Disposal intentionally discards pending state; callers flush before teardown if needed. */
  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelScheduled()
    this.pendingPayload = null
  }

  private writeToStorage(payload: PersistStatePayload): void {
    if (!payload.track) return
    try {
      let windowedQueue = payload.queue
      let persistedIndex = payload.currentIndex
      if (payload.queue.length > MAX_PERSISTED_TRACKS) {
        const safeIndex = Math.max(0, payload.currentIndex)
        const start = Math.max(0, Math.min(safeIndex - 20, payload.queue.length - MAX_PERSISTED_TRACKS))
        const end = Math.min(payload.queue.length, start + MAX_PERSISTED_TRACKS)
        windowedQueue = payload.queue.slice(start, end)
        persistedIndex = safeIndex >= 0 ? safeIndex - start : -1
      }
      this.deps.write(STORAGE_KEY_PLAYER_STATE, JSON.stringify({
        track: toMinimalPersistedTrack(payload.track), currentTime: payload.currentTime,
        queue: windowedQueue.map(toMinimalPersistedTrack), currentIndex: persistedIndex,
        volume: payload.volume, savedAt: this.deps.now(),
      }))
    } catch { /* Storage quota/security errors must not interrupt playback. */ }
  }
}
