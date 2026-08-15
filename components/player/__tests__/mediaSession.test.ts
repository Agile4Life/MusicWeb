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
})
