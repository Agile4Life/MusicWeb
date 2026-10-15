import type { Track } from '@/types'
import type { PersistStatePayload } from '@/components/player/playbackPersistenceScheduler'

export type Cancel = () => void
export interface PlaybackClock {
  now(): number
  after(ms: number, callback: () => void): Cancel
  every(ms: number, callback: () => void): Cancel
}
export interface PlaybackOwner {
  requestId: number
  generation: number
  trackId: string
}
export interface PreparedPlayback {
  track: Track
  engine: 'html5' | 'youtube'
  target: string
  initialTime: number
}
export interface PlaybackPersistencePort {
  restore(): PersistStatePayload | null
  save(payload: PersistStatePayload, immediate?: boolean): void
  updateTime(time: number): void
  flush(): void
  getRepeat(): 'off' | 'all' | 'one'
  setRepeat(value: 'off' | 'all' | 'one'): void
  dispose(): void
}
export interface PlaybackUserEffects {
  recordHistory(track: Track): void
  recordListen(track: Track, completed: boolean, skipAtSeconds?: number): void
  setFavorite(track: Track, nextValue: boolean): Promise<void>
  recommend(seed: Track, queue: Track[], signal: AbortSignal): Promise<Track[]>
  dispose(): void
}
export type PlaybackEvent =
  | { type: 'playing' | 'paused' | 'ended'; owner: PlaybackOwner }
  | { type: 'time'; owner: PlaybackOwner; time: number; duration: number }
  | { type: 'buffering'; owner: PlaybackOwner; value: boolean }
  | { type: 'error'; owner: PlaybackOwner; error: unknown }
export interface PlaybackTransport {
  start(target: PreparedPlayback, owner: PlaybackOwner, volume: number,
    mode: 'play' | 'paused'): Promise<void>
  pause(): void
  resume(): Promise<void>
  stop(): void
  seek(time: number): void
  setVolume(volume: number): void
  read(): { time: number; duration: number; playing: boolean }
  subscribe(listener: (event: PlaybackEvent) => void): Cancel
  dispose(): void
}
