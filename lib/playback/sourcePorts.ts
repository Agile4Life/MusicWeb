import type { Track } from '@/types';
import type { GlobalSearchTracks } from '@/lib/searchApi';
import type { ClientResolutionService } from '@/lib/stream-resolution/client/contracts';
import type { PlaybackClock } from './ports';

export interface PlaybackSourceDeps {
  clock: PlaybackClock;
  isIOS(): boolean;
  isFastConnection(): boolean;
  resolution: ClientResolutionService;
  search(query: string, source: 'all' | 'youtube', signal?: AbortSignal): Promise<GlobalSearchTracks>;
  resolveSoundCloudUrl(target: string | number, bypassCache?: boolean): Promise<string | null>;
  getDeterministicSoundCloudUrl?(target: string | number, bypassCache?: boolean): string;
  signStoragePath(filePath: string): Promise<string | null>;
  loadPersistedUrl(trackId: string): { url: string; youtube_id?: string } | null;
  savePersistedUrl(trackId: string, url: string, meta?: { youtube_id?: string }): void;
  getCachedYouTubeId(
    title: string,
    artist?: string | null,
    album?: string | null,
    duration?: number | null
  ): string | null;
  saveCachedYouTubeId(track: Track, youtubeId: string): void;
  getNctStreamUrl(track: Track): string | null;
  getCachedNctUrl(songId: string): string | null;
  prewarmNctUrl(songId: string): Promise<string | null | void>;
  clearCachedNctUrl(songId: string): void;
  resolveNctSong(songId: string): Promise<{
    title?: string;
    artist?: string;
    coverUrl?: string | null;
    duration?: number | null;
  } | null>;
  triggerDrivePrewarm(tracks: Track[]): void;
  prewarmTrackBatch(tracks: Track[]): Promise<void>;
  buildDriveStreamUrl(fileId: string): string;
  buildYouTubeStreamUrl(videoId: string): string;
}
