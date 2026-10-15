import { describe, expect, it, vi } from 'vitest';
import { createPlaybackController } from '@/lib/playback/playbackController';
import type { PlaybackSourceService } from '@/lib/playback/playbackSourceService';
import type {
  PlaybackEvent,
  PlaybackOwner,
  PlaybackPersistencePort,
  PlaybackTransport,
  PlaybackUserEffects,
  PreparedPlayback,
} from '@/lib/playback/ports';
import { makeTrack } from '@/lib/playback/__tests__/fixtures';

function createNctRaceHarness() {
  const scheduledTimers: Array<{ ms: number; fn: () => void; active: boolean }> =
    [];
  const clock = {
    now: () => 10_000,
    after: (ms: number, fn: () => void) => {
      const entry = { ms, fn, active: true };
      scheduledTimers.push(entry);
      return () => {
        entry.active = false;
      };
    },
    every: () => () => {},
  };

  let activeOwner: PlaybackOwner | null = null;
  let playing = false;
  let shouldRejectProxyStart = false;
  const listeners = new Set<(event: PlaybackEvent) => void>();

  const transport: PlaybackTransport & {
    emit(e: PlaybackEvent): void;
    setPlaying(v: boolean): void;
    setRejectProxyStart(v: boolean): void;
    getActiveOwner(): PlaybackOwner | null;
  } = {
    start: vi.fn(async (target: PreparedPlayback, owner: PlaybackOwner) => {
      activeOwner = { ...owner };
      if (
        shouldRejectProxyStart &&
        target.target.includes('/api/nhaccuatui/stream')
      ) {
        playing = false;
        throw new Error('NCT proxy failed immediately');
      }
      playing = true;
    }),
    pause: vi.fn(() => {
      playing = false;
    }),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    read: () => ({ time: 0, duration: 180, playing }),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    dispose: vi.fn(),
    emit: (e) => {
      for (const l of listeners) l(e);
    },
    setPlaying: (v) => {
      playing = v;
    },
    setRejectProxyStart: (v) => {
      shouldRejectProxyStart = v;
    },
    getActiveOwner: () => activeOwner,
  };

  const sources: PlaybackSourceService = {
    resolveImmediate: vi.fn(() => null),
    resolvePlayable: vi.fn(async (req) => ({
      track: req.track,
      engine: 'html5' as const,
      target: 'https://cdn.nct.vn/direct-stream.mp3',
      initialTime: 0,
    })),
    resolveFallback: vi.fn(async (track) => ({
      track: { ...track, source: 'youtube', youtube_id: 'yt-fallback-1' },
      engine: 'youtube' as const,
      target: 'yt-fallback-1',
      initialTime: 0,
    })),
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

  return { controller, transport, sources, scheduledTimers };
}

describe('NCT Playback Race Guards & Concurrency Isolation', () => {
  it('prevents duplicate concurrent fallbackToYouTube calls for the exact same requestId (Mutex Guard)', async () => {
    const { controller, transport, sources } = createNctRaceHarness();
    let resolveFallbackPromise!: (val: PreparedPlayback | null) => void;
    vi.mocked(sources.resolveFallback).mockImplementation(
      () =>
        new Promise((res) => {
          resolveFallbackPromise = res;
        })
    );

    const track = makeTrack('local-1', { source: 'local' });
    await controller.playTrack(track, [track], 0);
    const owner = transport.getActiveOwner()!;
    transport.setPlaying(false);

    // Emit two concurrent error events for the same requestId
    transport.emit({ type: 'error', owner, error: { code: 4 } });
    transport.emit({ type: 'error', owner, error: { code: 4 } });
    await new Promise(setImmediate);

    expect(sources.resolveFallback).toHaveBeenCalledTimes(1);

    resolveFallbackPromise({
      track: makeTrack('local-1', { source: 'youtube', youtube_id: 'yt-1' }),
      engine: 'youtube',
      target: 'yt-1',
      initialTime: 0,
    });
    await new Promise(setImmediate);
  });

  it('aborts the 4000ms NCT retry waiting period early (<100ms) when the retry stream fails immediately', async () => {
    const { controller, transport, sources, scheduledTimers } =
      createNctRaceHarness();
    transport.setRejectProxyStart(true);

    const nctTrack = makeTrack('nct-1', {
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-id-1',
    });
    await controller.playTrack(nctTrack, [nctTrack], 0);

    const owner = transport.getActiveOwner()!;
    transport.setPlaying(false);

    const startTime = Date.now();
    transport.emit({ type: 'error', owner, error: { code: 4 } });
    await new Promise(setImmediate);
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeLessThan(100);
    expect(sources.resolveFallback).toHaveBeenCalledTimes(1);
    const retryTimers = scheduledTimers.filter((t) => t.ms === 4000);
    expect(retryTimers.every((t) => !t.active)).toBe(true);
  });

  it('cancels the pending audioStallWatchdog timer immediately on stream error', async () => {
    const { controller, transport, scheduledTimers } = createNctRaceHarness();
    const track = makeTrack('local-1', { source: 'local' });
    await controller.playTrack(track, [track], 0);
    const owner = transport.getActiveOwner()!;

    // Buffering event arms the 12s stall watchdog timer
    transport.emit({ type: 'buffering', owner, value: true });
    const watchdogTimers = scheduledTimers.filter((t) => t.ms === 12000);
    expect(watchdogTimers).toHaveLength(1);
    expect(watchdogTimers[0].active).toBe(true);

    // Stream error cancels the pending stall watchdog immediately
    transport.setPlaying(false);
    transport.emit({ type: 'error', owner, error: { code: 4 } });
    expect(watchdogTimers[0].active).toBe(false);
  });

  it('prevents an in-flight prewarm promise from re-populating the cache after clearCachedNctStreamUrl', async () => {
    const {
      prewarmNctStreamUrl,
      getCachedNctStreamUrl,
      clearCachedNctStreamUrl,
    } = await import('@/lib/nhaccuatuiClient');
    const songId = 'race-guard-test-song';

    let resolveFetch: (res: Response) => void = () => {};
    const slowFetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(() => slowFetchPromise);

    const prewarmTask = prewarmNctStreamUrl(songId);
    clearCachedNctStreamUrl(songId);

    resolveFetch(
      new Response(
        JSON.stringify({ url: 'https://cdn.example.com/stale-stream.mp3' }),
        { status: 200 }
      )
    );
    await prewarmTask;

    expect(getCachedNctStreamUrl(songId)).toBeNull();
  });
});
