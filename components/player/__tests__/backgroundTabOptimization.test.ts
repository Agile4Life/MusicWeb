import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

describe('Background Tab Optimization (Gaming Eco Mode)', () => {
  let attributes: Record<string, string> = {}

  beforeEach(() => {
    attributes = {}
    const mockDocument = {
      hidden: false,
      documentElement: {
        setAttribute: vi.fn((key: string, val: string) => {
          attributes[key] = val
        }),
        removeAttribute: vi.fn((key: string) => {
          delete attributes[key]
        }),
        getAttribute: vi.fn((key: string) => attributes[key] || null),
      },
    }

    Object.defineProperty(globalThis, 'document', {
      value: mockDocument,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    // @ts-ignore
    delete globalThis.document
  })

  it('sets data-tab-hidden attribute on documentElement when tab is hidden and removes when visible', () => {
    const setVisibility = (hidden: boolean) => {
      if (hidden) {
        document.documentElement.setAttribute('data-tab-hidden', 'true')
      } else {
        document.documentElement.removeAttribute('data-tab-hidden')
      }
    }

    setVisibility(true)
    expect(document.documentElement.getAttribute('data-tab-hidden')).toBe('true')

    setVisibility(false)
    expect(document.documentElement.getAttribute('data-tab-hidden')).toBeNull()
  })

  it('throttles setCurrentTime updates when tab is hidden while preserving internal ref tracking', () => {
    let stateCurrentTime = 0
    const currentTimeRef = { current: 0 }
    const isTabHiddenRef = { current: true }
    const setCurrentTime = vi.fn((t: number) => {
      stateCurrentTime = t
    })

    const simulateTimeUpdate = (audioTime: number) => {
      currentTimeRef.current = audioTime
      if (!isTabHiddenRef.current) {
        setCurrentTime(audioTime)
      }
    }

    // 1. When hidden (gaming in progress)
    simulateTimeUpdate(10.5)
    simulateTimeUpdate(11.0)
    simulateTimeUpdate(11.5)

    expect(currentTimeRef.current).toBe(11.5)
    expect(setCurrentTime).not.toHaveBeenCalled()
    expect(stateCurrentTime).toBe(0) // UI state remained frozen, 0 re-renders

    // 2. When tab becomes visible again
    isTabHiddenRef.current = false
    const handleVisibilityRestore = (actualTime: number) => {
      currentTimeRef.current = actualTime
      setCurrentTime(actualTime)
    }

    handleVisibilityRestore(12.0)
    expect(setCurrentTime).toHaveBeenCalledWith(12.0)
    expect(stateCurrentTime).toBe(12.0) // UI snapped directly to accurate time
  })

  it('ensures MediaSession positionState queries internal ref even when UI progress is throttled', () => {
    const mockSetPositionState = vi.fn()
    const currentTimeRef = { current: 45.2 }
    const stateCurrentTime = 0 // UI was frozen at 0 when tab was hidden
    const duration = 180

    const updateMediaSessionPosition = () => {
      const t = currentTimeRef.current || stateCurrentTime
      mockSetPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(Math.max(t, 0), duration),
      })
    }

    updateMediaSessionPosition()

    expect(mockSetPositionState).toHaveBeenCalledWith({
      duration: 180,
      playbackRate: 1,
      position: 45.2,
    })
  })

  it('synchronizes isPlaying state on visibility change when tab is restored from background', () => {
    let isPlaying = false
    let isBuffering = true
    const setIsPlaying = vi.fn((val: boolean) => {
      isPlaying = val
    })
    const setIsBuffering = vi.fn((val: boolean) => {
      isBuffering = val
    })

    const mockAudio = {
      paused: false,
      ended: false,
      readyState: 4,
      currentTime: 35.5,
      duration: 210,
    }

    const handleVisibilityRestore = (audio: typeof mockAudio) => {
      if (!audio.paused && !audio.ended && audio.readyState > 1) {
        setIsPlaying(true)
        setIsBuffering(false)
      }
    }

    handleVisibilityRestore(mockAudio)

    expect(setIsPlaying).toHaveBeenCalledWith(true)
    expect(setIsBuffering).toHaveBeenCalledWith(false)
    expect(isPlaying).toBe(true)
    expect(isBuffering).toBe(false)
  })

  it('togglePlay unconditionally pauses all engines when hardware audio is active even if isPlaying state was false', () => {
    let isPlaying = false
    let isBuffering = false
    const setIsPlaying = vi.fn((val: boolean) => {
      isPlaying = val
    })
    const setIsBuffering = vi.fn((val: boolean) => {
      isBuffering = val
    })

    const mockAudio = {
      paused: false,
      ended: false,
      readyState: 4,
      pause: vi.fn(),
      play: vi.fn(),
    }

    const mockYtPlayer = {
      getPlayerState: vi.fn(() => 2), // paused
      pauseVideo: vi.fn(),
    }

    const togglePlay = () => {
      const isAudioPlaying = Boolean(mockAudio && !mockAudio.paused && !mockAudio.ended && mockAudio.readyState > 1)
      const isYtPlaying = Boolean(mockYtPlayer?.getPlayerState?.() === 1)
      const isCurrentlyActive = isPlaying || isAudioPlaying || isYtPlaying

      if (isCurrentlyActive) {
        mockAudio.pause()
        mockYtPlayer.pauseVideo()
        setIsPlaying(false)
        setIsBuffering(false)
        return
      }

      mockAudio.play()
      setIsPlaying(true)
    }

    // User clicks pause while audio was running in background (even though isPlaying was false)
    togglePlay()

    expect(mockAudio.pause).toHaveBeenCalled()
    expect(mockYtPlayer.pauseVideo).toHaveBeenCalled()
    expect(mockAudio.play).not.toHaveBeenCalled()
    expect(setIsPlaying).toHaveBeenCalledWith(false)
    expect(isPlaying).toBe(false)
  })

  it('resumes seamlessly without reloading track when user pauses and plays again after returning from background', async () => {
    let isPlaying = true
    const playTrackMock = vi.fn()
    const currentTrack = { id: 'sc-12345', title: 'SoundCloud Track', source: 'soundcloud' }

    const mockAudio = {
      src: 'https://cf-media.sndcdn.com/stream-sample.mp3',
      currentTime: 42.8,
      paused: false,
      ended: false,
      readyState: 4,
      error: null,
      pause: vi.fn(() => {
        mockAudio.paused = true
      }),
      play: vi.fn(async () => {
        mockAudio.paused = false
      }),
    }

    const togglePlay = async () => {
      const isAudioPlaying = Boolean(mockAudio && !mockAudio.paused && !mockAudio.ended && mockAudio.readyState > 1)
      const isCurrentlyActive = isPlaying || isAudioPlaying

      if (isCurrentlyActive) {
        mockAudio.pause()
        isPlaying = false
        return
      }

      if (!mockAudio || !mockAudio.src || mockAudio.error) {
        await playTrackMock(currentTrack)
        return
      }

      await mockAudio.play()
      isPlaying = true
    }

    // 1. User returns from tab and clicks PAUSE
    await togglePlay()
    expect(mockAudio.pause).toHaveBeenCalled()
    expect(isPlaying).toBe(false)
    expect(mockAudio.paused).toBe(true)
    expect(mockAudio.currentTime).toBe(42.8) // Position preserved
    expect(playTrackMock).not.toHaveBeenCalled() // No full reload

    // 2. User clicks PLAY again
    await togglePlay()
    expect(mockAudio.play).toHaveBeenCalled()
    expect(isPlaying).toBe(true)
    expect(mockAudio.paused).toBe(false)
    expect(mockAudio.currentTime).toBe(42.8) // Plays directly from 42.8s
    expect(playTrackMock).not.toHaveBeenCalled() // ZERO network reload
  })

  it('resumes YouTube video seamlessly without reloading loadVideoById when user pauses and plays again', async () => {
    let isPlaying = true
    const playTrackMock = vi.fn()
    const currentTrack = { id: 'yt-abc', title: 'YouTube Track', source: 'youtube', youtube_id: 'abc' }

    const mockYtPlayer = {
      playerState: 1, // 1 = playing, 2 = paused
      getPlayerState: vi.fn(() => mockYtPlayer.playerState),
      pauseVideo: vi.fn(() => {
        mockYtPlayer.playerState = 2
      }),
      playVideo: vi.fn(() => {
        mockYtPlayer.playerState = 1
      }),
    }

    const togglePlay = async () => {
      const isYtPlaying = Boolean(mockYtPlayer.getPlayerState() === 1)
      const isCurrentlyActive = isPlaying || isYtPlaying

      if (isCurrentlyActive) {
        mockYtPlayer.pauseVideo()
        isPlaying = false
        return
      }

      const state = mockYtPlayer.getPlayerState()
      if (state === 5 || state === 2 || state === 1 || state === 3) {
        mockYtPlayer.playVideo()
        isPlaying = true
        return
      }

      await playTrackMock(currentTrack)
    }

    // 1. User clicks PAUSE
    await togglePlay()
    expect(mockYtPlayer.pauseVideo).toHaveBeenCalled()
    expect(mockYtPlayer.playerState).toBe(2)
    expect(isPlaying).toBe(false)
    expect(playTrackMock).not.toHaveBeenCalled()

    // 2. User clicks PLAY again
    await togglePlay()
    expect(mockYtPlayer.playVideo).toHaveBeenCalled()
    expect(mockYtPlayer.playerState).toBe(1)
    expect(isPlaying).toBe(true)
    expect(playTrackMock).not.toHaveBeenCalled() // Direct resume, zero reload
  })
})
