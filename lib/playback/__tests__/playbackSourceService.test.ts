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
});
