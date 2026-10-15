import { createClient } from '@/lib/supabase/client';
import {
  createPlaylistRepository,
  PlaylistRepository,
} from '@/lib/playlist/playlistRepository';

export function createBrowserPlaylistRepository(): PlaylistRepository {
  const supabase = createClient();

  return createPlaylistRepository({
    fetchFn: (...args) => fetch(...args),
    subscribeToChanges: (onChange) => {
      const channel = supabase
        .channel('global-playlists')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'playlists' },
          () => {
            onChange();
          }
        )
        .subscribe();

      const handleCustomUpdate = () => {
        onChange();
      };
      if (typeof window !== 'undefined') {
        window.addEventListener('playlist-updated', handleCustomUpdate);
      }

      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('playlist-updated', handleCustomUpdate);
        }
        supabase.removeChannel(channel);
      };
    },
    notifyChanged: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('playlist-updated'));
      }
    },
  });
}
