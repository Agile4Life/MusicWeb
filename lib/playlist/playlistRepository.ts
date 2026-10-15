import { Playlist } from '@/types';

export class PlaylistRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'PlaylistRequestError';
  }
}

export interface PlaylistRepository {
  list(): Promise<Playlist[]>;
  create(customName?: string): Promise<Playlist | null>;
  remove(playlistId: string): Promise<void>;
  subscribe(onChange: () => void): () => void;
  notifyChanged(): void;
}

export interface PlaylistRepositoryDeps {
  fetchFn?: typeof fetch;
  subscribeToChanges?: (onChange: () => void) => () => void;
  notifyChanged?: () => void;
}

export function createPlaylistRepository(
  deps: PlaylistRepositoryDeps = {}
): PlaylistRepository {
  const fetchFn = deps.fetchFn ?? fetch;

  return {
    async list() {
      const res = await fetchFn('/api/playlists');
      if (!res.ok) return [];
      const data = await res.json();
      return data.playlists || [];
    },
    async create(customName) {
      const res = await fetchFn('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: customName }),
      });

      if (res.status === 401) {
        throw new PlaylistRequestError('Unauthorized', 401);
      }
      if (!res.ok) return null;

      const { playlist } = await res.json();
      return playlist ?? null;
    },
    async remove(playlistId) {
      const res = await fetchFn(`/api/playlists/${playlistId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new PlaylistRequestError(data?.error ?? res.statusText, res.status);
      }
    },
    subscribe(onChange) {
      return deps.subscribeToChanges ? deps.subscribeToChanges(onChange) : () => {};
    },
    notifyChanged() {
      deps.notifyChanged?.();
    },
  };
}
