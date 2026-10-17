import { describe, expect, it, vi } from 'vitest';
import { bindMediaSession, type MediaSessionLike } from '../mediaSessionBinding';
import type { PlaybackController, PlaybackSnapshot } from '@/lib/playback/controllerTypes';
import { makeTrack } from '@/lib/playback/__tests__/fixtures';

describe('mediaSessionBinding', () => {
  it('syncs metadata, keeps playbackState playing while buffering, and explicitly sets seek handlers to null', () => {
    const handlers = new Map<string, (() => void) | null>();
    const setPositionState = vi.fn();
    const fakeMediaSession: MediaSessionLike = {
      metadata: null,
      playbackState: 'none',
      setActionHandler: vi.fn((action, handler) => {
        handlers.set(action, handler);
      }),
      setPositionState,
    };

    let snapshot: PlaybackSnapshot = {
      currentTrack: makeTrack('t-1', {
        title: 'Nơi Này Có Anh',
        artist: 'Sơn Tùng M-TP',
        album: 'Single',
        cover_url: '/cover.png',
      }),
      isPlaying: false,
      isBuffering: true,
      volume: 0.8,
      isShuffle: false,
      repeatMode: 'off',
      autoPlayNext: true,
      playbackError: null,
      mvIntroOffset: 0,
      queue: [],
      currentIndex: 0,
      isQueueOpen: false,
      isNowPlayingOpen: false,
    };

    const listeners = new Set<() => void>();
    const controller = {
      getSnapshot: () => snapshot,
      getProgress: () => ({ currentTime: 35, duration: 240 }),
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      togglePlay: vi.fn().mockResolvedValue(undefined),
      nextTrack: vi.fn(),
      prevTrack: vi.fn(),
    } as unknown as PlaybackController;

    let positionTick: (() => void) | null = null;
    const dispose = bindMediaSession(controller, {
      clock: {
        now: () => 1000,
        after: () => () => {},
        every: (_ms, cb) => {
          positionTick = cb;
          return () => {
            positionTick = null;
          };
        },
      },
      mediaSession: fakeMediaSession,
      origin: 'https://music.example.com',
      createMetadata: (init) => init,
    });

    // Keeps playbackState = 'playing' while buffering a track transition
    expect(fakeMediaSession.playbackState).toBe('playing');
    expect(fakeMediaSession.metadata).toEqual(
      expect.objectContaining({
        title: 'Nơi Này Có Anh',
        artist: 'Sơn Tùng M-TP',
      })
    );

    // Seek handlers must be explicitly cleared to null for Android Chrome lock-screen Next/Prev buttons
    expect(handlers.get('seekbackward')).toBeNull();
    expect(handlers.get('seekforward')).toBeNull();
    expect(handlers.get('seekto')).toBeNull();

    // Transition to playing immediately syncs setPositionState AND starts 1s position polling
    snapshot = { ...snapshot, isPlaying: true, isBuffering: false };
    for (const l of listeners) l();
    expect(setPositionState).toHaveBeenCalledWith({
      duration: 240,
      playbackRate: 1,
      position: 35,
    });
    expect(positionTick).toBeTypeOf('function');
    setPositionState.mockClear();
    positionTick!();
    expect(setPositionState).toHaveBeenCalledWith({
      duration: 240,
      playbackRate: 1,
      position: 35,
    });

    // Action handlers delegate to controller
    handlers.get('nexttrack')?.();
    handlers.get('previoustrack')?.();
    expect(controller.nextTrack).toHaveBeenCalledTimes(1);
    expect(controller.prevTrack).toHaveBeenCalledTimes(1);

    dispose();
    expect(positionTick).toBeNull();
  });
});
