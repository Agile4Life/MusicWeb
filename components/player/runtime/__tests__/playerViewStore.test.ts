import { describe, expect, it, vi } from 'vitest';
import { createPlayerViewStore } from '@/components/player/playerViewStore';
import { createPlaybackController } from '@/lib/playback/playbackController';
import type { PlaybackSourceService } from '@/lib/playback/playbackSourceService';
import type {
  PlaybackEvent,
  PlaybackPersistencePort,
  PlaybackTransport,
  PlaybackUserEffects,
} from '@/lib/playback/ports';
import { makeTrack } from '@/lib/playback/__tests__/fixtures';

describe('playerViewStore', () => {
  it('keeps controls reference stable across track, queue, and progress updates', async () => {
    const listeners = new Set<(event: PlaybackEvent) => void>();
    const transport: PlaybackTransport & { emit(e: PlaybackEvent): void } = {
      start: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      resume: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      seek: vi.fn(),
      setVolume: vi.fn(),
      read: () => ({ time: 0, duration: 180, playing: true }),
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      dispose: vi.fn(),
      emit: (e) => {
        for (const l of listeners) l(e);
      },
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

    const controller = createPlaybackController({
      clock: {
        now: () => 1000,
        after: () => () => {},
        every: () => () => {},
      },
      transport,
      sources,
      persistence,
      userEffects,
    });

    const viewStore = createPlayerViewStore(controller);
    const initialSlices = viewStore.getSlices();
    const initialControls = initialSlices.controls;
    const initialQueueSlice = initialSlices.queue;

    const t1 = makeTrack('t-1');
    await controller.playTrack(t1, [t1], 0);
    const afterPlaySlices = viewStore.getSlices();

    expect(afterPlaySlices.controls).toBe(initialControls);
    expect(afterPlaySlices.track.currentTrack?.id).toBe('t-1');
    expect(afterPlaySlices.queue).not.toBe(initialQueueSlice);

    // Changing only track-level state (toggleShuffle) keeps queueSlice and controls identical
    const queueBeforeShuffle = afterPlaySlices.queue;
    controller.toggleShuffle();
    const afterShuffleSlices = viewStore.getSlices();

    expect(afterShuffleSlices.controls).toBe(initialControls);
    expect(afterShuffleSlices.queue).toBe(queueBeforeShuffle);
    expect(afterShuffleSlices.track.isShuffle).toBe(true);

    // High-frequency progress updates do not notify viewStore subscribers or mutate view slices
    const viewSubscriber = vi.fn();
    viewStore.subscribe(viewSubscriber);
    const owner = vi.mocked(transport.start).mock.calls[0][1];
    transport.emit({ type: 'time', owner, time: 15, duration: 180 });

    expect(viewSubscriber).not.toHaveBeenCalled();
    expect(viewStore.getSlices()).toBe(afterShuffleSlices);
  });
});
