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

const CONTROL_NAMES = [
  'playTrack',
  'playSearchTrack',
  'togglePlay',
  'seek',
  'setVolume',
  'nextTrack',
  'prevTrack',
  'toggleShuffle',
  'toggleRepeat',
  'toggleFavoriteCurrentTrack',
  'addToQueue',
  'removeFromQueue',
  'clearQueue',
] as const;

function createHarness() {
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
  return { controller, viewStore, transport };
}

describe('controls context callbacks stay referentially stable', () => {
  it('finds the controls members', () => {
    const { viewStore } = createHarness();
    const controls = viewStore.getControls();
    for (const name of CONTROL_NAMES) {
      expect(typeof controls[name]).toBe('function');
    }
  });

  for (const name of CONTROL_NAMES) {
    it(`${name} does not depend on volatile state`, async () => {
      const { controller, viewStore, transport } = createHarness();
      const before = viewStore.getControls()[name];

      const t1 = makeTrack('1');
      const t2 = makeTrack('2');
      await controller.playTrack(t1, [t1, t2], 0);
      await controller.togglePlay();
      controller.seek(42);
      controller.setVolume(0.5);
      controller.toggleShuffle();
      controller.toggleRepeat();
      controller.addToQueue(makeTrack('3'));

      const owner = vi.mocked(transport.start).mock.calls[0]?.[1];
      if (owner) {
        transport.emit({ type: 'time', owner, time: 30, duration: 180 });
      }

      const after = viewStore.getSlices().controls[name];
      expect(after).toBe(before);
    });
  }
});
