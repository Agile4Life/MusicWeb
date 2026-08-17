import { PlaybackEngine } from './types'
import { setAudioSourceForPlayback } from '../audioSourceSwitch'
import { playAudioElement } from '@/lib/audioPlayback'

export class Html5AudioEngine implements PlaybackEngine {
  readonly id = 'html5' as const
  private audio: HTMLAudioElement | null = null

  constructor(audioElement?: HTMLAudioElement | null) {
    this.audio = audioElement || null
  }

  setAudioElement(element: HTMLAudioElement | null) {
    this.audio = element
  }

  getAudioElement(): HTMLAudioElement | null {
    return this.audio
  }

  async loadAndPlay(url: string, initialTime = 0, volume = 0.8): Promise<void> {
    if (!this.audio) return
    setAudioSourceForPlayback(this.audio, url, volume, initialTime)
    await playAudioElement(this.audio)
  }

  pause(): void {
    if (!this.audio) return
    try {
      this.audio.pause()
    } catch {}
  }

  async resume(): Promise<void> {
    if (!this.audio) return
    await playAudioElement(this.audio)
  }

  stop(): void {
    if (!this.audio) return
    try {
      this.audio.pause()
      this.audio.currentTime = 0
      this.audio.removeAttribute('src')
    } catch {}
  }

  seek(time: number): void {
    if (!this.audio) return
    try {
      this.audio.currentTime = time
    } catch {}
  }

  setVolume(volume: number): void {
    if (!this.audio) return
    try {
      this.audio.volume = Math.max(0, Math.min(1, volume))
    } catch {}
  }

  getCurrentTime(): number {
    return this.audio?.currentTime || 0
  }

  getDuration(): number {
    const dur = this.audio?.duration
    return dur && !isNaN(dur) && dur !== Infinity ? dur : 0
  }

  isPlaying(): boolean {
    return Boolean(this.audio && !this.audio.paused && !this.audio.ended && this.audio.readyState > 2)
  }
}
