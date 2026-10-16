import { describe, expect, it, vi } from 'vitest';
import { bindBrowserLifecycle } from '../browserLifecycle';
import type { PlaybackController, PlaybackSnapshot } from '@/lib/playback/controllerTypes';

function createStubController(initial: Partial<PlaybackSnapshot> = {}) {
  let snapshot: PlaybackSnapshot = {
    currentTrack: null,
    isPlaying: false,
    isBuffering: false,
    volume: 0.8,
    isShuffle: false,
    repeatMode: 'off',
    autoPlayNext: true,
    playbackError: null,
    mvIntroOffset: 0,
    queue: [],
    currentIndex: -1,
    isQueueOpen: false,
    isNowPlayingOpen: false,
    ...initial,
  };
  const listeners = new Set<() => void>();

  const controller = {
    getSnapshot: () => snapshot,
    getProgress: () => ({ currentTime: 0, duration: 0 }),
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    subscribeProgress: () => () => {},
    handleVisibilityChange: vi.fn(),
    handlePageHide: vi.fn(),
    handleUserActivation: vi.fn(),
    checkBackgroundCompletion: vi.fn(),
    patch(partial: Partial<PlaybackSnapshot>) {
      snapshot = { ...snapshot, ...partial };
      for (const l of listeners) l();
    },
  } as unknown as PlaybackController & { patch(p: Partial<PlaybackSnapshot>): void };

  return controller;
}

describe('browserLifecycle', () => {
  it('registers and symmetrically cleans up all document, window, timer, and worker listeners', () => {
    const docListeners = new Map<string, EventListener>();
    const winListeners = new Map<string, EventListener>();
    const attrs = new Map<string, string>();

    const fakeDoc = {
      hidden: false,
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
      },
      addEventListener: vi.fn((name: string, cb: EventListener) => {
        docListeners.set(name, cb);
      }),
      removeEventListener: vi.fn((name: string, cb: EventListener) => {
        if (docListeners.get(name) === cb) docListeners.delete(name);
      }),
    } as unknown as Document;

    const fakeWin = {
      addEventListener: vi.fn((name: string, cb: EventListener) => {
        winListeners.set(name, cb);
      }),
      removeEventListener: vi.fn((name: string, cb: EventListener) => {
        if (winListeners.get(name) === cb) winListeners.delete(name);
      }),
    } as unknown as Window;

    const postMessage = vi.fn();
    const terminate = vi.fn();
    const fakeWorker = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      postMessage,
      terminate,
    } as unknown as Worker;

    const intervals = new Set<() => void>();
    const controller = createStubController();

    const dispose = bindBrowserLifecycle(controller, {
      clock: {
        now: () => 1000,
        after: () => () => {},
        every: (_ms, cb) => {
          intervals.add(cb);
          return () => intervals.delete(cb);
        },
      },
      doc: fakeDoc,
      win: fakeWin,
      createWorker: () => fakeWorker,
    });

    expect(docListeners.size).toBe(1);
    expect(winListeners.size).toBe(4);
    expect(postMessage).toHaveBeenCalledWith('stop');

    // Simulate visibility hidden
    (fakeDoc as unknown as { hidden: boolean }).hidden = true;
    docListeners.get('visibilitychange')!(new Event('visibilitychange'));
    expect(controller.handleVisibilityChange).toHaveBeenCalledWith(true);
    expect(attrs.get('data-tab-hidden')).toBe('true');
    expect(postMessage).toHaveBeenCalledWith('start');

    // Simulate worker tick
    fakeWorker.onmessage?.({ data: 'tick' } as MessageEvent);
    expect(controller.checkBackgroundCompletion).toHaveBeenCalledTimes(1);

    // Dispose and verify 100% cleanup symmetry
    dispose();
    expect(docListeners.size).toBe(0);
    expect(winListeners.size).toBe(0);
    expect(intervals.size).toBe(0);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(attrs.has('data-tab-hidden')).toBe(false);
  });

  it('invalidates a pending cold-start YouTube request when switching to an HTML5 track before iframe onReady (P1)', async () => {
    const { YouTubeIframeEngine } = await import('../../engines/YouTubeIframeEngine');
    const { Html5AudioEngine } = await import('../../engines/Html5AudioEngine');
    const { createBrowserTransport } = await import('../../adapters/browserTransport');
    const { bindYouTubeIframe } = await import('../youtubeBinding');

    const loads: string[] = [];
    let youtubePlaying = false;
    let html5Playing = false;
    let onReadyCallback: (() => void) | null = null;

    const fakeYtPlayer = {
      loadVideoById: vi.fn((arg: { videoId: string } | string) => {
        const videoId = typeof arg === 'string' ? arg : arg.videoId;
        loads.push(videoId);
        youtubePlaying = true;
      }),
      playVideo: vi.fn(() => {
        youtubePlaying = true;
      }),
      pauseVideo: vi.fn(() => {
        youtubePlaying = false;
      }),
      stopVideo: vi.fn(() => {
        youtubePlaying = false;
      }),
      mute: vi.fn(),
      unMute: vi.fn(),
      isMuted: vi.fn(() => false),
      setVolume: vi.fn(),
    };

    const fakeWin = {
      location: { origin: 'http://localhost' },
      YT: {
        Player: function (_id: string, opts: { events?: { onReady?: () => void } }) {
          onReadyCallback = opts.events?.onReady ?? null;
          return fakeYtPlayer;
        },
      },
    } as unknown as Window;

    const fakeDoc = {
      getElementById: vi.fn(() => ({})),
    } as unknown as Document;

    const fakeAudioState = {
      src: '',
      currentSrc: '',
      paused: true,
      ended: false,
      currentTime: 0,
      duration: 180,
      volume: 0.8,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      load: vi.fn(),
      play: vi.fn(async () => {
        html5Playing = true;
        fakeAudioState.paused = false;
      }),
      pause: vi.fn(() => {
        html5Playing = false;
        fakeAudioState.paused = true;
      }),
      removeAttribute: vi.fn(),
    };
    const fakeAudio = fakeAudioState as unknown as HTMLAudioElement;

    const html5 = new Html5AudioEngine(fakeAudio);
    const youtube = new YouTubeIframeEngine();
    const transport = createBrowserTransport({ audio: fakeAudio, html5, youtube });

    let activeOwner = { requestId: 1, generation: 1, trackId: 'yt-a' };
    const unbind = bindYouTubeIframe({
      clock: {
        now: () => 1000,
        after: () => () => {},
        every: () => () => {},
      },
      youtubeEngine: youtube,
      transport,
      getActiveOwner: () => activeOwner,
      getVolume: () => 0.8,
      isPlayingWanted: () => true,
      win: fakeWin,
      doc: fakeDoc,
    });

    // 1. Start YouTube A before iframe onReady fires
    const startA = transport.start(
      {
        track: {
          id: 'yt-a',
          user_id: 'u-1',
          title: 'YT A',
          artist: 'A',
          cover_url: null,
          duration: 120,
          file_path: '',
          created_at: '',
        },
        engine: 'youtube',
        target: 'videoA',
        initialTime: 0,
      },
      activeOwner,
      0.8,
      'play'
    );
    void startA.catch(() => {});

    // 2. Switch to HTML5 B before YT iframe onReady fires
    activeOwner = { requestId: 2, generation: 2, trackId: 'html5-b' };
    await transport.start(
      {
        track: {
          id: 'html5-b',
          user_id: 'u-1',
          title: 'HTML5 B',
          artist: 'B',
          cover_url: null,
          duration: 120,
          file_path: '',
          created_at: '',
        },
        engine: 'html5',
        target: 'https://cdn.example/b.mp3',
        initialTime: 0,
      },
      activeOwner,
      0.8,
      'play'
    );

    // 3. Now YT iframe becomes ready — stale videoA must NOT load or play
    expect(onReadyCallback).toBeTypeOf('function');
    onReadyCallback!();

    expect({ loads, html5Playing, youtubePlaying }).toEqual({
      loads: [],
      html5Playing: true,
      youtubePlaying: false,
    });

    unbind();
  });

  it('stops and removes listeners from the mounted audio element when detaching and disposing runtime (P2)', async () => {
    const { createPlayerRuntime } = await import('../createPlayerRuntime');

    const activeListeners = new Set<string>();
    const fakeAudioState = {
      src: '',
      currentSrc: '',
      paused: true,
      ended: false,
      currentTime: 0,
      duration: 180,
      volume: 0.8,
      muted: false,
      addEventListener: vi.fn((type: string, cb: EventListener) => {
        activeListeners.add(`${type}:${String(cb)}`);
      }),
      removeEventListener: vi.fn((type: string, cb: EventListener) => {
        activeListeners.delete(`${type}:${String(cb)}`);
      }),
      load: vi.fn(),
      play: vi.fn(async () => {
        fakeAudioState.paused = false;
      }),
      pause: vi.fn(() => {
        fakeAudioState.paused = true;
      }),
      removeAttribute: vi.fn(() => {
        fakeAudioState.src = '';
        fakeAudioState.currentSrc = '';
      }),
    };
    const fakeAudio = fakeAudioState as unknown as HTMLAudioElement;

    const runtime = createPlayerRuntime();
    const detach = runtime.attachAudioElement(fakeAudio);

    await runtime.controller.playTrack({
      id: 'local-1',
      user_id: 'u-1',
      title: 'Mounted Audio Track',
      artist: 'Tester',
      cover_url: null,
      duration: 180,
      source: 'local',
      drive_file_id: 'drv-1',
      file_path: '',
      created_at: '',
    });

    expect(fakeAudioState.paused).toBe(false);
    expect(activeListeners.size).toBeGreaterThan(0);

    // React unmount order: detachAudio() runs first, then runtime.dispose()
    detach();
    runtime.dispose();

    expect({ paused: fakeAudioState.paused, listeners: activeListeners.size }).toEqual({
      paused: true,
      listeners: 0,
    });
  });
});
