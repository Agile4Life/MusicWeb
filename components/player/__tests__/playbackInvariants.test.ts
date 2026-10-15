import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
import type { Track } from '@/types';

function createHarness() {
  let liveTime = 0;
  const listeners = new Set<(event: PlaybackEvent) => void>();
  const transport: PlaybackTransport & {
    emit(e: PlaybackEvent): void;
    setLiveTime(t: number): void;
  } = {
    start: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    seek: vi.fn((t) => {
      liveTime = t;
    }),
    setVolume: vi.fn(),
    read: () => ({ time: liveTime, duration: 180, playing: true }),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    dispose: vi.fn(),
    emit: (e) => {
      for (const l of listeners) l(e);
    },
    setLiveTime: (t) => {
      liveTime = t;
    },
  };

  const sources: PlaybackSourceService = {
    resolveImmediate: vi.fn((req) => ({
      track: req.track,
      engine: 'html5' as const,
      target: `https://cdn.example/${req.track.id}.mp3`,
      initialTime: req.initialTime,
    })),
    resolvePlayable: vi.fn(async (req) => ({
      track: req.track,
      engine: 'html5' as const,
      target: `https://cdn.example/${req.track.id}.mp3`,
      initialTime: req.initialTime,
    })),
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
  return { controller, viewStore, transport, sources, userEffects };
}

describe('queue writes', () => {
  it('only commitQueue calls setQueue (ref and state can never diverge)', async () => {
    const source = readFileSync(
      path.resolve(__dirname, '../PlayerContext.tsx'),
      'utf8'
    );
    // PlayerContext is a thin subscription provider and never keeps a duplicate queue useState
    expect(source).not.toMatch(/\bsetQueue\(/);

    const { controller, viewStore } = createHarness();
    const t1 = makeTrack('A');
    const t2 = makeTrack('B');
    await controller.playTrack(t1, [t1, t2], 0);
    expect(viewStore.getSlices().queue.queue).toBe(
      controller.getSnapshot().queue
    );

    controller.addToQueue(makeTrack('C'));
    expect(viewStore.getSlices().queue.queue).toBe(
      controller.getSnapshot().queue
    );
  });

  it('removeFromQueue does not filter the already-filtered queue a second time', async () => {
    const { controller } = createHarness();
    const a = makeTrack('A');
    const b = makeTrack('B');
    const c = makeTrack('C');
    await controller.playTrack(a, [a, b, c], 0);

    controller.removeFromQueue(1);
    expect(controller.getSnapshot().queue.map((t) => t.id)).toEqual(['A', 'C']);
    expect(controller.getSnapshot().currentIndex).toBe(0);
  });
});

describe('skip analytics', () => {
  it('both playTrack and quick-play report the skipped track', async () => {
    const { controller, transport, userEffects } = createHarness();
    const a = makeTrack('A', { duration: 200 });
    const b = makeTrack('B', { duration: 200 });
    const c = makeTrack('C', { duration: 200 });

    await controller.playTrack(a, [a, b, c], 0);
    // Listen for 25s (skipped before completion)
    transport.setLiveTime(25);

    // 1. playTrack replaces A -> reports skip for A
    await controller.playTrack(b, [a, b, c], 1);
    expect(userEffects.recordListen).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'A' }),
      false,
      25
    );

    // 2. nextTrack uses synchronous quick-play from resolveImmediate -> reports skip for B
    transport.setLiveTime(30);
    controller.nextTrack();
    expect(userEffects.recordListen).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'B' }),
      false,
      30
    );
  });
});

describe('caller object safety', () => {
  it('playTrack never assigns onto the caller-provided rawTrack', async () => {
    const { controller } = createHarness();
    const rawTrack: Track = Object.freeze({
      id: 'spotify-track-1',
      title: 'Frozen Track',
      artist: 'Frozen Artist',
      album: 'Album',
      duration: 180,
      file_path: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      cover_url: null,
      user_id: 'u1',
      created_at: '2026-01-01T00:00:00Z',
    } as Track);

    await expect(controller.playTrack(rawTrack)).resolves.toBeUndefined();
    expect(rawTrack.source).toBeUndefined();
    expect(controller.getSnapshot().currentTrack?.source).toBe('youtube');
  });
});

describe('smart queue fill', () => {
  it('does not use a boolean in-flight flag that drops newer seeds', async () => {
    const { controller, userEffects } = createHarness();
    const signals: AbortSignal[] = [];
    let resolveFirst!: (tracks: Track[]) => void;

    vi.mocked(userEffects.recommend).mockImplementation((seed, _q, signal) => {
      signals.push(signal);
      if (seed.id === 'seed-1') {
        return new Promise<Track[]>((r) => {
          resolveFirst = r;
        });
      }
      return Promise.resolve([makeTrack('rec-from-seed-2')]);
    });

    const seed1 = makeTrack('seed-1');
    const seed2 = makeTrack('seed-2');

    await controller.playTrack(seed1, [seed1], 0);
    await controller.playTrack(seed2, [seed2], 0);

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    // Even if seed-1 finishes late, seed-2's recommendations are kept and seed-1 is ignored
    resolveFirst([makeTrack('stale-rec-from-seed-1')]);
    await Promise.resolve();

    expect(controller.getSnapshot().queue.map((t) => t.id)).toEqual([
      'seed-2',
      'rec-from-seed-2',
    ]);
  });
});
