import { describe, expect, it, vi } from 'vitest';
import { createPlaybackSourceService } from '@/lib/playback/playbackSourceService';
import type { PlaybackSourceDeps } from '@/lib/playback/sourcePorts';
import { makeTrack } from './fixtures';

function createFakeDeps(overrides: Partial<PlaybackSourceDeps> = {}): PlaybackSourceDeps {
  const now = 1_000;
  return {
    clock: {
      now: () => now,
      after: (_ms, cb) => {
        cb();
        return () => {};
      },
      every: () => () => {},
    },
    isIOS: () => false,
    isFastConnection: () => true,
    resolution: {
      resolve: vi.fn().mockResolvedValue(null),
      invalidate: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    },
    search: vi.fn().mockResolvedValue({
      nhaccuatui: [],
      local: [],
      youtube: [],
      audius: [],
      itunes: [],
      spotify: [],
      deezer: [],
      soundcloud: [],
    }),
    resolveSoundCloudUrl: vi.fn().mockResolvedValue('https://cdn.sc/stream.mp3'),
    getDeterministicSoundCloudUrl: (id) => `/api/soundcloud/stream?id=${id}`,
    signStoragePath: vi.fn().mockResolvedValue('https://signed.example/song.mp3'),
    loadPersistedUrl: vi.fn().mockReturnValue(null),
    savePersistedUrl: vi.fn(),
    getCachedYouTubeId: vi.fn().mockReturnValue(null),
    saveCachedYouTubeId: vi.fn(),
    getNctStreamUrl: vi.fn((track) =>
      track.nhaccuatui_id ? `/api/nhaccuatui/stream?id=${track.nhaccuatui_id}` : null
    ),
    getCachedNctUrl: vi.fn().mockReturnValue(null),
    prewarmNctUrl: vi.fn().mockResolvedValue(null),
    clearCachedNctUrl: vi.fn(),
    resolveNctSong: vi.fn().mockResolvedValue(null),
    triggerDrivePrewarm: vi.fn(),
    prewarmTrackBatch: vi.fn().mockResolvedValue(undefined),
    buildDriveStreamUrl: (fileId) => `/api/drive-stream?id=${fileId}`,
    buildYouTubeStreamUrl: (videoId) => `/api/youtube/stream?id=${videoId}`,
    ...overrides,
  };
}

describe('playbackSourceService', () => {
  it('synchronously resolves cached NCT, Drive, and iOS YouTube tracks via resolveImmediate', () => {
    const deps = createFakeDeps();
    const service = createPlaybackSourceService(deps);

    const driveTrack = makeTrack('drive-1', {
      source: 'local',
      drive_file_id: 'gdrive123',
      file_ext: 'flac',
    });
    expect(service.resolveImmediate({ track: driveTrack, preserveGesture: true })).toEqual({
      track: expect.objectContaining({ id: 'drive-1' }),
      engine: 'html5',
      target: '/api/drive-stream?id=gdrive123&filename=stream.flac',
      initialTime: 0,
    });

    const ytTrack = makeTrack('yt-1', {
      source: 'youtube',
      youtube_id: 'dQw4w9WgXcQ',
    });
    expect(service.resolveImmediate({ track: ytTrack, preserveGesture: true })).toBeNull();
    expect(service.resolveImmediate({ track: ytTrack, preserveGesture: false })).toEqual({
      track: expect.objectContaining({ id: 'yt-1', youtube_id: 'dQw4w9WgXcQ' }),
      engine: 'youtube',
      target: 'dQw4w9WgXcQ',
      initialTime: 0,
    });
  });

  it('routes iOS YouTube tracks to the HTML5 stream proxy', async () => {
    const deps = createFakeDeps({ isIOS: () => true });
    const service = createPlaybackSourceService(deps);
    const ytTrack = makeTrack('yt-ios', {
      source: 'youtube',
      youtube_id: 'abc123xyz00',
    });

    const immediate = service.resolveImmediate({ track: ytTrack, preserveGesture: true });
    expect(immediate).toEqual({
      track: expect.objectContaining({ id: 'yt-ios' }),
      engine: 'html5',
      target: '/api/youtube/stream?id=abc123xyz00',
      initialTime: 0,
    });

    const playable = await service.resolvePlayable({ track: ytTrack, initialTime: 12 });
    expect(playable).toEqual({
      track: expect.objectContaining({ id: 'yt-ios' }),
      engine: 'html5',
      target: '/api/youtube/stream?id=abc123xyz00',
      initialTime: 12,
    });
  });

  it('resolves catalog tracks via ClientResolutionService and caches the resolution', async () => {
    const resolveMock = vi.fn().mockResolvedValue({
      source: 'nhaccuatui',
      id: 'nct-999',
      title: 'Resolved Song',
      artist: 'Resolved Artist',
      duration: 210,
      streamUrl: '/api/nhaccuatui/stream?id=nct-999',
    });
    const deps = createFakeDeps({
      resolution: {
        resolve: resolveMock,
        invalidate: vi.fn().mockResolvedValue(undefined),
        dispose: vi.fn(),
      },
    });
    const service = createPlaybackSourceService(deps);

    const spotifyTrack = makeTrack('sp-1', {
      source: 'spotify',
      spotify_id: 'sp123',
      title: 'Resolved Song',
      artist: 'Resolved Artist',
      duration: 210,
      file_path: '',
    });

    const first = await service.resolvePlayable({ track: spotifyTrack });
    const second = await service.resolvePlayable({ track: spotifyTrack });

    expect(resolveMock).toHaveBeenCalledTimes(1);
    expect(first).toEqual({
      track: expect.objectContaining({
        id: 'sp-1',
        source: 'nhaccuatui',
        nhaccuatui_id: 'nct-999',
      }),
      engine: 'html5',
      target: '/api/nhaccuatui/stream?id=nct-999',
      initialTime: 0,
    });
    expect(second?.target).toBe('/api/nhaccuatui/stream?id=nct-999');
  });

  it('rejects fallback YouTube candidates longer than 20 minutes when the target track is short', async () => {
    const deps = createFakeDeps({
      search: vi.fn().mockResolvedValue({
        nhaccuatui: [],
        local: [],
        youtube: [
          makeTrack('yt-long', {
            source: 'youtube',
            youtube_id: 'longvideo11',
            title: 'Short Song 1 Hour Loop',
            artist: 'Fixture Artist',
            duration: 3600,
          }),
        ],
        audius: [],
        itunes: [],
        spotify: [],
        deezer: [],
        soundcloud: [],
      }),
    });
    const service = createPlaybackSourceService(deps);

    const shortTrack = makeTrack('short-1', {
      title: 'Short Song',
      artist: 'Fixture Artist',
      duration: 200,
    });

    const fallback = await service.resolveFallback(shortTrack, 15);
    expect(fallback).toBeNull();
  });

  it('invalidates cached resolution using original catalog identity and clears NCT cache', async () => {
    const invalidateMock = vi.fn().mockResolvedValue(undefined);
    const clearNctMock = vi.fn();
    const deps = createFakeDeps({
      resolution: {
        resolve: vi.fn().mockResolvedValue({
          source: 'nhaccuatui',
          id: 'nct-abc',
          title: 'Different NCT Title',
          artist: 'Different NCT Artist',
        }),
        invalidate: invalidateMock,
        dispose: vi.fn(),
      },
      clearCachedNctUrl: clearNctMock,
    });
    const service = createPlaybackSourceService(deps);

    const catalogTrack = makeTrack('cat-1', {
      source: 'spotify',
      spotify_id: 'sp-cat-1',
      title: 'Original Catalog Title',
      artist: 'Original Catalog Artist',
      duration: 195,
      album: 'Original Album',
      file_path: '',
    });

    const prepared = await service.resolvePlayable({ track: catalogTrack });
    expect(prepared?.track.nhaccuatui_id).toBe('nct-abc');

    await service.invalidateTrack(prepared!.track);
    expect(clearNctMock).toHaveBeenCalledWith('nct-abc');
    expect(invalidateMock).toHaveBeenCalledWith({
      title: 'Original Catalog Title',
      artist: 'Original Catalog Artist',
      duration: 195,
      album: 'Original Album',
    });
  });

  it('preserves the YouTube fallback match from search when an alternate NCT candidate is tried first (P2)', async () => {
    const searchMock = vi.fn().mockResolvedValue({
      nhaccuatui: [
        makeTrack('nct-match', {
          source: 'nhaccuatui',
          nhaccuatui_id: 'nct-777',
          title: 'Exact Song',
          artist: 'Exact Artist',
          duration: 200,
        }),
      ],
      local: [],
      youtube: [
        makeTrack('yt-match', {
          source: 'youtube',
          youtube_id: 'yt777video1',
          title: 'Exact Song',
          artist: 'Exact Artist',
          duration: 200,
        }),
      ],
      audius: [],
      itunes: [],
      spotify: [],
      deezer: [],
      soundcloud: [],
    });

    const deps = createFakeDeps({ search: searchMock });
    const service = createPlaybackSourceService(deps);

    const track = makeTrack('sp-exact', {
      source: 'spotify',
      title: 'Exact Song',
      artist: 'Exact Artist',
      duration: 200,
    });

    const firstCandidate = await service.resolveFallback(track, 0);
    expect(firstCandidate).toEqual({
      track: expect.objectContaining({
        id: 'sp-exact',
        source: 'nhaccuatui',
        nhaccuatui_id: 'nct-777',
      }),
      engine: 'html5',
      target: '/api/nhaccuatui/stream?id=nct-777',
      initialTime: 0,
    });

    // If NCT playback rejects, resolving fallback for the updated NCT track returns the YouTube match without losing it
    const secondCandidate = await service.resolveFallback(firstCandidate!.track, 0);
    expect(secondCandidate).toEqual({
      track: expect.objectContaining({
        id: 'sp-exact',
        source: 'youtube',
        youtube_id: 'yt777video1',
      }),
      engine: 'youtube',
      target: 'yt777video1',
      initialTime: 0,
    });
    expect(searchMock).toHaveBeenCalledTimes(1);
  });

  it('prioritizes SoundCloud HTML5 streams ahead of YouTube IFrame in emergency catalog search and resolveFallback', async () => {
    const searchMock = vi.fn().mockResolvedValue({
      nhaccuatui: [],
      local: [],
      youtube: [
        makeTrack('yt-1', {
          source: 'youtube',
          youtube_id: 'yt-video-99',
          title: 'Starboy',
          artist: 'The Weeknd',
          duration: 230,
        }),
      ],
      audius: [],
      itunes: [],
      spotify: [],
      deezer: [],
      soundcloud: [
        makeTrack('sc-1', {
          source: 'soundcloud',
          soundcloud_id: 'sc-track-99',
          title: 'Starboy',
          artist: 'The Weeknd',
          duration: 230,
        }),
      ],
    });

    const deps = createFakeDeps({
      search: searchMock,
      resolveSoundCloudUrl: vi.fn().mockResolvedValue('https://cdn.sc/starboy.mp3'),
    });
    const service = createPlaybackSourceService(deps);

    const catalogTrack = makeTrack('sp-starboy', {
      source: 'spotify',
      spotify_id: 'sp-99',
      title: 'Starboy',
      artist: 'The Weeknd',
      duration: 230,
      file_path: '',
    });

    // 1. Emergency catalog search when primary resolution returns null
    const playable = await service.resolvePlayable({ track: catalogTrack });
    expect(playable).toEqual({
      track: expect.objectContaining({
        id: 'sp-starboy',
        source: 'soundcloud',
        soundcloud_id: 'sc-track-99',
      }),
      engine: 'html5',
      target: 'https://cdn.sc/starboy.mp3',
      initialTime: 0,
    });

    // 2. resolveFallback when NCT is absent -> picks SoundCloud HTML5 first, then YouTube if SoundCloud fails
    const otherTrack = makeTrack('sp-starboy-2', {
      source: 'spotify',
      title: 'Starboy',
      artist: 'The Weeknd',
      duration: 230,
    });
    const fbFirst = await service.resolveFallback(otherTrack, 42);
    expect(fbFirst).toEqual({
      track: expect.objectContaining({
        id: 'sp-starboy-2',
        source: 'soundcloud',
        soundcloud_id: 'sc-track-99',
      }),
      engine: 'html5',
      target: 'https://cdn.sc/starboy.mp3',
      initialTime: 42,
    });

    const fbSecond = await service.resolveFallback(fbFirst!.track, 42);
    expect(fbSecond).toEqual({
      track: expect.objectContaining({
        id: 'sp-starboy-2',
        source: 'youtube',
        youtube_id: 'yt-video-99',
      }),
      engine: 'youtube',
      target: 'yt-video-99',
      initialTime: 42,
    });
  });

  it('passes duration to getCachedYouTubeId, skips identical failing youtube_id, and supports preferHtml5 fallback', async () => {
    const getCachedYtMock = vi.fn().mockReturnValue('sameFailingId');
    const deps = createFakeDeps({
      getCachedYouTubeId: getCachedYtMock,
    });
    const service = createPlaybackSourceService(deps);

    const failingYtTrack = makeTrack('yt-fail', {
      source: 'youtube',
      youtube_id: 'sameFailingId',
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
      duration: 195,
    });

    // Should pass duration and ignore cachedYtId when it equals the already-failing track.youtube_id
    const fb = await service.resolveFallback(failingYtTrack, 30);
    expect(getCachedYtMock).toHaveBeenCalledWith(
      'Test Song',
      'Test Artist',
      'Test Album',
      195
    );
    expect(fb).toBeNull();

    // When preferHtml5 is true, routes YouTube track to HTML5 stream proxy
    const html5Fb = await service.resolveFallback(failingYtTrack, 30, undefined, {
      preferHtml5: true,
    });
    expect(html5Fb).toEqual({
      track: expect.objectContaining({
        id: 'yt-fail',
        youtube_id: 'sameFailingId',
      }),
      engine: 'html5',
      target: '/api/youtube/stream?id=sameFailingId',
      initialTime: 30,
    });
  });

  it('hydrates restored catalog tracks (Spotify/Deezer) on reload via resolvePlayable and uses cached CDN URLs for NCT tracks', async () => {
    const cachedNctUrls = new Map<string, string>();
    const deps = createFakeDeps({
      resolveNctSong: vi.fn().mockImplementation(async (id: string) => {
        cachedNctUrls.set(id, `https://cdn.nct.vn/${id}.mp3`);
      }),
      getCachedNctUrl: (id?: string | null) =>
        id ? cachedNctUrls.get(id) ?? null : null,
      resolution: {
        resolve: vi.fn().mockResolvedValue({
          source: 'nhaccuatui',
          id: 'nct-restored-1',
          title: 'Restored Song',
          artist: 'Restored Artist',
        }),
        invalidate: vi.fn(),
        dispose: vi.fn(),
      },
    });
    const service = createPlaybackSourceService(deps);

    const restoredSpotifyTrack = makeTrack('sp-reload-1', {
      source: 'spotify',
      spotify_id: 'sp-reload-1',
      title: 'Restored Song',
      artist: 'Restored Artist',
      file_path: '',
    });

    const hydratedCatalog = await service.hydrateRestoredTrack(restoredSpotifyTrack, 73);
    expect(hydratedCatalog).toEqual({
      track: expect.objectContaining({
        id: 'sp-reload-1',
        source: 'nhaccuatui',
        nhaccuatui_id: 'nct-restored-1',
      }),
      engine: 'html5',
      target: 'https://cdn.nct.vn/nct-restored-1.mp3',
      initialTime: 73,
    });

    const restoredNctTrack = makeTrack('nct-direct-1', {
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-direct-1',
      file_path: '',
    });
    const hydratedNct = await service.hydrateRestoredTrack(restoredNctTrack, 48);
    expect(hydratedNct?.target).toBe('https://cdn.nct.vn/nct-direct-1.mp3');
    expect(hydratedNct?.initialTime).toBe(48);
  });

  it('prewarms iOS YouTube and SoundCloud next tracks into audioUrlCache for synchronous Lock Screen transitions', async () => {
    let resolveSc!: (url: string) => void;
    const scPromise = new Promise<string>((res) => {
      resolveSc = res;
    });
    const resolveMock = vi
      .fn()
      .mockResolvedValueOnce({
        source: 'youtube',
        id: 'yt-ios-resolved',
        title: 'iOS YT Song',
        artist: 'iOS Artist',
      })
      .mockResolvedValueOnce({
        source: 'soundcloud',
        id: 'sc-ios-resolved',
        title: 'iOS SC Song',
        artist: 'iOS Artist',
      });

    const deps = createFakeDeps({
      isIOS: () => true,
      resolution: {
        resolve: resolveMock,
        invalidate: vi.fn(),
        dispose: vi.fn(),
      },
      resolveSoundCloudUrl: vi.fn(() => scPromise),
    });
    const service = createPlaybackSourceService(deps);

    const currentTrack = makeTrack('cur-1');
    const catalogYtTrack = makeTrack('cat-yt-1', {
      source: 'spotify',
      spotify_id: 'sp-yt-1',
      file_path: '',
    });
    const catalogScTrack = makeTrack('cat-sc-1', {
      source: 'spotify',
      spotify_id: 'sp-sc-1',
      file_path: '',
    });
    const directYtTrack = makeTrack('direct-yt-1', {
      source: 'youtube',
      youtube_id: 'directYt111',
      file_path: '',
    });

    // 1. Prewarm catalog track that resolves to YouTube on iOS
    service.prewarmNextAdaptive([currentTrack, catalogYtTrack], 0, 'off');
    await Promise.resolve();
    await Promise.resolve();

    expect(
      service.resolveImmediate({ track: catalogYtTrack, tabHidden: true })
    ).toEqual({
      track: expect.objectContaining({
        id: 'cat-yt-1',
        source: 'youtube',
        youtube_id: 'yt-ios-resolved',
      }),
      engine: 'html5',
      target: '/api/youtube/stream?id=yt-ios-resolved',
      initialTime: 0,
    });

    // 2. Prewarm catalog track that resolves to SoundCloud on iOS -> immediately seeds deterministic URL, then upgrades to CDN URL
    service.prewarmNextAdaptive([currentTrack, catalogScTrack], 0, 'off');
    await Promise.resolve();
    await Promise.resolve();

    expect(
      service.resolveImmediate({ track: catalogScTrack, tabHidden: true })
    ).toEqual({
      track: expect.objectContaining({
        id: 'cat-sc-1',
        source: 'soundcloud',
        soundcloud_id: 'sc-ios-resolved',
      }),
      engine: 'html5',
      target: '/api/soundcloud/stream?id=sc-ios-resolved',
      initialTime: 0,
    });

    resolveSc('https://cdn.sc/ios-resolved.mp3');
    await Promise.resolve();
    await Promise.resolve();

    expect(
      service.resolveImmediate({ track: catalogScTrack, tabHidden: true })
    )?.toMatchObject({
      engine: 'html5',
      target: 'https://cdn.sc/ios-resolved.mp3',
    });

    // 3. Prewarm direct YouTube track on iOS -> does not call resolution.resolve
    resolveMock.mockClear();
    service.prewarmNextAdaptive([currentTrack, directYtTrack], 0, 'off');
    await Promise.resolve();
    expect(resolveMock).not.toHaveBeenCalled();
  });
});

