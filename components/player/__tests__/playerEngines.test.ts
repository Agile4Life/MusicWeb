import { describe, expect, it, vi } from 'vitest'
import { Html5AudioEngine, YouTubeIframeEngine } from '../engines'

describe('Playback Engines Abstraction', () => {
  it('Html5AudioEngine provides full PlaybackEngine interface', () => {
    const mockAudio: any = {
      src: '',
      volume: 1,
      currentTime: 0,
      duration: 120,
      paused: true,
      ended: false,
      readyState: 4,
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      removeAttribute: vi.fn(),
    }

    const engine = new Html5AudioEngine(mockAudio)
    expect(engine.id).toBe('html5')
    expect(engine.getAudioElement()).toBe(mockAudio)

    engine.setVolume(0.5)
    expect(mockAudio.volume).toBe(0.5)

    engine.seek(45)
    expect(mockAudio.currentTime).toBe(45)

    engine.pause()
    expect(mockAudio.pause).toHaveBeenCalled()

    engine.stop()
    expect(mockAudio.removeAttribute).toHaveBeenCalledWith('src')
  })

  it('YouTubeIframeEngine provides full PlaybackEngine interface and video matching', () => {
    const mockYtPlayer: any = {
      unMute: vi.fn(),
      setVolume: vi.fn(),
      loadVideoById: vi.fn(),
      playVideo: vi.fn(),
      pauseVideo: vi.fn(),
      stopVideo: vi.fn(),
      seekTo: vi.fn(),
      getCurrentTime: vi.fn().mockReturnValue(30),
      getDuration: vi.fn().mockReturnValue(180),
      getPlayerState: vi.fn().mockReturnValue(1),
      getVideoData: vi.fn().mockReturnValue({ video_id: 'vid-xyz' }),
    }

    const engine = new YouTubeIframeEngine(mockYtPlayer)
    expect(engine.id).toBe('youtube')

    expect(engine.matchesVideo('vid-xyz')).toBe(true)
    expect(engine.matchesVideo('vid-other')).toBe(false)

    engine.setLoadedVideoId('vid-fallback')
    // When getVideoData is empty, fallback matches loadedVideoId
    mockYtPlayer.getVideoData.mockReturnValue(null)
    expect(engine.matchesVideo('vid-fallback')).toBe(true)

    engine.setVolume(0.8)
    expect(mockYtPlayer.setVolume).toHaveBeenCalledWith(80)

    engine.seek(60)
    expect(mockYtPlayer.seekTo).toHaveBeenCalledWith(60, true)

    expect(engine.getCurrentTime()).toBe(30)
    expect(engine.getDuration()).toBe(180)
    expect(engine.isPlaying()).toBe(true)
  })
})
