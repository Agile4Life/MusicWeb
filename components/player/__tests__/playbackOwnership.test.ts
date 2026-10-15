import { describe, expect, it, vi } from 'vitest';
import { createBrowserTransport } from '@/components/player/adapters/browserTransport';
import { Html5AudioEngine, YouTubeIframeEngine } from '@/components/player/engines';
import { createWebAudioGainManager } from '@/components/player/runtime/createPlayerRuntime';
import { bindYouTubeIframe } from '@/components/player/runtime/youtubeBinding';
import { createPlaybackController } from '@/lib/playback/playbackController';
import {
  createPlaybackSourceService,
  type PlaybackSourceService,
} from '@/lib/playback/playbackSourceService';
import type {
  PlaybackClock,
  PlaybackOwner,
  PlaybackPersistencePort,
  PlaybackUserEffects,
  PreparedPlayback,
} from '@/lib/playback/ports';
import type { PlaybackSourceDeps } from '@/lib/playback/sourcePorts';
import { makeTrack } from '@/lib/playback/__tests__/fixtures';
import type { Track } from '@/types';

function deferred<T = void>() {
  let resolve!: (val: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function emptySearchResponse(youtube: Track[] = []) {
  return {
    nhaccuatui: [],
    local: [],
    youtube,
    audius: [],
    itunes: [],
    spotify: [],
    deezer: [],
    soundcloud: [],
  };
}

function createFakeAudio() {
  const handlers = new Map<string, Set<(event: Event) => void>>();
  let srcVal = '';
  const audio = {
    paused: true,
    ended: false,
    currentTime: 0,
    duration: 180,
    volume: 1,
    muted: false,
    error: null as { code?: number; message?: string } | null,
    playCalls: 0,
    pauseCalls: 0,
    get src() {
      return srcVal;
    },
    set src(v: string) {
      srcVal = v;
    },
    load: vi.fn(),
    play: vi.fn(() => {
      audio.playCalls += 1;
      audio.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      audio.pauseCalls += 1;
      audio.paused = true;
    }),
    removeAttribute: vi.fn((attr: string) => {
      if (attr === 'src') srcVal = '';
    }),
    addEventListener: vi.fn((type: string, fn: (event: Event) => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: (event: Event) => void) => {
      handlers.get(type)?.delete(fn);
    }),
    emit(type: string) {
      if (type === 'ended') {
        audio.ended = true;
      } else if (type === 'pause') {
        audio.paused = true;
      } else if (type === 'playing' || type === 'play') {
        audio.paused = false;
        audio.ended = false;
      } else if (type === 'error') {
        audio.paused = true;
        if (!audio.error) {
          audio.error = { code: 4, message: 'Media error' };
        }
      }
      const ev = { type, timeStamp: performance.now() } as unknown as Event;
      handlers.get(type)?.forEach((fn) => fn(ev));
    },
  };
  return audio;
}

function createControllerHarness(overrides?: {
  isIOS?: () => boolean;
  isFastConnection?: () => boolean;
  customSources?: Partial<PlaybackSourceService>;
  sourceDeps?: Partial<PlaybackSourceDeps>;
}) {
  const scheduledTimers: Array<{ ms: number; fn: () => void; active: boolean }> =
    [];
  const clock: PlaybackClock = {
    now: () => 10_000,
    after: (ms, fn) => {
      const entry = { ms, fn, active: true };
      scheduledTimers.push(entry);
      return () => {
        entry.active = false;
      };
    },
    every: () => () => {},
  };

  const audio = createFakeAudio();
  const html5Engine = new Html5AudioEngine();
  html5Engine.setAudioElement(audio as unknown as HTMLAudioElement);
  const youtubeEngine = new YouTubeIframeEngine();

  let loadedYtArgs: unknown = null;
  let ytPlays = 0;
  const ytPlayer = {
    loadVideoById: vi.fn((arg: unknown) => {
      loadedYtArgs = arg;
    }),
    cueVideoById: vi.fn(),
    playVideo: vi.fn(() => {
      ytPlays += 1;
    }),
    pauseVideo: vi.fn(),
    stopVideo: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: vi.fn(() => 0),
    getDuration: vi.fn(() => 180),
    getPlayerState: vi.fn(() => 1),
    setVolume: vi.fn(),
    unMute: vi.fn(),
    isMuted: vi.fn(() => false),
  };
  youtubeEngine.setPlayerInstance(ytPlayer);

  let activeOwner: PlaybackOwner | null = null;
  const baseTransport = createBrowserTransport({
    audio: audio as unknown as HTMLAudioElement,
    html5: html5Engine,
    youtube: youtubeEngine,
  });

  const transport: typeof baseTransport = {
    ...baseTransport,
    start(target, owner, volume, mode) {
      activeOwner = { ...owner };
      return baseTransport.start(target, owner, volume, mode);
    },
  };

  const defaultSourceDeps: PlaybackSourceDeps = {
    clock,
    isIOS: overrides?.isIOS ?? (() => false),
    isFastConnection: overrides?.isFastConnection ?? (() => true),
    resolution: {
      resolve: vi.fn().mockResolvedValue(null),
      invalidate: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    },
    search: vi.fn().mockResolvedValue(emptySearchResponse()),
    resolveSoundCloudUrl: vi.fn(
      async (target) => `/api/soundcloud/stream?id=${target}`
    ),
    getDeterministicSoundCloudUrl: (id) => `/api/soundcloud/stream?id=${id}`,
    signStoragePath: vi.fn(async (p) => `https://audio.test/${p}`),
    loadPersistedUrl: vi.fn(() => null),
    savePersistedUrl: vi.fn(),
    getCachedYouTubeId: vi.fn(() => null),
    saveCachedYouTubeId: vi.fn(),
    getNctStreamUrl: vi.fn((track) =>
      track.nhaccuatui_id
        ? `/api/nhaccuatui/stream?id=${track.nhaccuatui_id}`
        : null
    ),
    getCachedNctUrl: vi.fn(() => null),
    prewarmNctUrl: vi.fn(async (id) => `/api/nhaccuatui/stream?id=${id}`),
    clearCachedNctUrl: vi.fn(),
    resolveNctSong: vi.fn().mockResolvedValue(null),
    triggerDrivePrewarm: vi.fn(),
    prewarmTrackBatch: vi.fn().mockResolvedValue(undefined),
    buildDriveStreamUrl: (fileId) => `/api/drive-stream?id=${fileId}`,
    buildYouTubeStreamUrl: (videoId) => `/api/youtube/stream?id=${videoId}`,
    ...overrides?.sourceDeps,
  };

  const realSources = createPlaybackSourceService(defaultSourceDeps);
  const sources: PlaybackSourceService = {
    ...realSources,
    ...overrides?.customSources,
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

  return {
    controller,
    audio,
    html5Engine,
    youtubeEngine,
    ytPlayer,
    transport,
    sources,
    defaultSourceDeps,
    clock,
    scheduledTimers,
    flushTimers: () => {
      for (const t of [...scheduledTimers]) {
        if (t.active) {
          t.active = false;
          t.fn();
        }
      }
    },
    getActiveOwner: () => activeOwner,
    getLoadedYtArgs: () => loadedYtArgs,
    getYtPlays: () => ytPlays,
  };
}

describe('production playback ownership', () => {
  it('keeps paused state and source if the pending play rejects', async () => {
    for (const name of ['NotAllowedError', 'NetworkError']) {
      const h = createControllerHarness();
      let rejectPlay!: (err: Error) => void;
      h.audio.play = vi.fn(
        () =>
          new Promise<void>((_res, rej) => {
            rejectPlay = rej;
          })
      );

      const pending = h.controller.playTrack(
        makeTrack('A', { file_path: 'https://audio.test/A' })
      );
      await h.controller.togglePlay();

      const error = new Error(name);
      error.name = name;
      rejectPlay(error);
      await pending;

      expect(h.controller.getSnapshot().isBuffering).toBe(false);
      expect(h.controller.getSnapshot().isPlaying).toBe(false);
      expect(h.audio.src).toBe('https://audio.test/A');
    }
  });

  it('does not restart a paused iframe on a late buffering event', () => {
    const h = createControllerHarness();
    let stateChangeHandler!: (e: { data: number }) => void;

    const fakeWin = {
      location: { origin: 'http://localhost' },
      YT: {
        Player: function (
          _id: string,
          cfg: { events: { onStateChange: (e: { data: number }) => void } }
        ) {
          stateChangeHandler = cfg.events.onStateChange;
          return h.ytPlayer;
        },
      },
    } as unknown as Window;
    const fakeDoc = {
      getElementById: () => ({}),
    } as unknown as Document;

    const unbind = bindYouTubeIframe({
      clock: h.clock,
      youtubeEngine: h.youtubeEngine,
      transport: h.transport,
      getActiveOwner: () => ({ generation: 0, requestId: 1, trackId: 'A' }),
      getVolume: () => 0.8,
      isPlayingWanted: () => false,
      win: fakeWin,
      doc: fakeDoc,
    });

    stateChangeHandler({ data: 3 });
    h.flushTimers();

    expect(h.getYtPlays()).toBe(0);
    expect(h.controller.getSnapshot().isBuffering).toBe(false);
    unbind();
  });

  it('does not reload an iframe after Pause during error invalidation', async () => {
    const invalid = deferred();
    const h = createControllerHarness({
      sourceDeps: {
        resolution: {
          resolve: vi.fn().mockResolvedValue(null),
          invalidate: () => invalid.promise,
          dispose: vi.fn(),
        },
        search: async () =>
          emptySearchResponse([
            makeTrack('A', { source: 'youtube', youtube_id: 'newvideo123' }),
          ]),
      },
    });

    const ytTrack = makeTrack('A', {
      source: 'youtube',
      youtube_id: 'abcdefghijk',
      file_path: '',
    });
    await h.controller.playTrack(ytTrack, [ytTrack], 0);
    vi.mocked(h.ytPlayer.loadVideoById).mockClear();

    const owner = h.getActiveOwner()!;
    h.transport.handleYouTubeEvent({ type: 'error', owner, error: 150 });
    await h.controller.togglePlay();
    invalid.resolve();
    await new Promise(setImmediate);

    expect(h.ytPlayer.loadVideoById).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().isPlaying).toBe(false);
  });

  it('can complete another repeat loop after pausing an in-flight replay', async () => {
    const replay = deferred();
    const h = createControllerHarness();
    let playCallCount = 0;
    h.audio.play = vi.fn(() => {
      playCallCount += 1;
      h.audio.paused = false;
      return playCallCount === 2 ? replay.promise : Promise.resolve();
    });

    const t = makeTrack('repeat', {
      file_path: 'https://audio.test/repeat',
      duration: 180,
    });
    await h.controller.playTrack(t, [t], 0);
    // off -> all -> one
    h.controller.toggleRepeat();
    h.controller.toggleRepeat();

    h.audio.emit('ended');
    await h.controller.togglePlay();
    replay.resolve();
    await new Promise(setImmediate);

    await h.controller.togglePlay();
    h.audio.currentTime = 180;
    h.audio.emit('ended');
    await new Promise(setImmediate);

    expect(playCallCount).toBe(4);
  });

  it('keeps OS pause when a previous OS play promise finishes', async () => {
    const h = createControllerHarness();
    const t = makeTrack('A', { file_path: 'https://audio.test/A' });
    await h.controller.playTrack(t, [t], 0);

    await h.controller.togglePlay();
    expect(h.controller.getSnapshot().isPlaying).toBe(false);

    h.audio.emit('playing');
    expect(h.controller.getSnapshot().isPlaying).toBe(false);
    expect(h.audio.pause).toHaveBeenCalled();
  });

  it('keeps a recovered stream paused if Pause arrives during fallback', async () => {
    const fallbackDeferred = deferred<PreparedPlayback | null>();
    const h = createControllerHarness({
      customSources: {
        resolveImmediate: () => null,
        resolvePlayable: async () => null,
        resolveFallback: () => fallbackDeferred.promise,
      },
    });

    const t = makeTrack('A');
    const pending = h.controller.playTrack(t, [t], 0);
    await new Promise(setImmediate);

    await h.controller.togglePlay();

    fallbackDeferred.resolve({
      track: makeTrack('A', { source: 'youtube', youtube_id: 'oldVideoId1' }),
      engine: 'html5',
      target: '/api/youtube/stream?id=oldVideoId1',
      initialTime: 0,
    });
    await pending;

    expect(h.audio.playCalls).toBe(0);
    expect(h.audio.paused).toBe(true);
    expect(h.controller.getSnapshot().isBuffering).toBe(false);
    expect(h.controller.getSnapshot().isPlaying).toBe(false);
  });

  it('never pauses a new owner when quick-play finishes late', async () => {
    const a = deferred();
    const b = deferred();
    const h = createControllerHarness();
    let n = 0;
    h.audio.play = vi.fn(() => {
      h.audio.paused = false;
      return n++ === 0 ? a.promise : b.promise;
    });

    const trackA = makeTrack('A', { file_path: 'https://audio.test/A' });
    const trackB = makeTrack('B', { file_path: 'https://audio.test/B' });
    void h.controller.playTrack(trackA, [trackA, trackB], 0);
    h.controller.nextTrack();

    b.resolve();
    await new Promise(setImmediate);
    a.resolve();
    await new Promise(setImmediate);

    expect(h.audio.paused).toBe(false);
    expect(h.controller.getSnapshot().currentTrack?.id).toBe('B');
  });

  it('never pauses B when A play resolves after B', async () => {
    const a = deferred();
    const b = deferred();
    const h = createControllerHarness();
    let n = 0;
    h.audio.play = vi.fn(() => {
      h.audio.paused = false;
      return n++ === 0 ? a.promise : b.promise;
    });

    const pa = h.controller.playTrack(
      makeTrack('A', { file_path: 'https://audio.test/A' })
    );
    const pb = h.controller.playTrack(
      makeTrack('B', { file_path: 'https://audio.test/B' })
    );

    b.resolve();
    await pb;
    a.resolve();
    await pa;

    expect(h.audio.paused).toBe(false);
    expect(h.audio.src).toBe('https://audio.test/B');
  });

  it('drops fallback after invalidation yields ownership to B', async () => {
    const fallbackA = deferred<PreparedPlayback | null>();
    const h = createControllerHarness({
      customSources: {
        resolveImmediate: (req) =>
          req.track.id === 'B'
            ? {
                track: req.track,
                engine: 'html5',
                target: 'https://audio.test/B',
                initialTime: 0,
              }
            : null,
        resolvePlayable: async () => null,
        resolveFallback: () => fallbackA.promise,
      },
    });

    const pa = h.controller.playTrack(makeTrack('A'));
    await new Promise(setImmediate);

    await h.controller.playTrack(
      makeTrack('B', { file_path: 'https://audio.test/B' })
    );

    fallbackA.resolve({
      track: makeTrack('A', { source: 'youtube', youtube_id: 'oldVideoId1' }),
      engine: 'html5',
      target: '/api/youtube/stream?id=oldVideoId1',
      initialTime: 0,
    });
    await pa;

    expect(h.controller.getSnapshot().currentTrack?.id).toBe('B');
    expect(h.audio.src).toBe('https://audio.test/B');
  });

  it('does not carry a resolving A seek into B', async () => {
    const a = deferred<PreparedPlayback | null>();
    const b = deferred<PreparedPlayback | null>();
    const h = createControllerHarness({
      customSources: {
        resolveImmediate: () => null,
        resolvePlayable: (req) =>
          req.track.id === 'A' ? a.promise : b.promise,
      },
    });

    const pa = h.controller.playTrack(makeTrack('A'));
    h.controller.seek(90);

    const pb = h.controller.playTrack(makeTrack('B'));
    b.resolve({
      track: makeTrack('B'),
      engine: 'html5',
      target: 'https://audio.test/B',
      initialTime: 0,
    });
    await pb;

    a.resolve(null);
    await pa;

    expect(h.audio.currentTime).toBe(0);
  });

  it('honors pause while resolving the main stream', async () => {
    const url = deferred<PreparedPlayback | null>();
    const h = createControllerHarness({
      customSources: {
        resolveImmediate: () => null,
        resolvePlayable: () => url.promise,
      },
    });

    const pending = h.controller.playTrack(makeTrack('A'));
    await h.controller.togglePlay();

    url.resolve({
      track: makeTrack('A'),
      engine: 'html5',
      target: 'https://audio.test/A',
      initialTime: 0,
    });
    await pending;

    expect(h.audio.paused).toBe(true);
    expect(h.controller.getSnapshot().isPlaying).toBe(false);
  });

  it('replays repeat-one for successive actual endings', async () => {
    const h = createControllerHarness();
    const t = makeTrack('repeat', {
      file_path: 'https://audio.test/repeat',
      duration: 180,
    });
    await h.controller.playTrack(t, [t], 0);
    // off -> all -> one
    h.controller.toggleRepeat();
    h.controller.toggleRepeat();
    h.audio.playCalls = 0;

    h.audio.emit('ended');
    await new Promise(setImmediate);

    h.audio.currentTime = 180;
    h.audio.ended = true;
    h.audio.emit('ended');
    await new Promise(setImmediate);

    expect(h.audio.playCalls).toBe(2);
  });

  it('does not advance intentionally paused audio near EOF on foreground', async () => {
    const h = createControllerHarness();
    const t1 = makeTrack('paused', {
      file_path: 'https://audio.test/A',
      duration: 180,
    });
    const t2 = makeTrack('next', {
      file_path: 'https://audio.test/B',
      duration: 180,
    });
    await h.controller.playTrack(t1, [t1, t2], 0);
    h.audio.currentTime = 179.5;
    h.audio.duration = 180;

    await h.controller.togglePlay();
    h.controller.handleVisibilityChange(false);

    expect(h.controller.getSnapshot().currentTrack?.id).toBe('paused');
    expect(h.controller.getSnapshot().isPlaying).toBe(false);
  });

  it('does not resume pending audio after pause on foreground/canplay/activation', async () => {
    const h = createControllerHarness();
    let firstAttempt = true;
    h.audio.play = vi.fn(() => {
      if (firstAttempt) {
        firstAttempt = false;
        const err = new Error('NotAllowedError');
        err.name = 'NotAllowedError';
        return Promise.reject(err);
      }
      h.audio.playCalls += 1;
      return Promise.resolve();
    });

    const t = makeTrack('A', { file_path: 'https://audio.test/A' });
    await h.controller.playTrack(t, [t], 0);
    await h.controller.togglePlay();
    h.audio.playCalls = 0;

    h.controller.handleVisibilityChange(false);
    h.audio.emit('canplay');
    h.controller.handleUserActivation();
    await Promise.resolve();

    expect(h.audio.playCalls).toBe(0);
  });

  it('applies volume once after connecting Web Audio', () => {
    const gain = { gain: { value: 1 }, connect: vi.fn() };
    const fakeAudio = { volume: 0.5, muted: false } as unknown as HTMLAudioElement;
    const manager = createWebAudioGainManager({
      getAudioElement: () => fakeAudio,
      isPlaying: () => true,
      getAudioContextClass: () =>
        function () {
          return {
            state: 'running',
            createGain: () => gain,
            createMediaElementSource: () => ({ connect: vi.fn() }),
            destination: {},
          };
        } as unknown as new () => AudioContext,
    });

    manager.ensureGain(0.5);
    expect(fakeAudio.volume * gain.gain.value).toBe(0.5);
  });

  it('preserves playback position on fallback only when candidate duration matches within 8s', async () => {
    const h = createControllerHarness();
    const track = makeTrack('A', { duration: 200 });

    const first = await h.sources.resolveFallback(
      track,
      72,
      makeTrack('yt-1', {
        source: 'youtube',
        youtube_id: 'matchDur123',
        duration: 203,
      })
    );
    expect(first?.target).toBe('matchDur123');
    expect(first?.initialTime).toBe(72);

    const second = await h.sources.resolveFallback(
      track,
      72,
      makeTrack('yt-2', {
        source: 'youtube',
        youtube_id: 'longMvId123',
        duration: 260,
      })
    );
    expect(second?.target).toBe('longMvId123');
    expect(second?.initialTime).toBe(0);
  });

  it('skips redundant 4s NCT local-proxy retry when audio.src is already on local proxy', async () => {
    const h = createControllerHarness({
      sourceDeps: {
        getNctStreamUrl: () =>
          'https://app.test/api/nhaccuatui/stream?id=nct123',
      },
    });
    const fallbackSpy = vi
      .spyOn(h.sources, 'resolveFallback')
      .mockResolvedValue({
        track: makeTrack('nct1', { source: 'youtube', youtube_id: 'yt123456789' }),
        engine: 'youtube',
        target: 'yt123456789',
        initialTime: 0,
      });

    const t = makeTrack('nct1', {
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct123',
      file_path: '',
    });
    await h.controller.playTrack(t, [t], 0);

    h.audio.emit('error');
    await new Promise(setImmediate);

    expect(fallbackSpy).toHaveBeenCalledTimes(1);
    expect(
      h.scheduledTimers.filter((timer) => timer.ms === 4000)
    ).toHaveLength(0);
  });

  it('preserves consecutiveSkipRef across error auto-skip while resetting on manual navigation', async () => {
    const h = createControllerHarness({
      customSources: {
        resolveImmediate: () => null,
        resolvePlayable: async () => null,
        resolveFallback: async () => null,
      },
    });

    const tracks = [
      makeTrack('1'),
      makeTrack('2'),
      makeTrack('3'),
      makeTrack('4'),
      makeTrack('5'),
    ];

    await h.controller.playTrack(tracks[0], tracks, 0);
    for (let i = 0; i < 3; i++) {
      h.flushTimers();
      await new Promise(setImmediate);
    }

    expect(h.controller.getSnapshot().playbackError).toContain('Đã dừng tự động');

    h.controller.nextTrack();
    await new Promise(setImmediate);
    expect(h.controller.getSnapshot().currentIndex).toBe(4);
  });

  it('caches SoundCloud catalog resolution and warms audioUrlCacheRef in triggerAdaptivePrewarm', async () => {
    let scRequestedId: string | number | null = null;
    const h = createControllerHarness({
      sourceDeps: {
        resolution: {
          resolve: vi.fn().mockResolvedValue({
            source: 'soundcloud',
            id: 'sc-998877',
            title: 'Midnight City',
            artist: 'M83',
            duration: 243,
          }),
          invalidate: vi.fn().mockResolvedValue(undefined),
          dispose: vi.fn(),
        },
        resolveSoundCloudUrl: async (target) => {
          scRequestedId = target;
          return `/api/soundcloud/stream?id=${target}`;
        },
      },
    });

    const catalogNext = makeTrack('spotify-track-2', {
      title: 'Midnight City',
      artist: 'M83',
      duration: 243,
      source: 'spotify',
      file_path: '',
    });

    h.sources.prewarmNextAdaptive([makeTrack('A'), catalogNext], 0, 'off');
    await new Promise(setImmediate);

    expect(scRequestedId).toBe('sc-998877');

    const immediate = h.sources.resolveImmediate({
      track: catalogNext,
      initialTime: 0,
      preserveGesture: true,
      tabHidden: false,
    });
    expect(immediate?.track).toMatchObject({
      id: 'spotify-track-2',
      source: 'soundcloud',
      soundcloud_id: 'sc-998877',
    });
    expect(immediate?.target).toBe('/api/soundcloud/stream?id=sc-998877');
  });

  it('pre-resolves iTunes 30s preview tracks in triggerAdaptivePrewarm instead of treating apple.com preview URL as direct playable', async () => {
    let resolveCalled = 0;
    const h = createControllerHarness({
      sourceDeps: {
        resolution: {
          resolve: vi.fn(async () => {
            resolveCalled += 1;
            return {
              source: 'nhaccuatui' as const,
              id: 'nct-love-story',
              title: 'Love Story',
              artist: 'Taylor Swift',
              duration: 235,
            };
          }),
          invalidate: vi.fn().mockResolvedValue(undefined),
          dispose: vi.fn(),
        },
      },
    });

    const itunesPreviewNext = makeTrack('itunes-track-2', {
      title: 'Love Story',
      artist: 'Taylor Swift',
      duration: 235,
      source: 'itunes',
      itunes_id: 'it-111',
      file_path:
        'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/mzaf_123.plus.aac.p.m4a',
    });

    h.sources.prewarmNextAdaptive([makeTrack('A'), itunesPreviewNext], 0, 'off');
    await new Promise(setImmediate);

    expect(resolveCalled).toBe(1);
    const immediate = h.sources.resolveImmediate({
      track: itunesPreviewNext,
      initialTime: 0,
      preserveGesture: true,
      tabHidden: false,
    });
    expect(immediate?.track).toMatchObject({
      id: 'itunes-track-2',
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-love-story',
      file_path: '',
    });
    expect(immediate?.target).toBe('/api/nhaccuatui/stream?id=nct-love-story');
  });

  it('synchronously quick-plays pre-resolved tracks in background/iOS when audioUrlCacheRef misses, resets nextTrackEndPrewarmedRef, and chains triggerAdaptivePrewarm', async () => {
    const h = createControllerHarness({
      isIOS: () => true,
      sourceDeps: {
        resolution: {
          resolve: vi.fn().mockResolvedValue({
            source: 'nhaccuatui',
            id: 'nct-song-2',
            title: 'Song 2',
            artist: 'Artist 2',
            duration: 200,
          }),
          invalidate: vi.fn().mockResolvedValue(undefined),
          dispose: vi.fn(),
        },
        // Simulate cold audioUrlCache on prewarm
        prewarmNctUrl: vi.fn().mockResolvedValue(null),
      },
    });

    const t1 = makeTrack('song-1', { file_path: 'https://audio.test/1' });
    const t2 = makeTrack('song-2', {
      title: 'Song 2',
      artist: 'Artist 2',
      duration: 200,
      source: 'itunes',
      itunes_id: 'it-2',
      file_path: 'https://audio-ssl.itunes.apple.com/preview.m4a',
    });
    const t3 = makeTrack('song-3', { file_path: 'https://audio.test/3' });

    await h.controller.playTrack(t1, [t1, t2, t3], 0);
    h.sources.prewarmNextAdaptive([t1, t2, t3], 0, 'off');
    await new Promise(setImmediate);

    const prewarmUpcomingSpy = vi.spyOn(h.sources, 'prewarmUpcoming');
    h.controller.handleVisibilityChange(true);
    h.audio.playCalls = 0;

    h.controller.nextTrack();
    expect(h.audio.src).toBe('/api/nhaccuatui/stream?id=nct-song-2');
    expect(h.audio.playCalls).toBe(1);

    await new Promise(setImmediate);
    expect(prewarmUpcomingSpy).toHaveBeenCalledWith(
      expect.any(Array),
      1,
      'off',
      { tabHidden: true }
    );
  });

  it('resumes WebKit interrupted AudioContext state in ensureWebAudioGain', () => {
    let resumeCalls = 0;
    const gain = { gain: { value: 0.8 }, connect: vi.fn() };
    const fakeAudio = { volume: 0.8, muted: false } as unknown as HTMLAudioElement;

    const manager = createWebAudioGainManager({
      getAudioElement: () => fakeAudio,
      isPlaying: () => true,
      getAudioContextClass: () =>
        function () {
          return {
            state: 'interrupted',
            resume() {
              resumeCalls += 1;
              this.state = 'running';
              return Promise.resolve();
            },
            createGain: () => gain,
            createMediaElementSource: () => ({ connect: vi.fn() }),
            destination: {},
          };
        } as unknown as new () => AudioContext,
    });

    manager.ensureGain(0.8);
    expect(resumeCalls).toBe(1);
  });

  it('advances track when Safari fires pause at EOF before or instead of ended in background', async () => {
    const h = createControllerHarness();
    const t1 = makeTrack('safari-eof', {
      file_path: 'https://app.test/song.mp3',
      duration: 200,
    });
    const t2 = makeTrack('next-track', {
      file_path: 'https://app.test/next.mp3',
      duration: 200,
    });

    await h.controller.playTrack(t1, [t1, t2], 0);
    h.audio.duration = 200;
    h.audio.currentTime = 199.8;
    h.audio.paused = true;

    h.audio.emit('pause');
    expect(h.controller.getSnapshot().currentTrack?.id).toBe('next-track');
  });

  it('does not trigger a premature 1200ms auto-skip in handleError when playTrack catch has already started fallbackToYouTube', async () => {
    const invalid = deferred();
    const search = deferred<ReturnType<typeof emptySearchResponse>>();
    const h = createControllerHarness({
      sourceDeps: {
        resolution: {
          resolve: vi.fn().mockResolvedValue(null),
          invalidate: () => invalid.promise,
          dispose: vi.fn(),
        },
        search: () => search.promise,
        getCachedNctUrl: () =>
          'https://nct-stream-cache.test/stream?id=nct-ditto',
      },
      customSources: {
        resolveImmediate: () => null,
      },
    });

    const t1 = makeTrack('ditto', {
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-ditto',
      file_path: '',
    });
    const t2 = makeTrack('next-song');

    h.audio.play = vi.fn(() => Promise.reject(new Error('502 Bad Gateway')));

    const playPromise = h.controller.playTrack(t1, [t1, t2], 0);
    await new Promise(setImmediate);

    h.audio.emit('error');
    invalid.resolve();
    await new Promise(setImmediate);

    h.flushTimers();
    expect(h.controller.getSnapshot().currentTrack?.id).toBe('ditto');

    search.resolve(
      emptySearchResponse([
        makeTrack('ditto', {
          source: 'youtube',
          youtube_id: 'pSUydWEqKwE',
          duration: 185,
        }),
      ])
    );
    await playPromise;
    await new Promise(setImmediate);

    expect(h.getLoadedYtArgs()).toEqual({
      videoId: 'pSUydWEqKwE',
      startSeconds: 0,
    });
    expect(h.controller.getSnapshot().isPlaying).toBe(true);
    expect(h.controller.getSnapshot().currentTrack?.id).toBe('ditto');
  });

  it('falls through to YouTube IFrame Player on iOS when /api/yt-stream fails in fallbackToYouTube and clears stale provider IDs', async () => {
    const h = createControllerHarness({
      isIOS: () => true,
      sourceDeps: {
        getCachedYouTubeId: () => 'V9PVRfjEBTI',
      },
      customSources: {
        resolveImmediate: () => null,
        resolvePlayable: async () => null,
      },
    });

    h.audio.play = vi.fn(() =>
      Promise.reject(new Error('502 Bad Gateway from /api/yt-stream'))
    );

    const t = makeTrack('birds', {
      source: 'soundcloud',
      soundcloud_id: '1822834458',
      nhaccuatui_id: 'stale-nct',
      file_path: '',
    });

    await h.controller.playTrack(t, [t], 0);

    expect(h.getLoadedYtArgs()).toEqual({
      videoId: 'V9PVRfjEBTI',
      startSeconds: 0,
    });
    expect(h.controller.getSnapshot().isPlaying).toBe(true);
    expect(h.controller.getSnapshot().isBuffering).toBe(false);
    expect(h.controller.getSnapshot().currentTrack?.source).toBe('youtube');
    expect(h.controller.getSnapshot().currentTrack?.youtube_id).toBe(
      'V9PVRfjEBTI'
    );
    expect(
      h.controller.getSnapshot().currentTrack?.soundcloud_id
    ).toBeUndefined();
    expect(
      h.controller.getSnapshot().currentTrack?.nhaccuatui_id
    ).toBeUndefined();
  });

  it('falls through to YouTube IFrame Player in playTrack on iOS when direct YouTube HTML5 stream proxy fails', async () => {
    const h = createControllerHarness({
      isIOS: () => true,
    });

    h.audio.play = vi.fn(() => Promise.reject(new Error('502 Bad Gateway')));

    const ytTrack = makeTrack('yt-direct', {
      source: 'youtube',
      youtube_id: 'dQw4w9WgXcQ',
      file_path: '',
    });

    await h.controller.playTrack(ytTrack, [ytTrack], 0);

    expect(h.getLoadedYtArgs()).toEqual({
      videoId: 'dQw4w9WgXcQ',
      startSeconds: 0,
    });
    expect(h.controller.getSnapshot().isPlaying).toBe(true);
    expect(h.controller.getSnapshot().isBuffering).toBe(false);
  });
});
