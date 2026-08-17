import { PlaybackEngine } from './types'

export class YouTubeIframeEngine implements PlaybackEngine {
  readonly id = 'youtube' as const
  private player: any = null
  private loadedVideoId: string | null = null

  constructor(playerInstance?: any) {
    this.player = playerInstance || null
  }

  setPlayerInstance(player: any) {
    this.player = player
  }

  getPlayerInstance(): any {
    return this.player
  }

  setLoadedVideoId(id: string | null) {
    this.loadedVideoId = id
  }

  getLoadedVideoId(): string | null {
    return this.loadedVideoId
  }

  getVideoDataId(): string | null {
    try {
      const data = this.player?.getVideoData?.()
      const id = data?.video_id
      return typeof id === 'string' && id.length > 0 ? id : null
    } catch {
      return null
    }
  }

  matchesVideo(targetVideoId?: string | null): boolean {
    if (!targetVideoId) return false
    const actualId = this.getVideoDataId()
    return (actualId !== null && actualId === targetVideoId) || (this.loadedVideoId === targetVideoId)
  }

  async loadAndPlay(videoId: string, initialTime = 0, volume = 0.8): Promise<void> {
    if (!this.player || !this.player.loadVideoById) {
      throw new Error('YouTube Player is not ready')
    }
    this.loadedVideoId = videoId
    try {
      if (this.player.unMute) this.player.unMute()
      if (this.player.setVolume) this.player.setVolume(Math.max(0, Math.min(1, volume)) * 100)
      this.player.loadVideoById({
        videoId,
        startSeconds: initialTime,
      })
      if (this.player.playVideo) {
        this.player.playVideo()
      }
    } catch (e) {
      console.warn('[YouTube Engine] loadAndPlay error:', e)
      throw e
    }
  }

  cueVideo(videoId: string, initialTime = 0): void {
    if (!this.player || !this.player.cueVideoById) return
    this.loadedVideoId = videoId
    try {
      this.player.cueVideoById({
        videoId,
        startSeconds: initialTime,
      })
    } catch (e) {
      console.warn('[YouTube Engine] cueVideo error:', e)
    }
  }

  pause(): void {
    if (!this.player) return
    try {
      if (this.player.pauseVideo) this.player.pauseVideo()
    } catch {}
  }

  async resume(): Promise<void> {
    if (!this.player) return
    try {
      if (this.player.playVideo) this.player.playVideo()
    } catch {}
  }

  stop(): void {
    if (!this.player) return
    try {
      if (this.player.mute) this.player.mute()
      if (this.player.stopVideo) this.player.stopVideo()
      if (this.player.pauseVideo) this.player.pauseVideo()
    } catch {}
  }

  seek(time: number): void {
    if (!this.player) return
    try {
      if (this.player.seekTo) this.player.seekTo(time, true)
    } catch {}
  }

  setVolume(volume: number): void {
    if (!this.player) return
    try {
      if (this.player.setVolume) this.player.setVolume(Math.max(0, Math.min(1, volume)) * 100)
    } catch {}
  }

  getCurrentTime(): number {
    try {
      return this.player?.getCurrentTime?.() || 0
    } catch {
      return 0
    }
  }

  getDuration(): number {
    try {
      return this.player?.getDuration?.() || 0
    } catch {
      return 0
    }
  }

  isPlaying(): boolean {
    try {
      // 1 = YT.PlayerState.PLAYING
      return this.player?.getPlayerState?.() === 1
    } catch {
      return false
    }
  }
}
