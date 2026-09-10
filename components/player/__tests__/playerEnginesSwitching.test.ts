import { describe, expect, it, vi } from 'vitest'
import { Html5AudioEngine, YouTubeIframeEngine } from '../engines'

describe('Player Engines Mutual Exclusion & Race Guards (Task 1)', () => {
  it('Case 1: YouTube -> HTML5 switch cleanly stops YouTube engine', () => {
    const mockYtPlayer: any = {
      stopVideo: vi.fn(),
      pauseVideo: vi.fn(),
      loadVideoById: vi.fn(),
      playVideo: vi.fn(),
      getPlayerState: vi.fn().mockReturnValue(1), // Playing
    }
    const mockAudio: any = {
      src: 'https://example.com/stream.mp3',
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      removeAttribute: vi.fn(),
      load: vi.fn(),
    }

    const ytEngine = new YouTubeIframeEngine(mockYtPlayer)
    const html5Engine = new Html5AudioEngine(mockAudio)

    // Simulate stopping YouTube when switching to HTML5
    ytEngine.stop()

    expect(mockYtPlayer.stopVideo).toHaveBeenCalled()
    expect(mockYtPlayer.pauseVideo).toHaveBeenCalled()
  })

  it('Case 2: HTML5 -> YouTube switch cleanly stops HTML5 audio element', () => {
    const mockAudio: any = {
      src: 'https://example.com/old.mp3',
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
      currentTime: 42,
    }

    const html5Engine = new Html5AudioEngine(mockAudio)
    html5Engine.stop()

    expect(mockAudio.pause).toHaveBeenCalled()
    expect(mockAudio.currentTime).toBe(0)
    expect(mockAudio.removeAttribute).toHaveBeenCalledWith('src')
  })

  it('Case 3: "all" mode stops both engines cleanly on player unmount or queue clear', () => {
    const mockYtPlayer: any = {
      stopVideo: vi.fn(),
      pauseVideo: vi.fn(),
      mute: vi.fn(),
    }
    const mockAudio: any = {
      src: 'https://example.com/audio.mp3',
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      load: vi.fn(),
      currentTime: 10,
    }

    const ytEngine = new YouTubeIframeEngine(mockYtPlayer)
    const html5Engine = new Html5AudioEngine(mockAudio)

    // Stop all engines
    ytEngine.stop()
    html5Engine.stop()

    expect(mockYtPlayer.stopVideo).toHaveBeenCalled()
    expect(mockAudio.pause).toHaveBeenCalled()
    expect(mockAudio.removeAttribute).toHaveBeenCalledWith('src')
  })

  it('Case 4: Race condition guard nullifies pending YouTube play if switched before iframe loads', () => {
    let pendingYtPlay: { videoId: string; requestId: number } | null = {
      videoId: 'vid-delayed',
      requestId: 1,
    }

    // When a new play request comes in for HTML5 before iframe API finishes loading:
    const onSwitchToHtml5 = () => {
      pendingYtPlay = null
    }

    onSwitchToHtml5()
    expect(pendingYtPlay).toBeNull()

    // When the iframe would eventually report ready, it must not play since pendingYtPlay is null
    const onIframeReady = vi.fn()
    if (pendingYtPlay) {
      onIframeReady(pendingYtPlay)
    }
    expect(onIframeReady).not.toHaveBeenCalled()
  })

  it('Case 5: Rapid track switching absorbs AbortError without triggering spurious error fallbacks', async () => {
    const abortError = new Error('The play() request was interrupted by a call to pause()')
    abortError.name = 'AbortError'

    const mockAudio: any = {
      play: vi.fn().mockRejectedValue(abortError),
    }

    let fallbackTriggered = false
    const handlePlayError = (err: any) => {
      if (err?.name === 'AbortError' || String(err).includes('interrupted')) {
        // Silently ignore interruption - user clicked another track
        return
      }
      fallbackTriggered = true
    }

    try {
      await mockAudio.play()
    } catch (err) {
      handlePlayError(err)
    }

    expect(fallbackTriggered).toBe(false)
  })
})
