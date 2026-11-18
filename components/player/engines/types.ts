export interface PlaybackEngine {
  readonly id: 'html5' | 'youtube'
  loadAndPlay(target: string, initialTime?: number, volume?: number): Promise<void>
  pause(): void
  resume(): Promise<void>
  stop(): void
  seek(time: number): void
  setVolume(volume: number): void
  getCurrentTime(): number
  getDuration(): number
  isPlaying(): boolean
}
