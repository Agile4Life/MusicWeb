import type { Track } from '@/types';
import { isIOSDevice } from '@/lib/audioPlayback';
import {
  buildDriveStreamUrl,
  triggerDrivePrewarm,
} from '@/lib/googleDriveUpload';
import {
  clearCachedNctStreamUrl,
  getCachedNctStreamUrl,
  getNhacCuaTuiStreamUrl,
  prewarmNctStreamUrl,
  resolveNhacCuaTuiSong,
} from '@/lib/nhaccuatuiClient';
import {
  getCachedYouTubeId,
  getStreamUrl,
  saveStreamUrl,
  saveTrackResolution,
} from '@/lib/playbackPersistence';
import { prewarmTrackBatch } from '@/lib/prewarmTrackBatch';
import { fetchUnifiedSearch } from '@/lib/searchApi';
import { getClientResolutionService } from '@/lib/stream-resolution/client/composition';
import { createClient } from '@/lib/supabase/client';
import { buildYouTubeStreamUrl } from '@/lib/youtubeStreamUrl';
import type { PlaybackClock } from '@/lib/playback/ports';
import type { PlaybackSourceDeps } from '@/lib/playback/sourcePorts';
import { isFastConnection } from '../prewarmAdaptive';

export function createBrowserSourceDependencies(
  clock: PlaybackClock
): PlaybackSourceDeps {
  const supabase = createClient();

  const getDeterministicSoundCloudUrl = (
    target: string | number,
    bypassCache = false
  ): string => {
    const refreshQuery = bypassCache ? '&refresh=1' : '';
    return `/api/soundcloud/stream?id=${encodeURIComponent(target)}${refreshQuery}`;
  };

  return {
    clock,
    isIOS: () => isIOSDevice(),
    isFastConnection: () => isFastConnection(),
    resolution: getClientResolutionService(),
    search: async (query, source, signal) => {
      if (signal) {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}&source=${encodeURIComponent(
            source
          )}`,
          { signal }
        );
        if (!res.ok) {
          throw new Error(`Search API returned status ${res.status}`);
        }
        return res.json();
      }
      return fetchUnifiedSearch(query, source, false);
    },
    resolveSoundCloudUrl: async (target, bypassCache = false) => {
      const workerUrl = process.env.NEXT_PUBLIC_SOUNDCLOUD_WORKER_URL?.trim();
      const refreshQuery = bypassCache ? '&refresh=1' : '';
      const cleanTarget = String(target)
        .trim()
        .replace(/^sc-/, '')
        .replace(/^soundcloud:/, '');
      const isNumericId = /^\d+$/.test(cleanTarget);
      const effectiveTarget = isNumericId ? cleanTarget : target;
      const localEndpoint = `/api/soundcloud/stream?id=${encodeURIComponent(
        effectiveTarget
      )}&format=json${refreshQuery}`;
      try {
        // Cloudflare Worker only supports numeric SoundCloud IDs (/^\d+$/).
        // Permalink URLs (https://soundcloud.com/...) and DB UUIDs from listening history
        // must be resolved through /api/soundcloud/stream.
        if (workerUrl && isNumericId) {
          const cleanWorkerOrigin = workerUrl.replace(/\/+$/, '');
          const workerEndpoint = `${cleanWorkerOrigin}/stream?id=${encodeURIComponent(
            cleanTarget
          )}&format=json${refreshQuery}`;
          try {
            const workerRes = await fetch(workerEndpoint);
            if (workerRes.ok) {
              const data = await workerRes.json();
              if (data.url) {
                if (String(data.url).startsWith(cleanWorkerOrigin)) {
                  return `/api/soundcloud/stream?id=${encodeURIComponent(
                    cleanTarget
                  )}${refreshQuery}`;
                }
                return data.url;
              }
            }
          } catch (workerErr) {
            console.warn(
              '[SoundCloud getAudioUrl] worker resolve error, falling back to local API:',
              workerErr
            );
          }
        }

        const res = await fetch(localEndpoint);
        if (res.ok) {
          const data = await res.json();
          if (data.url) {
            return data.url;
          }
        } else if (res.status === 404 || res.status === 403 || res.status === 502) {
          return null;
        }
      } catch (e) {
        console.warn('[SoundCloud getAudioUrl] direct resolve error:', e);
      }
      return getDeterministicSoundCloudUrl(effectiveTarget, bypassCache);
    },
    getDeterministicSoundCloudUrl,
    signStoragePath: async (filePath: string) => {
      const { data, error } = await supabase.storage
        .from('music-files')
        .createSignedUrl(filePath, 3600);
      if (error || !data?.signedUrl) {
        const { data: pubData } = supabase.storage
          .from('music-files')
          .getPublicUrl(filePath);
        return pubData.publicUrl;
      }
      return data.signedUrl;
    },
    loadPersistedUrl: (trackId) => getStreamUrl(trackId),
    savePersistedUrl: (trackId, url, meta) => saveStreamUrl(trackId, url, meta),
    getCachedYouTubeId: (title, artist, album, duration) =>
      getCachedYouTubeId(title, artist, album, duration),
    saveCachedYouTubeId: (track: Track, youtubeId: string) => {
      try {
        const dur = track.duration || 0;
        const keyWithDur = `${track.title.trim().toLowerCase()}___${(
          track.artist || ''
        )
          .trim()
          .toLowerCase()}___${dur}___${(track.album || '')
          .trim()
          .toLowerCase()}`;
        const keyWithoutDur = `${track.title.trim().toLowerCase()}___${(
          track.artist || ''
        )
          .trim()
          .toLowerCase()}___${(track.album || '').trim().toLowerCase()}`;
        const payload = {
          source: 'youtube',
          resolvedId: youtubeId,
          ttl: 24 * 60 * 60 * 1000,
          youtubeVideoId: youtubeId,
        };
        saveTrackResolution(keyWithDur, payload);
        saveTrackResolution(keyWithoutDur, payload);
      } catch {
        // Best-effort
      }
    },
    getNctStreamUrl: (track) => getNhacCuaTuiStreamUrl(track),
    getCachedNctUrl: (songId) => getCachedNctStreamUrl(songId),
    prewarmNctUrl: (songId) => prewarmNctStreamUrl(songId),
    clearCachedNctUrl: (songId) => clearCachedNctStreamUrl(songId),
    resolveNctSong: (songId) => resolveNhacCuaTuiSong(songId),
    triggerDrivePrewarm: (tracks) => triggerDrivePrewarm(tracks),
    prewarmTrackBatch: (tracks) => prewarmTrackBatch(tracks),
    buildDriveStreamUrl: (fileId) => buildDriveStreamUrl(fileId),
    buildYouTubeStreamUrl: (videoId) => buildYouTubeStreamUrl(videoId),
  };
}
