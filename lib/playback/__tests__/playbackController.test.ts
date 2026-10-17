import { describe, expect, it, vi } from 'vitest';
import { createPlaybackController } from '@/lib/playback/playbackController';
import type { PlaybackSourceService } from '@/lib/playback/playbackSourceService';
import type {
  PlaybackClock,
  PlaybackEvent,
  PlaybackOwner,
  PlaybackPersistencePort,
  PlaybackTransport,
  PlaybackUserEffects,
  PreparedPlayback,
} from '@/lib/playback/ports';
import { deferred, makeTrack } from './fixtures';

function createTestHarness() {
  let now = 10_000;
  const scheduled: Array<{ ms: number; cb: () => void; cancelled: boolean }> = [];
  const clock: PlaybackClock = {
    now: () => now,
    after: (ms, cb) => {
      const item = { ms, cb, cancelled: false };
      scheduled.push(item);
      return () => {
        item.cancelled = true;
      };
    },
    every: () => () => {},
  };

  const transportListeners = new Set<(event: PlaybackEvent) => void>();
  let transportState = { time: 0, duration: 180, playing: false };
  let lastStarted: {
    target: PreparedPlayback;
    owner: PlaybackOwner;
    volume: number;
    mode: 'play' | 'paused';
  } | null = null;

  const transport: PlaybackTransport & {
    emit(event: PlaybackEvent): void;
    getLastStarted(): typeof lastStarted;
    setReadState(patch: Partial<typeof transportState>): void;
  } = {
    start: vi.fn(async (target, owner, volume, mode) => {
      lastStarted = { target, owner, volume, mode };
      transportState.playing = mode === 'play';
    }),
    pause: vi.fn(() => {
      transportState.playing = false;
    }),
    resume: vi.fn(async () => {
      transportState.playing = true;
    }),
    stop: vi.fn(() => {
      transportState.playing = false;
    }),
    seek: vi.fn((time) => {
      transportState.time = time;
    }),
    setVolume: vi.fn(),
    read: () => ({ ...transportState }),
    subscribe: (listener) => {
      transportListeners.add(listener);
      return () => {
        transportListeners.delete(listener);
      };
    },
    dispose: vi.fn(),
    emit: (event) => {
      for (const l of transportListeners) l(event);
    },
    getLastStarted: () => lastStarted,
    setReadState: (patch) => {
      transportState = { ...transportState, ...patch };
    },
  };

  const sources: PlaybackSourceService = {
    resolveImmediate: vi.fn().mockReturnValue(null),
    resolvePlayable: vi.fn(async (req) => ({
      track: req.track,
      engine: 'html5' as const,
      target: `https://cdn.example/${req.track.id}.mp3`,
      initialTime: req.initialTime ?? 0,
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
    restore: vi.fn().mockReturnValue(null),
    save: vi.fn(),
    updateTime: vi.fn(),
    flush: vi.fn(),
    getRepeat: vi.fn().mockReturnValue('off'),
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

  return {
    controller,
    clock,
    advanceClock: (ms: number) => {
      now += ms;
    },
    runTimers: () => {
      for (const item of [...scheduled]) {
        if (!item.cancelled) {
          item.cancelled = true;
          item.cb();
        }
      }
    },
    transport,
    sources,
    persistence,
    userEffects,
  };
}

describe('playbackController', () => {
  it('ignores stale resolution when a newer track is selected before resolution completes', async () => {
    const { controller, sources, transport } = createTestHarness();
    const slowA = deferred<PreparedPlayback | null>();
    const fastB = deferred<PreparedPlayback | null>();

    vi.mocked(sources.resolvePlayable)
      .mockImplementationOnce(() => slowA.promise)
      .mockImplementationOnce(() => fastB.promise);

    const trackA = makeTrack('track-a');
    const trackB = makeTrack('track-b');

    const playA = controller.playTrack(trackA, [trackA, trackB], 0);
    const playB = controller.playTrack(trackB, [trackA, trackB], 1);

    fastB.resolve({
      track: trackB,
      engine: 'html5',
      target: 'https://cdn.example/track-b.mp3',
      initialTime: 0,
    });
    await playB;

    expect(controller.getSnapshot().currentTrack?.id).toBe('track-b');
    expect(controller.getSnapshot().isPlaying).toBe(true);

    // Now resolve stale track A — it must be ignored completely
    slowA.resolve({
      track: trackA,
      engine: 'html5',
      target: 'https://cdn.example/track-a.mp3',
      initialTime: 0,
    });
    await playA;

    expect(controller.getSnapshot().currentTrack?.id).toBe('track-b');
    expect(transport.start).toHaveBeenCalledTimes(1);
    expect(transport.getLastStarted()?.target.target).toBe(
      'https://cdn.example/track-b.mp3'
    );
  });

  it('drops transport events from a stale owner and only processes events for the current owner', async () => {
    const { controller, transport } = createTestHarness();
    const trackA = makeTrack('track-a');
    const trackB = makeTrack('track-b');

    await controller.playTrack(trackA, [trackA, trackB], 0);
    const ownerA = transport.getLastStarted()!.owner;

    await controller.playTrack(trackB, [trackA, trackB], 1);
    const ownerB = transport.getLastStarted()!.owner;

    // Emit ended with stale ownerA -> must not advance or change state
    transport.emit({ type: 'ended', owner: ownerA });
    expect(controller.getSnapshot().currentTrack?.id).toBe('track-b');

    // Emit time update with current ownerB -> updates progress
    transport.emit({ type: 'time', owner: ownerB, time: 42, duration: 200 });
    expect(controller.getProgress()).toEqual({ currentTime: 42, duration: 200 });
  });

  it('honors user pause that occurs while track resolution or transport start is in-flight', async () => {
    const { controller, sources, transport } = createTestHarness();
    const pendingPlayable = deferred<PreparedPlayback | null>();
    vi.mocked(sources.resolvePlayable).mockReturnValueOnce(
      pendingPlayable.promise
    );

    const track = makeTrack('track-pause-race');
    const playPromise = controller.playTrack(track, [track], 0);

    // User clicks pause while still resolving/buffering
    await controller.togglePlay();
    expect(controller.getSnapshot().isPlaying).toBe(false);
    expect(controller.getSnapshot().isBuffering).toBe(false);

    pendingPlayable.resolve({
      track,
      engine: 'html5',
      target: 'https://cdn.example/race.mp3',
      initialTime: 0,
    });
    await playPromise;

    expect(controller.getSnapshot().isPlaying).toBe(false);
    expect(transport.getLastStarted()?.mode).toBe('paused');
  });

  it('keeps state listeners idle during high-frequency progress updates and silent in hidden tabs', async () => {
    const { controller, transport } = createTestHarness();
    const track = makeTrack('track-progress');
    await controller.playTrack(track, [track], 0);
    const owner = transport.getLastStarted()!.owner;

    const stateListener = vi.fn();
    const progressListener = vi.fn();
    controller.subscribe(stateListener);
    controller.subscribeProgress(progressListener);

    transport.emit({ type: 'time', owner, time: 1, duration: 180 });
    transport.emit({ type: 'time', owner, time: 2, duration: 180 });

    expect(stateListener).not.toHaveBeenCalled();
    expect(progressListener).toHaveBeenCalledTimes(2);

    controller.handleVisibilityChange(true);
    progressListener.mockClear();
    transport.emit({ type: 'time', owner, time: 4, duration: 180 });
    expect(progressListener).not.toHaveBeenCalled();
    expect(controller.getProgress().currentTime).toBe(4);
  });

  it('stops previous HTML5 track before awaiting unresolved B and runs fallback when B resolves null (P1)', async () => {
    const { controller, sources, transport } = createTestHarness();
    const trackA = makeTrack('track-a', { title: 'Track A' });
    const trackB = makeTrack('track-b', { title: 'Track B' });

    // Start Track A playing on HTML5
    await controller.playTrack(trackA, [trackA, trackB], 0);
    expect(transport.read().playing).toBe(true);
    expect(controller.getSnapshot().isPlaying).toBe(true);
    vi.mocked(transport.stop).mockClear();

    // Select unresolved Track B whose primary resolution returns null
    const pendingB = deferred<PreparedPlayback | null>();
    vi.mocked(sources.resolvePlayable).mockReturnValueOnce(pendingB.promise);
    vi.mocked(sources.resolveFallback).mockResolvedValueOnce({
      track: { ...trackB, source: 'youtube', youtube_id: 'yt-b-fallback' },
      engine: 'youtube',
      target: 'yt-b-fallback',
      initialTime: 0,
    });

    const playBPromise = controller.playTrack(trackB, [trackA, trackB], 1);

    // Immediately after selecting unresolved B, A must no longer be playing on transport
    expect(controller.getSnapshot().currentTrack?.id).toBe('track-b');
    expect(transport.read().playing).toBe(false);
    expect(transport.stop).toHaveBeenCalledTimes(1);

    // Resolve B as null -> fallback must execute and start B on YouTube
    pendingB.resolve(null);
    await playBPromise;

    expect(sources.resolveFallback).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().isBuffering).toBe(false);
    expect(controller.getSnapshot().isPlaying).toBe(true);
    expect(controller.getSnapshot().playbackError).toBeNull();
    expect(transport.getLastStarted()?.target.target).toBe('yt-b-fallback');
  });

  it('continues from failed alternate NCT fallback candidate to YouTube fallback candidate (P2)', async () => {
    const { controller, sources, transport } = createTestHarness();
    const track = makeTrack('sp-track', {
      source: 'spotify',
      title: 'Fallback Song',
      artist: 'Fallback Artist',
      duration: 200,
    });

    // Primary resolution returns null
    vi.mocked(sources.resolvePlayable).mockResolvedValueOnce(null);

    // First resolveFallback returns alternate NCT stream; second returns YouTube candidate
    const nctPrepared: PreparedPlayback = {
      track: {
        ...track,
        source: 'nhaccuatui',
        nhaccuatui_id: 'nct-alt-1',
      },
      engine: 'html5',
      target: '/api/nhaccuatui/stream?id=nct-alt-1',
      initialTime: 0,
    };
    const ytPrepared: PreparedPlayback = {
      track: {
        ...track,
        source: 'youtube',
        youtube_id: 'yt-candidate-1',
      },
      engine: 'youtube',
      target: 'yt-candidate-1',
      initialTime: 0,
    };

    vi.mocked(sources.resolveFallback)
      .mockResolvedValueOnce(nctPrepared)
      .mockResolvedValueOnce(ytPrepared);

    // Transport rejects NCT stream, accepts YouTube candidate
    vi.mocked(transport.start)
      .mockRejectedValueOnce(new Error('NCT stream failed'))
      .mockImplementationOnce(async (target, owner, volume, mode) => {
        transport.setReadState({ playing: mode === 'play' });
      });

    await controller.playTrack(track, [track], 0);

    expect(sources.resolveFallback).toHaveBeenCalledTimes(2);
    expect(transport.start).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().isPlaying).toBe(true);
    expect(controller.getSnapshot().isBuffering).toBe(false);
    expect(controller.getSnapshot().playbackError).toBeNull();
    expect(controller.getSnapshot().currentTrack?.youtube_id).toBe('yt-candidate-1');
  });

  it('deduplicates recovery when HTML5 start() rejects and transport also emits an error event (race.har)', async () => {
    const { controller, sources, transport } = createTestHarness();
    const track = makeTrack('yt-ios-track', {
      source: 'youtube',
      youtube_id: 'osPq9Yb8xm8',
      title: 'nuts',
      artist: 'Lil Peep',
      duration: 85,
    });

    // Simulate iOS YouTube HTML5 proxy failing with 502:
    // Both transport.start() rejects AND <audio> emits { type: 'error' }
    vi.mocked(sources.resolveImmediate).mockReturnValueOnce({
      track,
      engine: 'html5',
      target: 'https://youtube-stream-cache.phongtct.workers.dev/api/yt-stream?id=osPq9Yb8xm8',
      initialTime: 0,
    });

    let capturedOwner: PlaybackOwner | null = null;
    vi.mocked(transport.start)
      .mockImplementationOnce(async (_target, owner) => {
        capturedOwner = owner;
        queueMicrotask(() => {
          transport.emit({
            type: 'error',
            owner,
            error: { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' },
          });
        });
        throw new Error('Failed to load because no supported source was found');
      })
      .mockImplementation(async (_target, _owner, _vol, mode) => {
        transport.setReadState({ playing: mode === 'play' });
      });

    await controller.playTrack(track, [track], 0);
    await Promise.resolve();
    await Promise.resolve();

    expect(capturedOwner).not.toBeNull();
    // Should start once on HTML5 (which fails) and once on YouTube IFrame — NOT twice on YouTube IFrame
    const youtubeStarts = vi
      .mocked(transport.start)
      .mock.calls.filter(([t]) => t.engine === 'youtube');
    expect(youtubeStarts).toHaveLength(1);
    expect(youtubeStarts[0][0].target).toBe('osPq9Yb8xm8');
  });

  it('does not overwrite known full track duration (>45s) with a 10s fMP4 fragment duration or prematurely end at 10s', async () => {
    const { controller, sources, transport } = createTestHarness();
    const trackA = makeTrack('sc-risk-it-all', {
      source: 'soundcloud',
      soundcloud_id: '2328016970',
      title: 'Risk It All',
      artist: 'Bruno Mars',
      duration: 204,
    });
    const trackB = makeTrack('next-track', {
      title: 'Next Track',
      duration: 180,
    });

    const scPrepared: PreparedPlayback = {
      track: trackA,
      engine: 'html5',
      target: 'https://soundcloud-stream-cache.phongtct.workers.dev/stream?id=2328016970',
      initialTime: 0,
    };
    vi.mocked(sources.resolveImmediate).mockReturnValueOnce(scPrepared);

    await controller.playTrack(trackA, [trackA, trackB], 0);
    const owner = transport.getLastStarted()!.owner;

    // Browser FFmpegDemuxer reports first fMP4 sidx subsegment duration (10.0078s)
    transport.setReadState({ time: 9.7, duration: 10.0078, playing: true });
    transport.emit({ type: 'time', owner, time: 9.7, duration: 10.0078 });

    // Must keep the known full track duration (204s) and NOT trigger completion at 9.7s
    expect(controller.getProgress().duration).toBe(204);
    expect(controller.getSnapshot().currentTrack?.id).toBe('sc-risk-it-all');
  });

  it('automatically resumes YouTube when browser/game occlusion emits paused while desiredState is playing, and switches to HTML5 stream if YouTube refuses to stay playing in background', async () => {
    const { controller, sources, transport } = createTestHarness();
    const ytTrack = makeTrack('yt-game-track', {
      source: 'youtube',
      youtube_id: 'gameVideo11',
      title: 'Gaming Song',
      artist: 'Gaming Artist',
      duration: 210,
    });

    vi.mocked(sources.resolvePlayable).mockResolvedValueOnce({
      track: ytTrack,
      engine: 'youtube',
      target: 'gameVideo11',
      initialTime: 0,
    });
    vi.mocked(sources.resolveFallback).mockResolvedValueOnce({
      track: { ...ytTrack, source: 'soundcloud', soundcloud_id: 'sc-game-11' },
      engine: 'html5',
      target: 'https://cdn.example/sc-game-11.mp3',
      initialTime: 45,
    });

    await controller.playTrack(ytTrack, [ytTrack], 0);
    const owner = transport.getLastStarted()!.owner;
    transport.setReadState({ time: 45, duration: 210, playing: true });

    // User switches to PC game -> tab becomes hidden
    controller.handleVisibilityChange(true);

    // 1st background auto-pause from YouTube IFrame -> must immediately call transport.resume()
    transport.setReadState({ playing: false });
    transport.emit({ type: 'paused', owner });
    expect(transport.resume).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().isPlaying).toBe(true);

    // 2nd background auto-pause -> retries transport.resume() a second time
    transport.setReadState({ playing: false });
    transport.emit({ type: 'paused', owner });
    expect(transport.resume).toHaveBeenCalledTimes(2);

    // 3rd background auto-pause -> switches to HTML5 stream at current time (45s)
    transport.setReadState({ playing: false });
    transport.emit({ type: 'paused', owner });
    await Promise.resolve();
    await Promise.resolve();

    expect(sources.resolveFallback).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'yt-game-track' }),
      45,
      undefined,
      { preferHtml5: true }
    );
    expect(transport.getLastStarted()?.target).toMatchObject({
      engine: 'html5',
      target: 'https://cdn.example/sc-game-11.mp3',
      initialTime: 45,
    });
  });

  it('resumes interrupted HTML5 playback when switching to a background tab/game or on background heartbeat while desiredState is playing', async () => {
    const { controller, transport } = createTestHarness();
    const track = makeTrack('html5-game-track', {
      title: 'Background HTML5',
      duration: 180,
    });

    await controller.playTrack(track, [track], 0);
    const owner = transport.getLastStarted()!.owner;

    // Simulate OS/window blur pausing audio right as user switches to a fullscreen game
    transport.setReadState({ time: 30, duration: 180, playing: false });
    transport.emit({ type: 'paused', owner });

    // Visibility changes to hidden when game takes fullscreen -> should immediately resume instead of waiting for tab return
    controller.handleVisibilityChange(true);
    await Promise.resolve();

    expect(transport.resume).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().isPlaying).toBe(true);
  });

  it('persists resolved track metadata after playTrack resolution, as well as volume and queue mutations', async () => {
    const { controller, sources, persistence } = createTestHarness();
    const rawCatalogTrack = makeTrack('sp-raw-1', {
      source: 'spotify',
      spotify_id: 'sp-raw-1',
      title: 'Catalog Song',
      artist: 'Catalog Artist',
      file_path: '',
    });
    const resolvedNctTrack = {
      ...rawCatalogTrack,
      source: 'nhaccuatui' as const,
      nhaccuatui_id: 'nct-resolved-1',
    };
    vi.mocked(sources.resolvePlayable).mockResolvedValueOnce({
      track: resolvedNctTrack,
      engine: 'html5',
      target: 'https://cdn.nct.vn/nct-resolved-1.mp3',
      initialTime: 0,
    });

    await controller.playTrack(rawCatalogTrack, [rawCatalogTrack], 0);

    // Must save the resolved NCT track so a page reload does not lose the resolved stream identity
    expect(persistence.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        track: expect.objectContaining({
          id: 'sp-raw-1',
          source: 'nhaccuatui',
          nhaccuatui_id: 'nct-resolved-1',
        }),
      }),
      true
    );

    vi.mocked(persistence.save).mockClear();
    controller.setVolume(0.35);
    expect(persistence.save).toHaveBeenCalledWith(
      expect.objectContaining({ volume: 0.35 }),
      false
    );

    vi.mocked(persistence.save).mockClear();
    const extraTrack = makeTrack('extra-2', { title: 'Extra Song' });
    controller.addToQueue(extraTrack);
    expect(persistence.save).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: expect.arrayContaining([
          expect.objectContaining({ id: 'sp-raw-1' }),
          expect.objectContaining({ id: 'extra-2' }),
        ]),
      }),
      false
    );
  });
});

