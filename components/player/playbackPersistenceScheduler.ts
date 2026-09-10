import type { Track } from '@/types'

export const STORAGE_KEY_PLAYER_STATE = 'musicweb_player_state'
export const MAX_PERSISTED_TRACKS = 150
export const PERSISTENCE_DEBOUNCE_MS = 15000 // 15s cadence during continuous playback

export function toMinimalPersistedTrack(track: Track): Partial<Track> {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    artwork_url: track.artwork_url,
    duration: track.duration,
    source: track.source,
    file_path: track.file_path,
    drive_file_id: track.drive_file_id,
    nhaccuatui_id: track.nhaccuatui_id,
    youtube_id: track.youtube_id,
    soundcloud_id: track.soundcloud_id,
    audio_url: track.audio_url,
    spotify_id: track.spotify_id,
    itunes_id: track.itunes_id,
    album: track.album,
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

export class PlaybackPersistenceScheduler {
  private pendingPayload: PersistStatePayload | null = null
  private timer: any = null
  private idleCallbackId: any = null

  /**
   * Immediately saves state to localStorage without delay.
   * Clears any pending debounced timers.
   */
  public saveImmediate(payload: PersistStatePayload): void {
    this.cancelScheduled()
    this.pendingPayload = null
    this.writeToStorage(payload)
  }

  /**
   * Schedules a debounced persistence write (default 15s).
   * Batches frequent timeupdate calls and defers actual write via requestIdleCallback.
   */
  public scheduleDebounced(payload: PersistStatePayload): void {
    this.pendingPayload = payload

    if (this.timer !== null) return

    this.timer = setTimeout(() => {
      this.timer = null
      this.runOnIdle(() => {
        if (this.pendingPayload) {
          const toSave = this.pendingPayload
          this.pendingPayload = null
          this.writeToStorage(toSave)
        }
      })
    }, PERSISTENCE_DEBOUNCE_MS)
  }

  /**
   * Updates the currentTime on any pending save payload without resetting the timer.
   * Useful when time advances continuously before a flush.
   */
  public updatePendingTime(currentTime: number): void {
    if (this.pendingPayload) {
      this.pendingPayload.currentTime = currentTime
    }
  }

  /**
   * Flushes any pending debounced write immediately.
   * Essential for window.pagehide, document.visibilitychange ('hidden'), and beforeunload on iOS Safari.
   */
  public flushPending(): void {
    this.cancelScheduled()
    if (this.pendingPayload) {
      const toSave = this.pendingPayload
      this.pendingPayload = null
      this.writeToStorage(toSave)
    }
  }

  /**
   * Cancels any pending timers or idle callbacks.
   */
  public cancelScheduled(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.idleCallbackId !== null) {
      if (typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(this.idleCallbackId)
      }
      this.idleCallbackId = null
    }
  }

  private runOnIdle(action: () => void): void {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      this.idleCallbackId = window.requestIdleCallback(
        () => {
          this.idleCallbackId = null
          action()
        },
        { timeout: 2000 }
      )
    } else {
      action()
    }
  }

  private writeToStorage(payload: PersistStatePayload): void {
    if (typeof localStorage === 'undefined' || !payload.track) return
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

      localStorage.setItem(
        STORAGE_KEY_PLAYER_STATE,
        JSON.stringify({
          track: toMinimalPersistedTrack(payload.track),
          currentTime: payload.currentTime,
          queue: windowedQueue.map(toMinimalPersistedTrack),
          currentIndex: persistedIndex,
          volume: payload.volume,
          savedAt: Date.now(),
        })
      )
    } catch {
      // ignore storage error
    }
  }
}
