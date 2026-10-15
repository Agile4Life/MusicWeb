import { describe, expect, it, vi } from 'vitest';
import {
  createPlaylistRepository,
  PlaylistRequestError,
} from '@/lib/playlist/playlistRepository';

describe('playlistRepository', () => {
  it('lists playlists from /api/playlists and returns empty array on non-ok response', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ playlists: [{ id: 'pl-1', name: 'Chill' }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
      });

    const repo = createPlaylistRepository({ fetchFn: fetchFn as unknown as typeof fetch });

    await expect(repo.list()).resolves.toEqual([{ id: 'pl-1', name: 'Chill' }]);
    await expect(repo.list()).resolves.toEqual([]);
  });

  it('creates a playlist and throws PlaylistRequestError(401) when unauthorized', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ playlist: { id: 'pl-2', name: 'My Mix' } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

    const repo = createPlaylistRepository({ fetchFn: fetchFn as unknown as typeof fetch });

    await expect(repo.create('My Mix')).resolves.toEqual({ id: 'pl-2', name: 'My Mix' });
    await expect(repo.create('Secret')).rejects.toEqual(
      expect.objectContaining({
        name: 'PlaylistRequestError',
        status: 401,
      })
    );
  });

  it('removes a playlist and surfaces API error messages on failure', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Only owner can delete' }),
      });

    const repo = createPlaylistRepository({ fetchFn: fetchFn as unknown as typeof fetch });

    await expect(repo.remove('pl-1')).resolves.toBeUndefined();
    await expect(repo.remove('pl-1')).rejects.toThrow(PlaylistRequestError);
  });

  it('wires subscribe and notifyChanged through injected callbacks', () => {
    const unsubscribe = vi.fn();
    const subscribeToChanges = vi.fn(() => unsubscribe);
    const notifyChanged = vi.fn();
    const repo = createPlaylistRepository({ subscribeToChanges, notifyChanged });

    const onChange = vi.fn();
    const stop = repo.subscribe(onChange);
    expect(subscribeToChanges).toHaveBeenCalledWith(onChange);

    repo.notifyChanged();
    expect(notifyChanged).toHaveBeenCalledTimes(1);

    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
