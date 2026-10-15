import { describe, expect, it, vi } from 'vitest';
import { isFastConnection } from '../prewarmAdaptive';
import { createPlaybackController } from '@/lib/playback/playbackController';
import { createPlaybackSourceService } from '@/lib/playback/playbackSourceService';
import type {
  PlaybackEvent,
  PlaybackOwner,
  PlaybackPersistencePort,
  PlaybackTransport,
  PlaybackUserEffects,
} from '@/lib/playback/ports';
import type { PlaybackSourceDeps } from '@/lib/playback/sourcePorts';
import { makeTrack } from '@/lib/playback/__tests__/fixtures';

describe('Player Adaptive Prewarming & Bandwidth Protection (Task 3)', () => {
  it('Network Gate: rejects prewarming if saveData is enabled', () => {
    const mockNav = {
      connection: {
        saveData: true,
        effectiveType: '4g',
      },
    };
    expect(isFastConnection(mockNav as unknown as Navigator)).toBe(false);
  });

  it('Network Gate: rejects prewarming on slow connections (2g, 3g, slow-2g)', () => {
    expect(
      isFastConnection({
        connection: { effectiveType: 'slow-2g', saveData: false },
      } as unknown as Navigator)
    ).toBe(false);
    expect(
      isFastConnection({
        connection: { effectiveType: '2g', saveData: false },
      } as unknown as Navigator)
    ).toBe(false);
    expect(
      isFastConnection({
        connection: { effectiveType: '3g', saveData: false },
      } as unknown as Navigator)
    ).toBe(false);
    expect(
      isFastConnection({
        connection: { effectiveType: '4g', saveData: false },
      } as unknown as Navigator)
    ).toBe(true);
    expect(isFastConnection({} as unknown as Navigator)).toBe(true);
  });

  it('Throttling: Only schedules prewarm for single next track (currentIndex + 1)', async () => {
    let fastNet = true;
    const prewarmedNctIds: string[] = [];
    const clock = {
      now: () => 10_000,
      after: () => () => {},
      every: () => () => {},
    };

    const sourceDeps: PlaybackSourceDeps = {
      clock,
      isIOS: () => false,
      isFastConnection: () => fastNet,
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
      resolveSoundCloudUrl: vi.fn().mockResolvedValue(null),
      getDeterministicSoundCloudUrl: (id) => `/api/soundcloud/stream?id=${id}`,
      signStoragePath: vi.fn().mockResolvedValue('https://signed.example/song.mp3'),
      loadPersistedUrl: vi.fn().mockReturnValue(null),
      savePersistedUrl: vi.fn(),
      getCachedYouTubeId: vi.fn().mockReturnValue(null),
      saveCachedYouTubeId: vi.fn(),
      getNctStreamUrl: vi.fn((track) =>
        track.nhaccuatui_id
          ? `/api/nhaccuatui/stream?id=${track.nhaccuatui_id}`
          : null
      ),
      getCachedNctUrl: vi.fn().mockReturnValue(null),
      prewarmNctUrl: vi.fn(async (songId) => {
        prewarmedNctIds.push(songId);
        return `https://cdn.nct/${songId}.mp3`;
      }),
      clearCachedNctUrl: vi.fn(),
      resolveNctSong: vi.fn().mockResolvedValue(null),
      triggerDrivePrewarm: vi.fn(),
      prewarmTrackBatch: vi.fn().mockResolvedValue(undefined),
      buildDriveStreamUrl: (fileId) => `/api/drive-stream?id=${fileId}`,
      buildYouTubeStreamUrl: (videoId) => `/api/youtube/stream?id=${videoId}`,
    };

    const sources = createPlaybackSourceService(sourceDeps);
    // Disable initial playTrack upcoming prewarm so we isolate the 5s adaptive prewarm gate
    vi.spyOn(sources, 'prewarmUpcoming').mockImplementation(() => {});

    let activeOwner: PlaybackOwner | null = null;
    const listeners = new Set<(event: PlaybackEvent) => void>();
    const transport: PlaybackTransport & { emit(e: PlaybackEvent): void } = {
      start: vi.fn(async (_target, owner) => {
        activeOwner = { ...owner };
      }),
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

    const queue = [
      makeTrack('t0', { source: 'nhaccuatui', nhaccuatui_id: 'nct-0' }),
      makeTrack('t1', { source: 'nhaccuatui', nhaccuatui_id: 'nct-1' }),
      makeTrack('t2', { source: 'nhaccuatui', nhaccuatui_id: 'nct-2' }),
      makeTrack('t3', { source: 'nhaccuatui', nhaccuatui_id: 'nct-3' }),
    ];

    await controller.playTrack(queue[0], queue, 0);
    const owner = activeOwner!;

    // 1. At 1s into playback -> must not prewarm yet
    transport.emit({ type: 'time', owner, time: 1, duration: 180 });
    expect(prewarmedNctIds).toHaveLength(0);

    // 2. While buffering at 6s -> must not prewarm yet
    transport.emit({ type: 'buffering', owner, value: true });
    transport.emit({ type: 'time', owner, time: 6, duration: 180 });
    expect(prewarmedNctIds).toHaveLength(0);
    transport.emit({ type: 'buffering', owner, value: false });

    // 3. Slow network at 6s -> sources.prewarmNextAdaptive rejects prewarm
    fastNet = false;
    sources.prewarmNextAdaptive(queue, 0, 'off');
    expect(prewarmedNctIds).toHaveLength(0);

    // 4. Fast network + 6s stable playback -> prewarms ONLY single next track (nct-1)
    fastNet = true;
    transport.emit({ type: 'time', owner, time: 6, duration: 180 });
    expect(prewarmedNctIds).toEqual(['nct-1']);
  });
});
