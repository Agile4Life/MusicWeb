import { describe, expect, it, vi } from 'vitest';
import { createPlaybackController } from '@/lib/playback/playbackController';
import type { PlaybackSourceService } from '@/lib/playback/playbackSourceService';
import type {
  PlaybackPersistencePort,
  PlaybackTransport,
  PlaybackUserEffects,
} from '@/lib/playback/ports';
import type { Track } from '@/types';

function createSearchControllerHarness() {
  const transport: PlaybackTransport = {
    start: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    read: () => ({ time: 0, duration: 180, playing: true }),
    subscribe: () => () => {},
    dispose: vi.fn(),
  };

  const sources: PlaybackSourceService = {
    resolveImmediate: vi.fn((req) => ({
      track: req.track,
      engine: 'html5' as const,
      target: req.track.file_path || `https://cdn.example/${req.track.id}.mp3`,
      initialTime: 0,
    })),
    resolvePlayable: vi.fn().mockResolvedValue(null),
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

  return createPlaybackController({
    clock: {
      now: () => 1000,
      after: () => () => {},
      every: () => () => {},
    },
    transport,
    sources,
    persistence,
    userEffects,
  });
}

describe('Search Queue Isolation Logic', () => {
  const mockTrack = (id: string, title: string): Track => ({
    id,
    title,
    artist: 'Test Artist',
    duration: 180,
    source: 'local',
    user_id: 'user-1',
    file_path: `/music/${id}.mp3`,
    cover_url: null,
    created_at: new Date().toISOString(),
  });

  it('initializes a single-track queue when searching on an empty queue', async () => {
    const controller = createSearchControllerHarness();
    const searchTrack = mockTrack('search-1', 'Searched Song');

    await controller.playSearchTrack(searchTrack);

    const snap = controller.getSnapshot();
    expect(snap.queue).toHaveLength(1);
    expect(snap.queue[0].id).toBe('search-1');
    expect(snap.currentIndex).toBe(0);
  });

  it('inserts searched track after the currently playing song without wiping existing playlist', async () => {
    const controller = createSearchControllerHarness();
    const songA = mockTrack('1', 'Song A');
    const songB = mockTrack('2', 'Song B');
    const songC = mockTrack('3', 'Song C');
    const songD = mockTrack('4', 'Song D');

    await controller.playTrack(songB, [songA, songB, songC, songD], 1);

    const searchTrack = mockTrack('st-1', 'Searched Track Hit');
    await controller.playSearchTrack(searchTrack);

    const snap = controller.getSnapshot();
    expect(snap.queue.map((t) => t.id)).toEqual(['1', '2', 'st-1', '3', '4']);
    expect(snap.queue).toHaveLength(5);
    expect(snap.queue[2].id).toBe('st-1');
    expect(snap.currentIndex).toBe(2);

    controller.nextTrack();
    expect(controller.getSnapshot().currentTrack?.id).toBe('3');
  });

  it('does not duplicate track if it already exists in the queue', async () => {
    const controller = createSearchControllerHarness();
    const songA = mockTrack('1', 'Song A');
    const songB = mockTrack('2', 'Song B');
    const songC = mockTrack('3', 'Song C');

    await controller.playTrack(songA, [songA, songB, songC], 0);
    await controller.playSearchTrack(songC);

    const snap = controller.getSnapshot();
    expect(snap.queue).toHaveLength(3);
    expect(snap.currentIndex).toBe(2);
    expect(snap.currentTrack?.id).toBe('3');
  });

  it('handles multiple consecutive search selections without queue wipe', async () => {
    const controller = createSearchControllerHarness();
    const base1 = mockTrack('b-1', 'Base 1');
    const base2 = mockTrack('b-2', 'Base 2');

    await controller.playTrack(base1, [base1, base2], 0);

    const search1 = mockTrack('s-1', 'Search Track 1');
    await controller.playSearchTrack(search1);
    expect(controller.getSnapshot().currentIndex).toBe(1);
    expect(controller.getSnapshot().queue.map((t) => t.id)).toEqual([
      'b-1',
      's-1',
      'b-2',
    ]);

    const search2 = mockTrack('s-2', 'Search Track 2');
    await controller.playSearchTrack(search2);
    expect(controller.getSnapshot().currentIndex).toBe(2);
    expect(controller.getSnapshot().queue.map((t) => t.id)).toEqual([
      'b-1',
      's-1',
      's-2',
      'b-2',
    ]);

    controller.nextTrack();
    expect(controller.getSnapshot().currentTrack?.id).toBe('b-2');
  });
});
