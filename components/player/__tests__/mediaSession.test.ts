import { describe, expect, it, vi } from 'vitest';
import { bindMediaSession } from '@/components/player/runtime/mediaSessionBinding';
import { createPlaybackController } from '@/lib/playback/playbackController';
import type { PlaybackSourceService } from '@/lib/playback/playbackSourceService';
import type {
  PlaybackPersistencePort,
  PlaybackTransport,
  PlaybackUserEffects,
} from '@/lib/playback/ports';
import { makeTrack } from '@/lib/playback/__tests__/fixtures';

function createMediaSessionHarness() {
  let playing = false;
  const transport: PlaybackTransport = {
    start: vi.fn(async (_target, _owner, _vol, mode) => {
      playing = mode === 'play';
    }),
    pause: vi.fn(() => {
      playing = false;
    }),
    resume: vi.fn(async () => {
      playing = true;
    }),
    stop: vi.fn(() => {
      playing = false;
    }),
    seek: vi.fn(),
    setVolume: vi.fn(),
    read: () => ({ time: 10, duration: 180, playing }),
    subscribe: () => () => {},
    dispose: vi.fn(),
  };

  const sources: PlaybackSourceService = {
    resolveImmediate: vi.fn((req) => ({
      track: req.track,
      engine: 'html5' as const,
      target: `https://cdn.example/${req.track.id}.mp3`,
      initialTime: 0,
    })),
    resolvePlayable: vi.fn().mockResolvedValue(null),
    resolveFallback: vi.fn().mockResolvedValue(null),
    resolveYouTubeAlternate: vi.fn().mockResolvedValue(null),
    refreshStream: vi.fn().mockResolvedValue(null),
    searchYouTubeCandidate: vi.fn().mockResolvedValue(null),
    invalidateTrack: vi.fn().mockResolvedValue(undefined),
    prewarmUpcoming: vi.fn(),
    prewarmNextAdaptive: vi.fn(),
    prewarmNearEnd: vi.fn(),
    hydrateRestoredTrack: vi.fn().mockResolvedValue(null),
    dispose: vi.fn(),
  };

  const persistence: PlaybackPersistencePort = {
    restore: () => null,
    save: vi.fn(),
    updateTime: vi.fn(),
    flush: vi.fn(),
    getRepeat: () => 'off',
    setRepeat: vi.fn(),
    dispose: vi.fn(),
  };

  const userEffects: PlaybackUserEffects = {
    recordHistory: vi.fn(),
    recordListen: vi.fn(),
    setFavorite: vi.fn().mockResolvedValue(undefined),
    recommend: vi.fn().mockResolvedValue([]),
    dispose: vi.fn(),
  };

  const clock = {
    now: () => 1000,
    after: () => () => {},
    every: () => () => {},
  };

  const controller = createPlaybackController({
    clock,
    transport,
    sources,
    persistence,
    userEffects,
  });

  const registeredHandlers: Record<
    string,
    ((details?: MediaSessionActionDetails) => void) | null
  > = {};
  const mockMediaSession = {
    metadata: null as unknown,
    playbackState: 'none' as MediaSessionPlaybackState,
    setActionHandler: vi.fn(
      (
        action: string,
        handler: ((details?: MediaSessionActionDetails) => void) | null
      ) => {
        registeredHandlers[action] = handler;
      }
    ),
    setPositionState: vi.fn(),
  };

  const unbind = bindMediaSession(controller, {
    clock,
    mediaSession: mockMediaSession,
    createMetadata: (init) => init,
  });

  return {
    controller,
    transport,
    mockMediaSession,
    registeredHandlers,
    unbind,
  };
}

describe('MediaSession Safari Action Handlers', () => {
  it('registers nexttrack and previoustrack while keeping seekforward and seekbackward null for Safari compatibility', async () => {
    const { controller, mockMediaSession, registeredHandlers, unbind } =
      createMediaSessionHarness();

    const t1 = makeTrack('1');
    await controller.playTrack(t1, [t1], 0);

    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith(
      'nexttrack',
      expect.any(Function)
    );
    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith(
      'previoustrack',
      expect.any(Function)
    );
    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith(
      'seekbackward',
      null
    );
    expect(mockMediaSession.setActionHandler).toHaveBeenCalledWith(
      'seekforward',
      null
    );

    expect(typeof registeredHandlers.nexttrack).toBe('function');
    expect(typeof registeredHandlers.previoustrack).toBe('function');
    expect(registeredHandlers.seekbackward).toBeNull();
    expect(registeredHandlers.seekforward).toBeNull();

    unbind();
  });

  it('synchronizes desiredPlayStateRef intent when background lock-screen actions are dispatched', async () => {
    const { controller, transport, registeredHandlers, unbind } =
      createMediaSessionHarness();

    const t1 = makeTrack('1');
    const t2 = makeTrack('2');
    await controller.playTrack(t1, [t1, t2], 0);
    expect(controller.getSnapshot().isPlaying).toBe(true);

    // 1. User taps pause on lock screen
    registeredHandlers.pause?.();
    await new Promise(setImmediate);
    expect(transport.pause).toHaveBeenCalled();
    expect(controller.getSnapshot().isPlaying).toBe(false);

    // 2. User taps play on lock screen
    registeredHandlers.play?.();
    await new Promise(setImmediate);
    expect(transport.resume).toHaveBeenCalled();
    expect(controller.getSnapshot().isPlaying).toBe(true);

    // 3. User taps nexttrack on lock screen
    registeredHandlers.nexttrack?.();
    await new Promise(setImmediate);
    expect(controller.getSnapshot().currentTrack?.id).toBe('2');
    expect(controller.getSnapshot().isPlaying).toBe(true);

    // 4. User taps stop on lock screen
    registeredHandlers.stop?.();
    await new Promise(setImmediate);
    expect(controller.getSnapshot().isPlaying).toBe(false);

    unbind();
  });
});
