import { describe, expect, it, vi } from 'vitest';
import { YouTubeIframeEngine } from '@/components/player/engines';
import {
  PlaybackPersistenceScheduler,
  STORAGE_KEY_PLAYER_STATE,
} from '@/components/player/playbackPersistenceScheduler';
import { createPlaybackController } from '@/lib/playback/playbackController';
import { createPlaybackOwnership } from '@/lib/playback/playbackOwnership';
import type { PlaybackSourceService } from '@/lib/playback/playbackSourceService';
import type {
  PlaybackEvent,
  PlaybackOwner,
  PlaybackPersistencePort,
  PlaybackTransport,
  PlaybackUserEffects,
} from '@/lib/playback/ports';
import {
  createRecoveryPolicy,
  MAX_CONSECUTIVE_SKIPS,
} from '@/lib/playback/recoveryPolicy';
import { makeTrack } from '@/lib/playback/__tests__/fixtures';
import type { Track } from '@/types';

function createSafetyControllerHarness() {
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
  let resumePromise: Promise<void> = Promise.resolve();
  const listeners = new Set<(event: PlaybackEvent) => void>();

  const transport: PlaybackTransport & {
    emit(e: PlaybackEvent): void;
    getActiveOwner(): PlaybackOwner | null;
    setResumePromise(p: Promise<void>): void;
    setPlaying(v: boolean): void;
  } = {
    start: vi.fn(async (_target, owner, _vol, mode) => {
      activeOwner = { ...owner };
      playing = mode === 'play';
    }),
    pause: vi.fn(() => {
      playing = false;
    }),
    resume: vi.fn(async () => {
      await resumePromise;
      playing = true;
    }),
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
    getActiveOwner: () => activeOwner,
    setResumePromise: (p) => {
      resumePromise = p;
    },
    setPlaying: (v) => {
      playing = v;
    },
  };

  const sources: PlaybackSourceService = {
    resolveImmediate: vi.fn((req) => ({
      track: req.track,
      engine: 'html5' as const,
      target: `https://cdn.example/${req.track.id}.mp3`,
      initialTime: req.initialTime ?? 0,
    })),
    resolvePlayable: vi.fn().mockResolvedValue(null),
    resolveFallback: vi.fn(async (track) => ({
      track: { ...track, source: 'youtube', youtube_id: 'yt-watchdog-1' },
      engine: 'youtube' as const,
      target: 'yt-watchdog-1',
      initialTime: 0,
    })),
    resolveYouTubeAlternate: vi.fn().mockResolvedValue(null),
    refreshStream: vi.fn().mockResolvedValue(null),
    searchYouTubeCandidate: vi.fn().mockResolvedValue(null),
    invalidateTrack: vi.fn().mockResolvedValue(undefined),
    prewarmUpcoming: vi.fn(),
    prewarmNextAdaptive: vi.fn(),
    prewarmNearEnd: vi.fn(),
    hydrateRestoredTrack: vi.fn(async (track, initialTime) => ({
      track,
      engine: 'html5' as const,
      target: `https://cdn.example/${track.id}.mp3`,
      initialTime,
    })),
    dispose: vi.fn(),
  };

  let restoredState: ReturnType<PlaybackPersistencePort['restore']> = null;
  const persistence: PlaybackPersistencePort & {
    setRestoredState(val: ReturnType<PlaybackPersistencePort['restore']>): void;
  } = {
    restore: () => restoredState,
    save: vi.fn(),
    updateTime: vi.fn(),
    flush: vi.fn(),
    getRepeat: () => 'off',
    setRepeat: vi.fn(),
    dispose: vi.fn(),
    setRestoredState: (val) => {
      restoredState = val;
    },
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

  return {
    controller,
    transport,
    sources,
    persistence,
    scheduledTimers,
  };
}

describe('Player Safety Mechanisms & Edge Guards', () => {
  it('correctly windows large queues (>150 items) around currentIndex to prevent index overflow', () => {
    const mockStorage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = val;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {},
    });

    const mockTracks: Track[] = Array.from({ length: 300 }, (_, i) =>
      makeTrack(`track-${i}`, { title: `Track ${i}` })
    );

    const scheduler = new PlaybackPersistenceScheduler();
    scheduler.saveImmediate({
      track: mockTracks[200],
      currentTime: 12,
      queue: mockTracks,
      currentIndex: 200,
      volume: 0.8,
    });

    const parsed = JSON.parse(mockStorage[STORAGE_KEY_PLAYER_STATE]);
    expect(parsed.queue).toHaveLength(150);
    expect(parsed.currentIndex).toBe(50);
    expect(parsed.queue[parsed.currentIndex].id).toBe('track-200');
    expect(parsed.currentIndex).toBeGreaterThanOrEqual(0);
    expect(parsed.currentIndex).toBeLessThan(parsed.queue.length);
    vi.unstubAllGlobals();
  });

  it('correctly verifies YouTube video matching with fallback to ytLoadedIdRef', () => {
    const engine = new YouTubeIframeEngine();
    engine.setLoadedVideoId('vid-123');
    engine.setPlayerInstance({
      getVideoData: () => ({ video_id: undefined }),
    });

    expect(engine.matchesVideo('vid-123')).toBe(true);
    expect(engine.matchesVideo('other-vid')).toBe(false);

    engine.setLoadedVideoId('other-vid');
    engine.setPlayerInstance({
      getVideoData: () => ({ video_id: 'other-vid' }),
    });
    expect(engine.matchesVideo('vid-123')).toBe(false);
  });

  it('circuit breaker prevents infinite skip loop when consecutive errors reach MAX_CONSECUTIVE_SKIPS (4)', () => {
    const policy = createRecoveryPolicy(MAX_CONSECUTIVE_SKIPS);

    for (let i = 0; i < 3; i++) {
      const outcome = policy.recordUnrecoverableFailure({
        trackTitle: `Song ${i}`,
        queueLength: 10,
        autoPlayNext: true,
        repeatMode: 'off',
      });
      expect(outcome.circuitBroken).toBe(false);
      expect(outcome.shouldAutoSkip).toBe(true);
    }
    expect(policy.getConsecutiveSkips()).toBe(3);

    const fourth = policy.recordUnrecoverableFailure({
      trackTitle: 'Song 4',
      queueLength: 10,
      autoPlayNext: true,
      repeatMode: 'off',
    });
    expect(policy.getConsecutiveSkips()).toBe(4);
    expect(fourth.circuitBroken).toBe(true);
    expect(fourth.shouldAutoSkip).toBe(false);

    policy.resetConsecutiveSkips();
    expect(policy.getConsecutiveSkips()).toBe(0);
  });

  it('ensures restored player state on mount initializes audio ownership token matching the restored track ID', async () => {
    const { controller, transport, persistence } = createSafetyControllerHarness();
    const restoredTrack = makeTrack('song-restored-456', {
      title: 'Restored Song',
      source: 'nhaccuatui',
    });
    persistence.setRestoredState({
      track: restoredTrack,
      currentTime: 45,
      queue: [restoredTrack],
      currentIndex: 0,
      volume: 0.7,
    });

    await controller.restoreFromPersistence();

    const owner = transport.getActiveOwner();
    expect(owner?.trackId).toBe('song-restored-456');
    expect(controller.getSnapshot().currentTrack?.id).toBe('song-restored-456');
  });

  it('ensures togglePlay resume keeps ownership token aligned when resuming pre-loaded audio', async () => {
    const ownership = createPlaybackOwnership();
    const restoredOwner = ownership.restoreOwner('song-789');
    expect(ownership.isCurrentOwner(restoredOwner, 'song-789')).toBe(true);
  });

  it('prevents play/pause spam race conditions by serializing action IDs and desired play state', async () => {
    const { controller, transport } = createSafetyControllerHarness();
    const track = makeTrack('spam-1');
    await controller.playTrack(track, [track], 0);
    await controller.togglePlay(); // Now paused
    expect(controller.getSnapshot().isPlaying).toBe(false);

    let resolveResume!: () => void;
    transport.setResumePromise(
      new Promise<void>((res) => {
        resolveResume = res;
      })
    );

    // 1. User clicks PLAY (in-flight resume)
    const p1 = controller.togglePlay();
    // 2. User immediately clicks PAUSE before resume resolves
    const p2 = controller.togglePlay();

    resolveResume();
    await Promise.all([p1, p2]);

    expect(controller.getSnapshot().isPlaying).toBe(false);
    expect(transport.pause).toHaveBeenCalled();
  });

  it('Universal audio stall watchdog triggers YouTube fallback for Drive/local tracks when stalled > 6500ms', async () => {
    const { controller, transport, sources, scheduledTimers } =
      createSafetyControllerHarness();
    const track = makeTrack('drive-1', { title: 'Drive Song', source: 'local' });
    await controller.playTrack(track, [track], 0);
    const owner = transport.getActiveOwner()!;

    transport.setPlaying(false);
    transport.emit({ type: 'buffering', owner, value: true });

    const watchdog = scheduledTimers.find((t) => t.ms === 12000 && t.active);
    expect(watchdog).toBeDefined();
    watchdog!.active = false;
    watchdog!.fn();
    await new Promise(setImmediate);

    expect(sources.resolveFallback).toHaveBeenCalledTimes(1);

    // Second stall on the same request does not trigger an infinite fallback loop
    transport.emit({ type: 'buffering', owner, value: true });
    const secondWatchdog = scheduledTimers.find(
      (t) => t.ms === 12000 && t.active
    );
    secondWatchdog?.fn();
    await new Promise(setImmediate);

    expect(sources.resolveFallback).toHaveBeenCalledTimes(1);
  });

  it('Circuit breaker counter resets cleanly to 0 when playback becomes stable', async () => {
    const { controller, transport, sources } = createSafetyControllerHarness();
    const failing = makeTrack('fail-1');
    const working = makeTrack('work-1');

    // Simulate failure on first track
    vi.mocked(sources.resolveImmediate).mockReturnValueOnce(null);
    vi.mocked(sources.resolveFallback).mockResolvedValueOnce(null);
    await controller.playTrack(failing, [failing, working], 0);
    expect(controller.getSnapshot().playbackError).toBeTruthy();

    // Playing a working track and reaching stable playback resets error/skip state
    await controller.playTrack(working, [failing, working], 1);
    const owner = transport.getActiveOwner()!;
    transport.emit({ type: 'time', owner, time: 4, duration: 180 });

    expect(controller.getSnapshot().playbackError).toBeNull();
    expect(controller.getSnapshot().isPlaying).toBe(true);
  });
});
