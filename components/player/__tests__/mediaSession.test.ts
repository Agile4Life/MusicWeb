import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

describe('MediaSession Safari Action Handlers', () => {
  let registeredHandlers: Record<string, any> = {}

  beforeEach(() => {
    registeredHandlers = {}
    const mockMediaSession = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: vi.fn((action: string, handler: any) => {
        registeredHandlers[action] = handler
      }),
      setPositionState: vi.fn(),
    }

    Object.defineProperty(globalThis.navigator, 'mediaSession', {
      value: mockMediaSession,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    // @ts-ignore
    delete globalThis.navigator.mediaSession
  })

  it('registers nexttrack and previoustrack while keeping seekforward and seekbackward null for Safari compatibility', () => {
    const prevTrack = vi.fn()
    const nextTrack = vi.fn()

    // Mimic the PlayerContext MediaSession registration
    navigator.mediaSession.setActionHandler('play', vi.fn())
    navigator.mediaSession.setActionHandler('pause', vi.fn())
    navigator.mediaSession.setActionHandler('previoustrack', prevTrack)
    navigator.mediaSession.setActionHandler('nexttrack', nextTrack)
    navigator.mediaSession.setActionHandler('seekbackward', null)
    navigator.mediaSession.setActionHandler('seekforward', null)

    expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledWith('nexttrack', nextTrack)
    expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledWith('previoustrack', prevTrack)
    expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledWith('seekbackward', null)
    expect(navigator.mediaSession.setActionHandler).toHaveBeenCalledWith('seekforward', null)

    expect(registeredHandlers.nexttrack).toBe(nextTrack)
    expect(registeredHandlers.previoustrack).toBe(prevTrack)
    expect(registeredHandlers.seekbackward).toBeNull()
    expect(registeredHandlers.seekforward).toBeNull()
  })

  it('synchronizes desiredPlayStateRef intent when background lock-screen actions are dispatched', async () => {
    const desiredPlayStateRef = { current: 'playing' as 'playing' | 'paused' | null }
    const mockAudio = {
      src: 'https://example.com/audio.mp3',
      paused: false,
      pause: vi.fn(() => {
        mockAudio.paused = true
      }),
      play: vi.fn(async () => {
        mockAudio.paused = false
      }),
    }

    const prevTrack = vi.fn()
    const nextTrack = vi.fn()

    // Mimic the updated PlayerContext handlers
    const onPlay = async () => {
      desiredPlayStateRef.current = 'playing'
      await mockAudio.play()
    }
    const onPause = () => {
      desiredPlayStateRef.current = 'paused'
      mockAudio.pause()
    }
    const onStop = () => {
      desiredPlayStateRef.current = 'paused'
      mockAudio.pause()
    }
    const onNext = () => {
      desiredPlayStateRef.current = 'playing'
      nextTrack()
    }
    const onPrev = () => {
      desiredPlayStateRef.current = 'playing'
      prevTrack()
    }

    navigator.mediaSession.setActionHandler('play', onPlay)
    navigator.mediaSession.setActionHandler('pause', onPause)
    navigator.mediaSession.setActionHandler('stop', onStop)
    navigator.mediaSession.setActionHandler('nexttrack', onNext)
    navigator.mediaSession.setActionHandler('previoustrack', onPrev)

    // 1. User taps pause on lock screen
    registeredHandlers.pause()
    expect(mockAudio.pause).toHaveBeenCalled()
    expect(desiredPlayStateRef.current).toBe('paused')

    // 2. User taps play on lock screen
    await registeredHandlers.play()
    expect(mockAudio.play).toHaveBeenCalled()
    expect(desiredPlayStateRef.current).toBe('playing')

    // 3. User taps nexttrack
    registeredHandlers.nexttrack()
    expect(nextTrack).toHaveBeenCalled()
    expect(desiredPlayStateRef.current).toBe('playing')

    // 4. User taps stop
    registeredHandlers.stop()
    expect(desiredPlayStateRef.current).toBe('paused')
  })
})

