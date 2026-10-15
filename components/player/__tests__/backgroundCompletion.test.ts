import { describe, expect, it, vi } from 'vitest';
import { bindBrowserLifecycle } from '@/components/player/runtime/browserLifecycle';
import { createPlaybackController } from '@/lib/playback/playbackController';
import type { PlaybackSourceService } from '@/lib/playback/playbackSourceService';
import type {
  PlaybackEvent,
  PlaybackPersistencePort,
  PlaybackTransport,
  PlaybackUserEffects,
} from '@/lib/playback/ports';
import { makeTrack } from '@/lib/playback/__tests__/fixtures';

describe('background end-of-track recovery', () => {
  async function playback(
    workerSupport: 'working' | 'missing' | 'throws' = 'working',
    engineMode: 'html5' | 'youtube' = 'html5'
  ) {
    const workers: Array<{
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: ErrorEvent) => void) | null;
      postMessage: ReturnType<typeof vi.fn>;
      terminate: ReturnType<typeof vi.fn>;
    }> = [];

    let timerTick = () => {};
    const clock = {
      now: () => 1000,
      after: () => () => {},
      every: (ms: number, fn: () => void) => {
        if (ms === 1500) {
          timerTick = fn;
        }
        return () => {};
      },
    };

    const html5Position = { time: 179.4, duration: 180, playing: true };
    const youtubePosition = { time: 179.4, duration: 180, playing: true };
    let currentEngine: 'html5' | 'youtube' = engineMode;
    let resumeCalls = 0;
    let seekTime = 179.4;

    const listeners = new Set<(event: PlaybackEvent) => void>();
    const transport: PlaybackTransport = {
      start: vi.fn(async (target) => {
        currentEngine = target.engine;
        seekTime = target.initialTime;
      }),
      pause: vi.fn(() => {
        html5Position.playing = false;
      }),
      resume: vi.fn(async () => {
        resumeCalls += 1;
        html5Position.playing = true;
      }),
      stop: vi.fn(),
      seek: vi.fn((seconds) => {
        seekTime = seconds;
        html5Position.time = seconds;
      }),
      setVolume: vi.fn(),
      read: () =>
        currentEngine === 'youtube' ? youtubePosition : html5Position,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      dispose: vi.fn(),
    };

    const sources: PlaybackSourceService = {
      resolveImmediate: vi.fn((req) =>
        engineMode === 'html5'
          ? {
              track: req.track,
              engine: 'html5' as const,
              target: `https://cdn.example/${req.track.id}.mp3`,
              initialTime: req.initialTime,
            }
          : null
      ),
      resolvePlayable: vi.fn(async (req) => ({
        track: req.track,
        engine: engineMode,
        target:
          engineMode === 'youtube'
            ? 'dQw4w9WgXcQ'
            : `https://cdn.example/${req.track.id}.mp3`,
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
      clock,
      transport,
      sources,
      persistence,
      userEffects,
    });

    const trackA = makeTrack('A', { duration: 180 });
    const trackB = makeTrack('B', { duration: 180 });
    await controller.playTrack(trackA, [trackA, trackB], 0);
    controller.handleVisibilityChange(true);

    const visibilityListeners = new Set<() => void>();
    const fakeDoc = {
      hidden: true,
      documentElement: {
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      },
      addEventListener: vi.fn((type: string, fn: () => void) => {
        if (type === 'visibilitychange') visibilityListeners.add(fn);
      }),
      removeEventListener: vi.fn((type: string, fn: () => void) => {
        if (type === 'visibilitychange') visibilityListeners.delete(fn);
      }),
    } as unknown as Document & { hidden: boolean };

    const fakeWin = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;

    const cleanup = bindBrowserLifecycle(controller, {
      clock,
      doc: fakeDoc,
      win: fakeWin,
      createWorker: () => {
        if (workerSupport === 'missing') return null;
        if (workerSupport === 'throws') {
          throw new Error('Worker unavailable');
        }
        const instance = {
          onmessage: null,
          onerror: null,
          postMessage: vi.fn(),
          terminate: vi.fn(),
        };
        workers.push(instance);
        return instance as unknown as Worker;
      },
    });

    return {
      controller,
      workers,
      cleanup,
      timerTick,
      html5Position,
      youtubePosition,
      fakeDoc,
      emitVisibilityChange: () => {
        visibilityListeners.forEach((fn) => fn());
      },
      getResumeCalls: () => resumeCalls,
      getSeekTime: () => seekTime,
      trackA,
      trackB,
    };
  }

  it('advances at EOF through worker messages even when window timers and ended are delayed', async () => {
    const { controller, workers, cleanup } = await playback();
    expect(workers).toHaveLength(1);
    workers[0].onmessage?.({ data: 'tick' } as MessageEvent);
    workers[0].onmessage?.({ data: 'tick' } as MessageEvent);
    expect(controller.getSnapshot().currentTrack?.id).toBe('B');
    expect(controller.getSnapshot().currentIndex).toBe(1);
    cleanup();
  });

  it.each(['pause', 'foreground', 'stale-owner', 'middle-of-track'] as const)(
    'does not advance after %s',
    async (change) => {
      const {
        controller,
        workers,
        cleanup,
        html5Position,
        fakeDoc,
        emitVisibilityChange,
        trackA,
        trackB,
      } = await playback();
      expect(workers).toHaveLength(1);
      if (change === 'pause') {
        await controller.togglePlay();
      }
      if (change === 'foreground') {
        fakeDoc.hidden = false;
        html5Position.time = 80;
        emitVisibilityChange();
      }
      if (change === 'stale-owner') {
        html5Position.time = 10;
        await controller.playTrack(trackB, [trackA, trackB], 1);
      }
      if (change === 'middle-of-track') {
        html5Position.time = 80;
      }

      const indexBefore = controller.getSnapshot().currentIndex;
      workers[0].onmessage?.({ data: 'tick' } as MessageEvent);
      expect(controller.getSnapshot().currentIndex).toBe(indexBefore);
      cleanup();
    }
  );

  it('stops worker ticking when the tab becomes visible and terminates on cleanup', async () => {
    const {
      workers,
      cleanup,
      html5Position,
      fakeDoc,
      emitVisibilityChange,
    } = await playback();
    expect(workers).toHaveLength(1);
    expect(workers[0].postMessage).toHaveBeenCalledWith('start');
    html5Position.time = 80;
    fakeDoc.hidden = false;
    emitVisibilityChange();
    expect(workers[0].postMessage).toHaveBeenCalledWith('stop');
    cleanup();
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it.each(['missing', 'throws'] as const)(
    'retains timer recovery when worker support is %s',
    async (support) => {
      const { controller, cleanup, timerTick } = await playback(support);
      timerTick();
      expect(controller.getSnapshot().currentTrack?.id).toBe('B');
      cleanup();
    }
  );

  it('retains timer recovery after the worker fails to load', async () => {
    const { controller, workers, cleanup, timerTick } = await playback();
    workers[0].onerror?.({} as ErrorEvent);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    timerTick();
    expect(controller.getSnapshot().currentTrack?.id).toBe('B');
    cleanup();
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it('checks the new track after a late tick rather than completing the previous owner', async () => {
    const { controller, workers, cleanup, html5Position, trackA, trackB } =
      await playback();
    html5Position.time = 10;
    await controller.playTrack(trackB, [trackA, trackB], 1);
    workers[0].onmessage?.({ data: 'tick' } as MessageEvent);
    expect(controller.getSnapshot().currentTrack?.id).toBe('B');
    expect(controller.getSnapshot().currentIndex).toBe(1);
    cleanup();
  });

  it('does not let a stale YouTube iframe complete the active HTML5 track', async () => {
    const {
      controller,
      workers,
      cleanup,
      html5Position,
      youtubePosition,
    } = await playback('working', 'html5');
    html5Position.time = 10;
    youtubePosition.time = 179.4;
    youtubePosition.duration = 180;
    workers[0].onmessage?.({ data: 'tick' } as MessageEvent);
    expect(controller.getSnapshot().currentTrack?.id).toBe('A');
    cleanup();
  });

  it('advances the active YouTube iframe at EOF', async () => {
    const { controller, workers, cleanup, youtubePosition } = await playback(
      'working',
      'youtube'
    );
    youtubePosition.time = 179.4;
    youtubePosition.duration = 180;
    workers[0].onmessage?.({ data: 'tick' } as MessageEvent);
    expect(controller.getSnapshot().currentTrack?.id).toBe('B');
    cleanup();
  });

  it('repeats the current track once when duplicate EOF ticks arrive together', async () => {
    const { controller, workers, cleanup, getResumeCalls, getSeekTime } =
      await playback();
    // 'off' -> 'all' -> 'one'
    controller.toggleRepeat();
    controller.toggleRepeat();
    expect(controller.getSnapshot().repeatMode).toBe('one');

    workers[0].onmessage?.({ data: 'tick' } as MessageEvent);
    workers[0].onmessage?.({ data: 'tick' } as MessageEvent);
    await new Promise(setImmediate);

    expect(getResumeCalls()).toBe(1);
    expect(getSeekTime()).toBe(0);
    expect(controller.getSnapshot().currentTrack?.id).toBe('A');
    cleanup();
  });
});
