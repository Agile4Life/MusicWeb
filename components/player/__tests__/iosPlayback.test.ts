import { describe, expect, it, vi } from 'vitest';
import { createPlaybackController } from '@/lib/playback/playbackController';
import { createPlaybackSourceService } from '@/lib/playback/playbackSourceService';
import type { PlaybackSourceDeps } from '@/lib/playback/sourcePorts';
import type { PlaybackClock } from '@/lib/playback/ports';
import type { ResolvedStreamResult } from '@/lib/stream-resolution/client/contracts';
import { deferred, makeTrack } from '@/lib/playback/__tests__/fixtures';
import { createBrowserTransport } from '../adapters/browserTransport';
import { Html5AudioEngine } from '../engines/Html5AudioEngine';
import { YouTubeIframeEngine } from '../engines/YouTubeIframeEngine';
import { bindMediaSession } from '../runtime/mediaSessionBinding';

// Network, native media permissions and the iframe SDK are external boundaries.
// Source selection, ownership, transport and MediaSession commands stay real.
class NativeAudio extends EventTarget {
  src = ''; currentSrc = ''; currentTime = 0; duration = 180;
  volume = 0.8; muted = false; paused = true; ended = false;
  readyState = 4; error: MediaError | null = null;
  requiresGesture = false; inGesture = false;
  play = vi.fn(async () => {
    if (this.requiresGesture && !this.inGesture) {
      throw new DOMException('User gesture is required', 'NotAllowedError');
    }
    this.paused = false;
  });
  pause = vi.fn(() => { this.paused = true; });
  load = vi.fn();
  removeAttribute(name: string) { if (name === 'src') this.src = ''; }
}

function createHarness(overrides: Partial<PlaybackSourceDeps> = {}, allowIframe = false) {
  const clock: PlaybackClock = {
    now: () => 1_000,
    after: () => () => {},
    every: () => () => {},
  };
  const sourceDeps: PlaybackSourceDeps = {
    clock, isIOS: () => true, isFastConnection: () => true,
    resolution: {
      resolve: vi.fn().mockResolvedValue(null),
      invalidate: vi.fn().mockResolvedValue(undefined), dispose: vi.fn(),
    },
    search: vi.fn().mockResolvedValue({ nhaccuatui: [], local: [], youtube: [], spotify: [], deezer: [], soundcloud: [] }),
    resolveSoundCloudUrl: vi.fn().mockResolvedValue(null),
    signStoragePath: vi.fn().mockResolvedValue(null),
    loadPersistedUrl: () => null, savePersistedUrl: vi.fn(),
    getCachedYouTubeId: () => null, saveCachedYouTubeId: vi.fn(),
    getNctStreamUrl: track => track.nhaccuatui_id ? `/api/nhaccuatui/stream?id=${track.nhaccuatui_id}` : null,
    getCachedNctUrl: () => null, prewarmNctUrl: vi.fn().mockResolvedValue(null),
    clearCachedNctUrl: vi.fn(), resolveNctSong: vi.fn().mockResolvedValue(null),
    triggerDrivePrewarm: vi.fn(), prewarmTrackBatch: vi.fn().mockResolvedValue(undefined),
    buildDriveStreamUrl: id => `/api/drive-stream?id=${id}`,
    buildYouTubeStreamUrl: id => `/api/youtube/stream?id=${id}`,
    ...overrides,
  };
  const sources = createPlaybackSourceService(sourceDeps);
  const audio = new NativeAudio();
  const iframe = {
    loadVideoById: vi.fn(), cueVideoById: vi.fn(), playVideo: vi.fn(),
    pauseVideo: vi.fn(), stopVideo: vi.fn(), mute: vi.fn(), unMute: vi.fn(),
    setVolume: vi.fn(), seekTo: vi.fn(), getCurrentTime: () => 0,
    getDuration: () => 180, getPlayerState: () => 2,
    getVideoData: () => ({ video_id: 'dQw4w9WgXcQ' }),
  };
  const html5 = new Html5AudioEngine(audio as unknown as HTMLAudioElement);
  const youtube = new YouTubeIframeEngine(iframe);
  const transport = createBrowserTransport({ audio: audio as unknown as HTMLAudioElement, html5, youtube });
  const controller = createPlaybackController({
    clock, transport, sources, canUseYouTubeIframe: () => allowIframe,
    persistence: {
      restore: () => null, save: vi.fn(), updateTime: vi.fn(), flush: vi.fn(),
      getRepeat: () => 'off', setRepeat: vi.fn(), dispose: vi.fn(),
    },
    userEffects: {
      recordHistory: vi.fn(), recordListen: vi.fn(), setFavorite: vi.fn().mockResolvedValue(undefined),
      recommend: vi.fn().mockResolvedValue([]), dispose: vi.fn(),
    },
  });
  const handlers = new Map<string, (() => void) | null>();
  const unbind = bindMediaSession(controller, {
    clock, origin: 'https://music.test', createMetadata: init => init,
    mediaSession: { metadata: null, playbackState: 'none', setActionHandler: (name, handler) => { handlers.set(name, handler); } },
  });
  return { controller, sources, sourceDeps, audio, iframe, handlers, cleanup() { unbind(); controller.dispose(); } };
}

const youtubeTrack = () => makeTrack('yt-ios', {
  source: 'youtube', youtube_id: 'dQw4w9WgXcQ', title: 'Test Song', artist: 'Test Artist',
});
const nativeTrack = () => makeTrack('nct-ios', {
  source: 'nhaccuatui', nhaccuatui_id: 'native-song', file_path: '',
});
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

describe('iOS native playback recovery', () => {
  it('starts cold search playback in the selecting gesture while catalog resolution is pending', async () => {
    const lookup = deferred<null>();
    const h = createHarness({
      resolution: { resolve: () => lookup.promise, invalidate: async () => {}, dispose: () => {} },
    });
    h.audio.requiresGesture = true;
    h.audio.inGesture = true;
    const pending = h.controller.playSearchTrack(youtubeTrack());
    try {
      expect(h.audio.play).toHaveBeenCalledTimes(1);
      expect(h.audio.src).toBe('/api/youtube/stream?id=dQw4w9WgXcQ');
      h.audio.inGesture = false;
      lookup.resolve(null);
      await pending;
      expect(h.controller.getSnapshot().isPlaying).toBe(true);
    } finally {
      lookup.resolve(null);
      await pending;
      h.cleanup();
    }
  });

  it('retries a blocked start on the first lock-screen Play without pausing', async () => {
    const h = createHarness();
    try {
      h.audio.play.mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'));
      await h.controller.playTrack(nativeTrack());
      expect(h.controller.getSnapshot().isPlaying).toBe(false);
      h.handlers.get('play')?.();
      await flush();
      expect(h.controller.getSnapshot().isPlaying).toBe(true);
      expect(h.audio.play).toHaveBeenCalledTimes(2);
      expect(h.audio.pause).not.toHaveBeenCalled();
    } finally { h.cleanup(); }
  });

  it('honors lock-screen Pause after a blocked start and prevents later activation recovery', async () => {
    const h = createHarness();
    try {
      h.audio.play.mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'));
      await h.controller.playTrack(nativeTrack());
      h.handlers.get('pause')?.();
      h.controller.handleUserActivation();
      await flush();
      expect(h.controller.getSnapshot().isPlaying).toBe(false);
      expect(h.audio.play).toHaveBeenCalledTimes(1);
    } finally { h.cleanup(); }
  });

  it('lets the UI Play toggle retry a blocked start', async () => {
    const h = createHarness();
    try {
      h.audio.play.mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'));
      await h.controller.playTrack(nativeTrack());
      await h.controller.togglePlay();
      expect(h.controller.getSnapshot().isPlaying).toBe(true);
      expect(h.audio.play).toHaveBeenCalledTimes(2);
    } finally { h.cleanup(); }
  });

  it('keeps OS Play and Pause idempotent when they are repeated', async () => {
    const h = createHarness();
    try {
      await h.controller.playTrack(nativeTrack());
      h.handlers.get('play')?.();
      h.handlers.get('play')?.();
      await flush();
      expect(h.audio.play).toHaveBeenCalledTimes(1);
      expect(h.controller.getSnapshot().isPlaying).toBe(true);
      h.handlers.get('pause')?.();
      h.handlers.get('pause')?.();
      h.controller.checkBackgroundCompletion();
      await flush();
      expect(h.controller.getSnapshot().isPlaying).toBe(false);
      expect(h.audio.paused).toBe(true);
      expect(h.audio.play).toHaveBeenCalledTimes(1);
    } finally { h.cleanup(); }
  });

  it('keeps playback paused when a native start completes after OS Pause', async () => {
    const start = deferred<void>();
    const h = createHarness();
    h.audio.play.mockImplementationOnce(() => start.promise);
    const pending = h.controller.playTrack(nativeTrack());
    try {
      h.handlers.get('pause')?.();
      start.resolve();
      await pending;
      expect(h.controller.getSnapshot()).toMatchObject({ isPlaying: false, isBuffering: false });
      expect(h.audio.paused).toBe(true);
    } finally { start.resolve(); await pending; h.cleanup(); }
  });

  it('does not restore playing UI when activation recovery completes after OS Pause', async () => {
    const h = createHarness();
    const resumed = deferred<void>();
    try {
      h.audio.play.mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'));
      await h.controller.playTrack(nativeTrack());
      h.audio.play.mockImplementationOnce(() => resumed.promise);
      h.controller.handleUserActivation();
      h.handlers.get('pause')?.();
      resumed.resolve();
      await flush();
      expect(h.controller.getSnapshot()).toMatchObject({ isPlaying: false, isBuffering: false });
    } finally { resumed.resolve(); h.cleanup(); }
  });

  it.each(['foreground', 'heartbeat', 'native-pause'] as const)(
    'honors OS Pause while %s recovery is pending', async trigger => {
      const h = createHarness();
      const resumed = deferred<void>();
      try {
        await h.controller.playTrack(nativeTrack());
        h.controller.handleVisibilityChange(true);
        h.audio.paused = true;
        h.audio.play.mockImplementationOnce(() => resumed.promise);
        if (trigger === 'foreground') h.controller.handleVisibilityChange(false);
        else if (trigger === 'heartbeat') h.controller.checkBackgroundCompletion();
        else h.audio.dispatchEvent(new Event('pause'));
        expect(h.audio.play).toHaveBeenCalledTimes(2);
        h.handlers.get('pause')?.();
        resumed.resolve();
        await flush();
        expect(h.controller.getSnapshot()).toMatchObject({ isPlaying: false, isBuffering: false });
      } finally { resumed.resolve(); h.cleanup(); }
    }
  );

  it.each([false, true])('never replaces native audio with an iframe after proxy failure (hidden=%s)', async hidden => {
    const h = createHarness();
    try {
      h.controller.handleVisibilityChange(hidden);
      h.audio.play.mockRejectedValueOnce(new Error('proxy 502'));
      await h.controller.playTrack(youtubeTrack());
      expect(h.iframe.loadVideoById).not.toHaveBeenCalled();
      expect(h.controller.getSnapshot()).toMatchObject({ isPlaying: false, isBuffering: false });
      expect(h.controller.getSnapshot().playbackError).toBeTruthy();
      expect(h.audio.src).toBe('/api/youtube/stream?id=dQw4w9WgXcQ');
    } finally { h.cleanup(); }
  });

  it('keeps error-event recovery on native audio when a locked-screen stream fails', async () => {
    const h = createHarness();
    try {
      await h.controller.playTrack(youtubeTrack());
      h.controller.handleVisibilityChange(true);
      h.audio.paused = true;
      h.audio.error = { code: 4 } as MediaError;
      h.audio.dispatchEvent(new Event('error'));
      await flush();
      expect(h.iframe.loadVideoById).not.toHaveBeenCalled();
      expect(h.controller.getSnapshot().isPlaying).toBe(false);
      expect(h.controller.getSnapshot().playbackError).toBeTruthy();
    } finally { h.cleanup(); }
  });

  it.each(['NotAllowedError', 'AbortError'])(
    'keeps an HTML5 alternative resumable after %s without treating it as a broken stream', async errorName => {
      const h = createHarness({
        resolution: {
          resolve: async () => ({ source: 'nhaccuatui', id: 'alternate-native' }),
          invalidate: async () => {}, dispose: () => {},
        },
      });
      try {
        h.audio.play
          .mockRejectedValueOnce(new Error('proxy 502'))
          .mockRejectedValueOnce(new DOMException('Playback interrupted or blocked', errorName));
        await h.controller.playTrack(youtubeTrack());
        expect(h.audio.src).toBe('/api/nhaccuatui/stream?id=alternate-native');
        expect(h.controller.getSnapshot()).toMatchObject({ isPlaying: false, isBuffering: false, playbackError: null });
        h.handlers.get('play')?.();
        await flush();
        expect(h.controller.getSnapshot().isPlaying).toBe(true);
        expect(h.audio.play).toHaveBeenCalledTimes(3);
      } finally { h.cleanup(); }
    }
  );

  it('ends buffering after the recovery deadline when a catalog lookup never settles', async () => {
    vi.useFakeTimers();
    const h = createHarness({
      clock: {
        now: () => Date.now(),
        after: (ms, cb) => { const timer = setTimeout(cb, ms); return () => clearTimeout(timer); },
        every: () => () => {},
      },
      resolution: { resolve: () => new Promise(() => {}), invalidate: async () => {}, dispose: () => {} },
    });
    try {
      h.audio.play.mockRejectedValueOnce(new Error('proxy 502'));
      void h.controller.playTrack(youtubeTrack());
      await vi.advanceTimersByTimeAsync(1800);
      expect(h.controller.getSnapshot()).toMatchObject({ isPlaying: false, isBuffering: false });
      expect(h.controller.getSnapshot().playbackError).toBeTruthy();
      expect(h.iframe.loadVideoById).not.toHaveBeenCalled();
    } finally { h.cleanup(); vi.useRealTimers(); }
  });

  it.each(['ready', 'pending'] as const)(
    'retains a %s catalog alternative when the original native YouTube proxy emits an error', async preparation => {
      const lookup = deferred<ResolvedStreamResult | null>();
      let lookups = 0;
      const h = createHarness({
        resolution: {
          resolve: () => ++lookups === 1 ? lookup.promise : Promise.resolve(null),
          invalidate: async () => {}, dispose: () => {},
        },
      });
      const alternative: ResolvedStreamResult = { source: 'nhaccuatui', id: 'prepared-native' };
      try {
        await h.controller.playTrack(youtubeTrack());
        if (preparation === 'ready') { lookup.resolve(alternative); await flush(); }
        h.audio.paused = true;
        h.audio.error = { code: 4 } as MediaError;
        h.audio.dispatchEvent(new Event('error'));
        await flush();
        if (preparation === 'pending') { lookup.resolve(alternative); await flush(); }
        expect(h.audio.src).toBe('/api/nhaccuatui/stream?id=prepared-native');
        expect(h.controller.getSnapshot().isPlaying).toBe(true);
        expect(lookups).toBe(1);
      } finally { lookup.resolve(null); h.cleanup(); }
    }
  );

  it('does not switch to an iframe when a quick lock-screen Next fails', async () => {
    const h = createHarness();
    try {
      await h.controller.playTrack(nativeTrack(), [nativeTrack(), youtubeTrack()], 0);
      h.controller.handleVisibilityChange(true);
      h.audio.play.mockRejectedValueOnce(new Error('next proxy 502'));
      h.controller.nextTrack();
      await flush();
      expect(h.iframe.loadVideoById).not.toHaveBeenCalled();
      expect(h.controller.getSnapshot().currentTrack?.id).toBe('yt-ios');
      expect(h.controller.getSnapshot().isPlaying).toBe(false);
      expect(h.controller.getSnapshot().playbackError).toBeTruthy();
    } finally { h.cleanup(); }
  });

  it('prepares a catalog stream for a direct YouTube next track before lock-screen Next', async () => {
    const h = createHarness({
      resolution: {
        resolve: async () => ({ source: 'nhaccuatui', id: 'next-native', streamUrl: 'https://media.test/next.mp3' }),
        invalidate: async () => {}, dispose: () => {},
      },
    });
    try {
      h.sources.prewarmNextAdaptive([nativeTrack(), youtubeTrack()], 0, 'off');
      await flush();
      const next = h.sources.resolveImmediate({ track: youtubeTrack(), tabHidden: true, preserveGesture: true });
      expect(next).toMatchObject({
        engine: 'html5', target: 'https://media.test/next.mp3',
        track: { id: 'yt-ios', source: 'nhaccuatui', nhaccuatui_id: 'next-native' },
      });
    } finally { h.cleanup(); }
  });
});
