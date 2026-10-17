import type { Track } from '@/types';
import { getAudioUrlCacheTtl, readFreshAudioUrl } from '@/lib/audioUrlCache';
import { shouldUseHtml5Audio } from '@/lib/audioPlayback';
import {
  findBestSoundCloudMatch,
  stripNonIdentityAnnotations,
} from '@/lib/catalogMatching';
import { extractDriveFileId, isPreviewUrl } from '@/lib/googleDriveUpload';
import { findBestNhacCuaTuiMatch } from '@/lib/nhaccuatui';
import { isAbortError, planUpcomingPrewarm } from '@/lib/prewarmPlan';
import type { ResolvedStreamResult } from '@/lib/stream-resolution/client/contracts';
import { classifyTrack, inferTrackSource } from '@/lib/trackSourceClassifier';
import { extractYouTubeVideoId, findBestYouTubeMatch } from '@/lib/youtube';
import type { PreparedPlayback } from './ports';
import type { PlaybackSourceDeps } from './sourcePorts';

const AUDIO_URL_MAX_ENTRIES = 200;
const TRACK_RESOLUTION_MAX_ENTRIES = 200;
const TRACK_RESOLUTION_TTL_MS = 30 * 60 * 1000;

function setBounded<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number): void {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
}

function getBoundedRefreshed<K, V>(
  map: Map<K, V>,
  key: K,
  isExpired?: (val: V) => boolean
): V | undefined {
  if (!map.has(key)) return undefined;
  const value = map.get(key) as V;
  if (isExpired && isExpired(value)) {
    map.delete(key);
    return undefined;
  }
  map.delete(key);
  map.set(key, value);
  return value;
}

function extractDriveStreamWithExt(
  track: Track,
  driveFileId: string,
  buildDriveStreamUrl: (fileId: string) => string
): string {
  const ext =
    track.file_ext ||
    track.title?.match(/\.(flac|mp3|wav|m4a|aac|ogg|wma)(?:[?#]|$)/i)?.[1]?.toLowerCase() ||
    '';
  const filenameParam = ext ? `&filename=${encodeURIComponent(`stream.${ext}`)}` : '';
  const baseUrl = buildDriveStreamUrl(driveFileId);
  return filenameParam
    ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${filenameParam.slice(1)}`
    : baseUrl;
}

function extractSoundCloudTarget(track: Track): string | number {
  let scTarget: string | number = track.soundcloud_id ?? '';
  if (!scTarget) {
    if (track.file_path && track.file_path.startsWith('soundcloud:')) {
      scTarget = track.file_path.replace('soundcloud:', '');
    } else if (track.file_path && track.file_path.includes('soundcloud.com')) {
      scTarget = track.file_path;
    } else if (track.source_url && track.source_url.includes('soundcloud.com')) {
      scTarget = track.source_url;
    } else if (track.soundcloud_permalink_url) {
      scTarget = track.soundcloud_permalink_url;
    } else if (
      track.id &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        track.id
      )
    ) {
      scTarget = track.id.replace(/^sc-/, '');
    } else {
      scTarget = track.id;
    }
  }
  return scTarget;
}

function isSoundCloudTrack(track: Track): boolean {
  return Boolean(
    track.source === 'soundcloud' ||
      track.soundcloud_id ||
      track.id?.startsWith('sc-') ||
      (track.file_path &&
        (track.file_path.includes('soundcloud.com') ||
          track.file_path.startsWith('soundcloud:'))) ||
      (track.source_url && track.source_url.includes('soundcloud.com')) ||
      (track.soundcloud_permalink_url &&
        track.soundcloud_permalink_url.includes('soundcloud.com'))
  );
}

function applyResolvedStreamToTrack(track: Track, streamResult: ResolvedStreamResult): Track {
  if (streamResult.source === 'nhaccuatui') {
    return {
      ...track,
      source: 'nhaccuatui',
      nhaccuatui_id: streamResult.id,
      soundcloud_id: undefined,
      youtube_id: undefined,
      audio_url: undefined,
      file_path: '',
      title: streamResult.title || track.title,
      artist: streamResult.artist || track.artist,
      duration: streamResult.duration || track.duration,
      cover_url: streamResult.coverUrl || track.cover_url || null,
    };
  }
  if (streamResult.source === 'drive') {
    return {
      ...track,
      source: 'local',
      file_path: streamResult.id,
      nhaccuatui_id: undefined,
      soundcloud_id: undefined,
      youtube_id: undefined,
      audio_url: undefined,
      title: streamResult.title || track.title,
      artist: streamResult.artist || track.artist,
      duration: streamResult.duration || track.duration,
      cover_url: streamResult.coverUrl || track.cover_url || null,
      album: track.album || null,
      spotify_album_id: track.spotify_album_id || null,
    };
  }
  if (streamResult.source === 'soundcloud') {
    return {
      ...track,
      source: 'soundcloud',
      soundcloud_id: streamResult.id,
      nhaccuatui_id: undefined,
      youtube_id: undefined,
      audio_url: undefined,
      file_path: '',
      title: streamResult.title || track.title,
      artist: streamResult.artist || track.artist,
      duration: streamResult.duration || track.duration,
      cover_url: streamResult.coverUrl || track.cover_url || null,
    };
  }
  return {
    ...track,
    youtube_id: streamResult.id,
    nhaccuatui_id: undefined,
    soundcloud_id: undefined,
    source: 'youtube',
    audio_url: undefined,
    file_path: '',
  };
}

export interface SourceRequest {
  track: Track;
  initialTime?: number;
  bypassCache?: boolean;
  preserveGesture?: boolean;
  tabHidden?: boolean;
  signal?: AbortSignal;
}

export interface PlaybackSourceService {
  resolveImmediate(req: SourceRequest): PreparedPlayback | null;
  resolvePlayable(req: SourceRequest): Promise<PreparedPlayback | null>;
  resolveFallback(
    track: Track,
    currentTime: number,
    preSearched?: Track | null,
    options?: { preferHtml5?: boolean }
  ): Promise<PreparedPlayback | null>;
  resolveYouTubeAlternate(
    track: Track,
    currentTime?: number
  ): Promise<PreparedPlayback | null>;
  refreshStream(track: Track, initialTime: number): Promise<PreparedPlayback | null>;
  searchYouTubeCandidate(track: Track): Promise<Track | null>;
  invalidateTrack(track: Track): Promise<void>;
  prewarmUpcoming(
    queue: Track[],
    currentIndex: number,
    repeatMode: 'off' | 'all' | 'one',
    options?: { tabHidden?: boolean }
  ): void;
  prewarmNextAdaptive(
    queue: Track[],
    currentIndex: number,
    repeatMode: 'off' | 'all' | 'one'
  ): void;
  prewarmNearEnd(
    queue: Track[],
    currentIndex: number,
    repeatMode: 'off' | 'all' | 'one',
    isShuffle: boolean
  ): void;
  hydrateRestoredTrack(track: Track, initialTime: number): Promise<PreparedPlayback | null>;
  dispose(): void;
}

export function createPlaybackSourceService(
  deps: PlaybackSourceDeps
): PlaybackSourceService {
  const audioUrlCache = new Map<string, { url: string; ts: number }>();
  const trackResolutionCache = new Map<string, { activeTrack: Track; expiresAt: number }>();
  const pendingYoutubeFallbackByTrackId = new Map<string, Track>();
  const resolutionIdentities = new Map<
    string,
    { title: string; artist?: string | null; duration?: number | null; album?: string | null }
  >();
  const resolvingTrackIds = new Set<string>();
  let disposed = false;

  const rememberIdentity = (track: Track) => {
    resolutionIdentities.set(track.id, {
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      album: track.album,
    });
  };

  const getAudioUrl = async (track: Track, bypassCache = false): Promise<string | null> => {
    const nctStreamUrl = deps.getNctStreamUrl(track);
    if (nctStreamUrl) return nctStreamUrl;

    if (isSoundCloudTrack(track)) {
      const scTarget = extractSoundCloudTarget(track);
      return deps.resolveSoundCloudUrl(scTarget, bypassCache);
    }

    if (deps.isIOS() && track.youtube_id) {
      return deps.buildYouTubeStreamUrl(track.youtube_id);
    }

    if (
      track.source === 'audius' ||
      (track.audio_url &&
        !isPreviewUrl(track.audio_url) &&
        !track.youtube_id &&
        !track.nhaccuatui_id &&
        !track.soundcloud_id)
    ) {
      return track.audio_url || track.file_path || null;
    }

    if (!shouldUseHtml5Audio(track)) return null;

    const filePath = track.file_path || '';
    if (!filePath) return null;

    if (
      filePath.includes('spotify.com') ||
      filePath.startsWith('spotify:') ||
      filePath.includes('p.scdn.co') ||
      track.source === 'spotify' ||
      Boolean(track.spotify_id) ||
      isPreviewUrl(filePath)
    ) {
      return null;
    }

    const driveFileId = track.drive_file_id || extractDriveFileId(filePath);
    if (driveFileId) {
      return extractDriveStreamWithExt(track, driveFileId, deps.buildDriveStreamUrl);
    }

    let rawUrl: string | null = null;
    if (filePath.startsWith('http')) {
      rawUrl = filePath;
    } else {
      rawUrl = await deps.signStoragePath(filePath);
    }

    if (
      rawUrl &&
      rawUrl.startsWith('http://') &&
      !rawUrl.startsWith('http://localhost') &&
      !rawUrl.startsWith('http://127.0.0.1')
    ) {
      rawUrl = rawUrl.replace(/^http:\/\//i, 'https://');
    }

    return rawUrl;
  };

  const getAudioUrlCached = async (
    track: Track,
    bypassCache = false
  ): Promise<string | null> => {
    if (!track || !track.id) return null;
    if (
      (track.audio_url && isPreviewUrl(track.audio_url)) ||
      (track.file_path && isPreviewUrl(track.file_path)) ||
      track.source === 'spotify' ||
      track.source === 'itunes'
    ) {
      return null;
    }

    const isNct = track.source === 'nhaccuatui';
    const isYouTube = Boolean(track.source === 'youtube' || track.youtube_id);
    const isSoundCloud = isSoundCloudTrack(track);

    if (!bypassCache) {
      if (!isSoundCloud && !isNct && !isYouTube) {
        const persisted = deps.loadPersistedUrl(track.id);
        if (persisted?.url) {
          return persisted.url;
        }
      }

      if (isNct && track.nhaccuatui_id) {
        const cachedNctUrl = deps.getCachedNctUrl(track.nhaccuatui_id);
        if (cachedNctUrl) return cachedNctUrl;
      }

      const cacheTtl = getAudioUrlCacheTtl(track);
      const cached = getBoundedRefreshed(
        audioUrlCache,
        track.id,
        (entry) => deps.clock.now() - entry.ts >= cacheTtl
      );
      if (cached) {
        return cached.url;
      }
    }

    if (isNct && !track.nhaccuatui_id) return null;

    const url = await getAudioUrl(track, bypassCache);
    if (url && !isPreviewUrl(url)) {
      if (!isSoundCloud && !isNct && !isYouTube) {
        deps.savePersistedUrl(track.id, url, {
          youtube_id: track.youtube_id,
        });
      }
      setBounded(
        audioUrlCache,
        track.id,
        { url, ts: deps.clock.now() },
        AUDIO_URL_MAX_ENTRIES
      );
    }
    return url;
  };

  const resolveEmergencyCatalogSearch = async (
    track: Track,
    signal?: AbortSignal
  ): Promise<ResolvedStreamResult | null> => {
    try {
      const cleanTitleOnly = stripNonIdentityAnnotations(track.title) || track.title.trim();
      const cleanArtistOnly = (track.artist || '')
        .replace(/[\(\[\{].*?[\)\]\}]/g, '')
        .replace(/\s*feat(\.|\s).*$/i, '')
        .trim();
      const cleanQ = `${cleanTitleOnly || track.title} ${cleanArtistOnly || track.artist || ''}`.trim();
      const fbData = await deps.search(cleanQ, 'all', signal);

      const nctCandidates: Track[] = (fbData.nhaccuatui || []).filter((t: Track) =>
        Boolean(t?.nhaccuatui_id)
      );
      const nctMatchedItem = findBestNhacCuaTuiMatch(
        nctCandidates.map((t) => ({
          id: t.nhaccuatui_id!,
          title: t.title,
          artist: t.artist || '',
          duration: t.duration,
          thumbnail: t.cover_url || undefined,
        })),
        {
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          album: track.album,
        }
      );
      const nctMatch = nctMatchedItem
        ? nctCandidates.find((t) => t.nhaccuatui_id === nctMatchedItem.id)
        : undefined;

      const ytCandidates: Track[] = [
        ...(fbData.youtube || []),
        ...(fbData.spotify || []).filter((s: Track) => Boolean(s?.youtube_id)),
      ];
      const ytMatch = findBestYouTubeMatch(
        ytCandidates,
        track.title,
        track.artist,
        track.duration,
        track.album
      );

      const scCandidates: Track[] = fbData.soundcloud || [];
      const scMatch = findBestSoundCloudMatch(scCandidates, {
        title: track.title,
        artist: track.artist,
        duration: track.duration,
      });

      if (nctMatch?.nhaccuatui_id) {
        return {
          source: 'nhaccuatui',
          id: nctMatch.nhaccuatui_id,
          title: nctMatch.title,
          artist: nctMatch.artist || undefined,
          duration: nctMatch.duration,
          coverUrl: nctMatch.cover_url,
        };
      }
      if (scMatch?.soundcloud_id || scMatch?.id) {
        const scId = scMatch.soundcloud_id
          ? String(scMatch.soundcloud_id)
          : scMatch.id.replace(/^sc-/, '');
        return {
          source: 'soundcloud',
          id: scId,
          title: scMatch.title,
          artist: scMatch.artist || undefined,
          duration: scMatch.duration,
          coverUrl: scMatch.cover_url,
        };
      }
      if (ytMatch?.youtube_id) {
        return {
          source: 'youtube',
          id: ytMatch.youtube_id,
          title: ytMatch.title,
          artist: ytMatch.artist || undefined,
          duration: ytMatch.duration,
          coverUrl: ytMatch.cover_url,
        };
      }
    } catch (err) {
      if (!isAbortError(err)) {
        console.warn('Emergency search fallback error:', err);
      }
    }
    return null;
  };

  const resolveImmediate = (req: SourceRequest): PreparedPlayback | null => {
    if (disposed || !req.track) return null;
    const rawTrack = req.track;
    const cachedRes = getBoundedRefreshed(
      trackResolutionCache,
      rawTrack.id,
      (entry) => deps.clock.now() >= entry.expiresAt
    );
    const track = { ...inferTrackSource(cachedRes?.activeTrack || rawTrack) };
    const isIOS = deps.isIOS();
    const classification = classifyTrack(track, isIOS);

    if (classification.needsCatalogResolution && !classification.isDirectPlayable) {
      return null;
    }

    if (classification.engine === 'youtube') {
      if (req.preserveGesture) return null;
      const ytId =
        track.youtube_id || extractYouTubeVideoId(track.file_path || '');
      if (!ytId) return null;
      return {
        track,
        engine: 'youtube',
        target: ytId,
        initialTime: req.initialTime ?? 0,
      };
    }

    let cached = readFreshAudioUrl(audioUrlCache, track, deps.clock.now()) || undefined;
    if (!cached && track.source === 'nhaccuatui' && track.nhaccuatui_id) {
      cached =
        deps.getCachedNctUrl(track.nhaccuatui_id) ||
        deps.getNctStreamUrl(track) ||
        undefined;
    }
    if (!cached) {
      const driveFileId =
        track.drive_file_id || extractDriveFileId(track.file_path || '');
      if (driveFileId && (track.source === 'local' || !track.source)) {
        cached = extractDriveStreamWithExt(track, driveFileId, deps.buildDriveStreamUrl);
      } else if (isIOS && (track.source === 'youtube' || Boolean(track.youtube_id))) {
        const ytId =
          track.youtube_id || extractYouTubeVideoId(track.file_path || '');
        if (ytId) {
          cached = deps.buildYouTubeStreamUrl(ytId);
        }
      } else if (
        (isIOS || Boolean(req.tabHidden)) &&
        isSoundCloudTrack(track)
      ) {
        const scTarget = extractSoundCloudTarget(track);
        if (scTarget) {
          cached = deps.getDeterministicSoundCloudUrl
            ? deps.getDeterministicSoundCloudUrl(scTarget)
            : `/api/soundcloud/stream?id=${encodeURIComponent(scTarget)}`;
        }
      } else if (
        track.audio_url &&
        track.audio_url.startsWith('http') &&
        !isPreviewUrl(track.audio_url)
      ) {
        cached = track.audio_url;
      } else if (
        track.file_path &&
        track.file_path.startsWith('http') &&
        !isPreviewUrl(track.file_path) &&
        track.source !== 'spotify' &&
        track.source !== 'itunes'
      ) {
        cached = track.file_path;
      }
    }

    if (!cached || isPreviewUrl(cached)) return null;
    setBounded(
      audioUrlCache,
      track.id,
      { url: cached, ts: deps.clock.now() },
      AUDIO_URL_MAX_ENTRIES
    );

    return {
      track,
      engine: 'html5',
      target: cached,
      initialTime: req.initialTime ?? 0,
    };
  };

  const resolvePlayable = async (req: SourceRequest): Promise<PreparedPlayback | null> => {
    if (disposed || !req.track) return null;
    const track = { ...inferTrackSource(req.track) };
    const initialTime = req.initialTime ?? 0;
    const isIOS = deps.isIOS();
    let activeTrack = track;
    const classification = classifyTrack(track, isIOS);
    const shouldResolveCatalog = classification.needsCatalogResolution;

    const cachedResolution =
      shouldResolveCatalog && !req.bypassCache
        ? getBoundedRefreshed(
            trackResolutionCache,
            track.id,
            (entry) => deps.clock.now() >= entry.expiresAt
          )
        : undefined;

    if (cachedResolution) {
      activeTrack = cachedResolution.activeTrack;
      rememberIdentity(track);
      audioUrlCache.delete(track.id);
    } else if (shouldResolveCatalog) {
      rememberIdentity(track);
      let streamResult = await deps.resolution.resolve({
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        album: track.album,
      });

      if (!streamResult) {
        streamResult = await resolveEmergencyCatalogSearch(track, req.signal);
      }

      if (streamResult) {
        audioUrlCache.delete(track.id);
        activeTrack = applyResolvedStreamToTrack(track, streamResult);
        if (streamResult.streamUrl && streamResult.source !== 'youtube') {
          setBounded(
            audioUrlCache,
            activeTrack.id,
            { url: streamResult.streamUrl, ts: deps.clock.now() },
            AUDIO_URL_MAX_ENTRIES
          );
        }
        setBounded(
          trackResolutionCache,
          track.id,
          {
            activeTrack,
            expiresAt: deps.clock.now() + TRACK_RESOLUTION_TTL_MS,
          },
          TRACK_RESOLUTION_MAX_ENTRIES
        );
      } else {
        audioUrlCache.delete(track.id);
        activeTrack = {
          ...track,
          audio_url: undefined,
          file_path: '',
        };
      }
    }

    const isNonIosYouTube =
      (activeTrack.source === 'youtube' || Boolean(activeTrack.youtube_id)) &&
      !isIOS;

    let url: string | null =
      isNonIosYouTube || req.bypassCache
        ? null
        : readFreshAudioUrl(audioUrlCache, activeTrack, deps.clock.now());

    if (!url) {
      const driveFileId =
        activeTrack.drive_file_id || extractDriveFileId(activeTrack.file_path || '');
      if (driveFileId && (activeTrack.source === 'local' || !activeTrack.source)) {
        url = extractDriveStreamWithExt(
          activeTrack,
          driveFileId,
          deps.buildDriveStreamUrl
        );
        setBounded(
          audioUrlCache,
          activeTrack.id,
          { url, ts: deps.clock.now() },
          AUDIO_URL_MAX_ENTRIES
        );
      } else if (!isNonIosYouTube) {
        try {
          url = await getAudioUrlCached(activeTrack, req.bypassCache);
        } catch {
          url = null;
        }
      }
    }

    if (url) {
      return {
        track: activeTrack,
        engine: 'html5',
        target: url,
        initialTime,
      };
    }

    const ytId =
      activeTrack.youtube_id ||
      (activeTrack.source === 'youtube'
        ? extractYouTubeVideoId(activeTrack.file_path || '')
        : null);
    if (ytId) {
      return {
        track: activeTrack,
        engine: 'youtube',
        target: ytId,
        initialTime,
      };
    }

    return null;
  };

  const resolveFallback = async (
    track: Track,
    currentTime: number,
    preSearched?: Track | null,
    options?: { preferHtml5?: boolean }
  ): Promise<PreparedPlayback | null> => {
    if (disposed || !track) return null;

    const resolveFallbackResumeTime = (candidateDur?: number | null): number => {
      if (currentTime < 3) return 0;
      const targetDur = track.duration || 0;
      const candDur = candidateDur || 0;
      if (targetDur > 0 && candDur > 0 && Math.abs(candDur - targetDur) > 8) {
        return 0;
      }
      if (candDur > 0 && currentTime >= candDur - 2) {
        return 0;
      }
      return Math.floor(currentTime);
    };

    let bestMatch = preSearched ?? null;

    if (!bestMatch && !options?.preferHtml5 && pendingYoutubeFallbackByTrackId.has(track.id)) {
      bestMatch = pendingYoutubeFallbackByTrackId.get(track.id) ?? null;
      pendingYoutubeFallbackByTrackId.delete(track.id);
    }

    const cachedYtId = !bestMatch
      ? deps.getCachedYouTubeId(
          track.title,
          track.artist,
          track.album,
          track.duration
        )
      : null;

    if (!bestMatch && !options?.preferHtml5 && cachedYtId && cachedYtId !== track.youtube_id) {
      bestMatch = {
        ...track,
        youtube_id: cachedYtId,
        source: 'youtube',
        duration: track.duration || 0,
      };
    }

    if (!bestMatch) {
      try {
        const query = `${track.title} ${track.artist || ''}`.trim();
        const fallbackSource =
          !options?.preferHtml5 &&
          (track.source === 'nhaccuatui' ||
            Boolean(track.nhaccuatui_id) ||
            track.source === 'soundcloud' ||
            Boolean(track.soundcloud_id))
            ? 'youtube'
            : 'all';
        const data = await deps.search(query, fallbackSource);

        const ytList: Track[] = (data.youtube || []).filter(
          (t: Track) => t.youtube_id && (options?.preferHtml5 || t.youtube_id !== track.youtube_id)
        );
        const searchedYtMatch = findBestYouTubeMatch(
          ytList,
          track.title,
          track.artist,
          track.duration,
          track.album
        );

        const nctAlternates: Track[] = (data.nhaccuatui || []).filter(
          (t: Track) => t.nhaccuatui_id && t.nhaccuatui_id !== track.nhaccuatui_id
        );
        const nctMatchedItem = findBestNhacCuaTuiMatch(
          nctAlternates.map((t) => ({
            id: t.nhaccuatui_id!,
            title: t.title,
            artist: t.artist || '',
            duration: t.duration,
            thumbnail: t.cover_url || undefined,
          })),
          {
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            album: track.album,
          }
        );
        const nctCandidate = nctMatchedItem
          ? nctAlternates.find((t) => t.nhaccuatui_id === nctMatchedItem.id)
          : undefined;

        if (nctCandidate?.nhaccuatui_id) {
          if (searchedYtMatch?.youtube_id) {
            setBounded(
              pendingYoutubeFallbackByTrackId,
              track.id,
              searchedYtMatch,
              TRACK_RESOLUTION_MAX_ENTRIES
            );
          }
          const fallbackUrl = `/api/nhaccuatui/stream?id=${encodeURIComponent(
            nctCandidate.nhaccuatui_id
          )}`;
          const updatedTrack: Track = {
            ...track,
            source: 'nhaccuatui',
            nhaccuatui_id: nctCandidate.nhaccuatui_id,
            soundcloud_id: undefined,
            youtube_id: undefined,
          };
          return {
            track: updatedTrack,
            engine: 'html5',
            target: fallbackUrl,
            initialTime: resolveFallbackResumeTime(nctCandidate.duration),
          };
        }

        const currentScId = track.soundcloud_id ? String(track.soundcloud_id) : '';
        const scAlternates: Track[] = (data.soundcloud || []).filter((t: Track) => {
          const id = t.soundcloud_id ? String(t.soundcloud_id) : t.id?.replace(/^sc-/, '');
          return Boolean(id && id !== currentScId);
        });
        const scCandidate = findBestSoundCloudMatch(scAlternates, {
          title: track.title,
          artist: track.artist,
          duration: track.duration,
        });
        if (scCandidate && (scCandidate.soundcloud_id || scCandidate.id)) {
          if (searchedYtMatch?.youtube_id) {
            setBounded(
              pendingYoutubeFallbackByTrackId,
              track.id,
              searchedYtMatch,
              TRACK_RESOLUTION_MAX_ENTRIES
            );
          }
          const scId = scCandidate.soundcloud_id
            ? String(scCandidate.soundcloud_id)
            : scCandidate.id.replace(/^sc-/, '');
          const updatedScTrack: Track = {
            ...track,
            source: 'soundcloud',
            soundcloud_id: scId,
            nhaccuatui_id: undefined,
            youtube_id: undefined,
          };
          const scUrl =
            (await getAudioUrlCached(updatedScTrack)) ||
            (deps.getDeterministicSoundCloudUrl
              ? deps.getDeterministicSoundCloudUrl(scId)
              : `/api/soundcloud/stream?id=${encodeURIComponent(scId)}`);
          return {
            track: updatedScTrack,
            engine: 'html5',
            target: scUrl,
            initialTime: resolveFallbackResumeTime(scCandidate.duration),
          };
        }

        bestMatch = searchedYtMatch;
      } catch {
        // Search failed
      }
    }

    if (!bestMatch && options?.preferHtml5) {
      const existingYtId =
        track.youtube_id ||
        extractYouTubeVideoId(track.file_path || '') ||
        cachedYtId;
      if (existingYtId) {
        bestMatch = {
          ...track,
          youtube_id: existingYtId,
          source: 'youtube',
          duration: track.duration || 0,
        };
      }
    }

    if (!bestMatch || !bestMatch.youtube_id) {
      return null;
    }

    const candidateDuration = bestMatch.duration || 0;
    const isTargetShort = !track.duration || track.duration < 900;
    if (isTargetShort && candidateDuration > 1200) {
      return null;
    }

    const activeTrack: Track = {
      ...track,
      youtube_id: bestMatch.youtube_id,
      nhaccuatui_id: undefined,
      soundcloud_id: undefined,
      audio_url: undefined,
      file_path: '',
      source: 'youtube',
    };

    await invalidateTrack(track);
    deps.saveCachedYouTubeId(track, bestMatch.youtube_id);
    setBounded(
      trackResolutionCache,
      track.id,
      {
        activeTrack,
        expiresAt: deps.clock.now() + TRACK_RESOLUTION_TTL_MS,
      },
      TRACK_RESOLUTION_MAX_ENTRIES
    );

    const ytResumeTime = resolveFallbackResumeTime(bestMatch.duration);
    if (deps.isIOS() || options?.preferHtml5) {
      return {
        track: activeTrack,
        engine: 'html5',
        target: deps.buildYouTubeStreamUrl(bestMatch.youtube_id),
        initialTime: ytResumeTime,
      };
    }

    return {
      track: activeTrack,
      engine: 'youtube',
      target: bestMatch.youtube_id,
      initialTime: ytResumeTime,
    };
  };

  const resolveYouTubeAlternate = async (
    track: Track,
    currentTime = 0
  ): Promise<PreparedPlayback | null> => {
    if (disposed || !track) return null;
    try {
      const queryStr = `${track.title} ${track.artist || ''}`.trim();
      const searchRes = await deps.search(queryStr, 'all');

      const candidates = (searchRes?.youtube || []).filter(
        (t: Track) => t.youtube_id && t.youtube_id !== track.youtube_id
      );
      if (candidates.length > 0) {
        const fallbackMatch = findBestYouTubeMatch(
          candidates,
          track.title,
          track.artist,
          track.duration,
          track.album
        );
        if (fallbackMatch?.youtube_id) {
          const updatedTrack: Track = {
            ...track,
            source: 'youtube',
            youtube_id: fallbackMatch.youtube_id,
          };
          return {
            track: updatedTrack,
            engine: 'youtube',
            target: fallbackMatch.youtube_id,
            initialTime: currentTime >= 3 ? Math.floor(currentTime) : 0,
          };
        }
      }

      const nctAlternates: Track[] = (searchRes?.nhaccuatui || []).filter((t: Track) =>
        Boolean(t?.nhaccuatui_id)
      );
      const nctMatchedItem = findBestNhacCuaTuiMatch(
        nctAlternates.map((t) => ({
          id: t.nhaccuatui_id!,
          title: t.title,
          artist: t.artist || '',
          duration: t.duration,
          thumbnail: t.cover_url || undefined,
        })),
        {
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          album: track.album,
        }
      );
      const nctCandidate = nctMatchedItem
        ? nctAlternates.find((t) => t.nhaccuatui_id === nctMatchedItem.id)
        : undefined;
      if (nctCandidate?.nhaccuatui_id) {
        const updatedTrack: Track = {
          ...track,
          source: 'nhaccuatui',
          nhaccuatui_id: nctCandidate.nhaccuatui_id,
          youtube_id: undefined,
        };
        return {
          track: updatedTrack,
          engine: 'html5',
          target: `/api/nhaccuatui/stream?id=${encodeURIComponent(
            nctCandidate.nhaccuatui_id
          )}`,
          initialTime: 0,
        };
      }

      const scCandidates: Track[] = searchRes?.soundcloud || [];
      const scMatch = findBestSoundCloudMatch(scCandidates, {
        title: track.title,
        artist: track.artist,
        duration: track.duration,
      });
      if (scMatch && (scMatch.soundcloud_id || scMatch.id)) {
        const scId = scMatch.soundcloud_id
          ? String(scMatch.soundcloud_id)
          : scMatch.id.replace(/^sc-/, '');
        const updatedTrack: Track = {
          ...track,
          source: 'soundcloud',
          soundcloud_id: scId,
          youtube_id: undefined,
        };
        return resolvePlayable({ track: updatedTrack, initialTime: 0 });
      }
    } catch {
      // Fall through
    }
    return null;
  };

  const refreshStream = async (
    track: Track,
    initialTime: number
  ): Promise<PreparedPlayback | null> => {
    if (disposed || !track) return null;
    audioUrlCache.delete(track.id);
    const freshUrl = await getAudioUrl(track, true);
    if (!freshUrl) return null;
    setBounded(
      audioUrlCache,
      track.id,
      { url: freshUrl, ts: deps.clock.now() },
      AUDIO_URL_MAX_ENTRIES
    );
    return {
      track,
      engine: 'html5',
      target: freshUrl,
      initialTime: initialTime > 0 ? initialTime : 0,
    };
  };

  const searchYouTubeCandidate = async (track: Track): Promise<Track | null> => {
    if (disposed || !track) return null;
    try {
      const searchQuery = `${track.title} ${track.artist || ''}`.trim();
      const data = await deps.search(searchQuery, 'youtube');
      if (!data?.youtube?.length) return null;
      return findBestYouTubeMatch(
        data.youtube,
        track.title,
        track.artist,
        track.duration,
        track.album
      );
    } catch {
      return null;
    }
  };

  const invalidateTrack = async (track: Track): Promise<void> => {
    if (!track) return;
    trackResolutionCache.delete(track.id);
    audioUrlCache.delete(track.id);
    if (track.nhaccuatui_id) {
      deps.clearCachedNctUrl(track.nhaccuatui_id);
    }
    const identity = resolutionIdentities.get(track.id) ?? {
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      album: track.album,
    };
    let cancelTimer: (() => void) | undefined;
    try {
      await Promise.race([
        deps.resolution.invalidate(identity),
        new Promise<void>((resolve) => {
          cancelTimer = deps.clock.after(300, resolve);
        }),
      ]);
    } finally {
      cancelTimer?.();
    }
  };

  const prewarmNextAdaptive = (
    queue: Track[],
    currentIndex: number,
    repeatMode: 'off' | 'all' | 'one'
  ): void => {
    if (disposed || !deps.isFastConnection()) return;
    if (!queue || queue.length === 0 || currentIndex < -1) return;
    if (
      currentIndex >= queue.length - 1 &&
      !(repeatMode === 'all' && queue.length > 1)
    ) {
      return;
    }

    const targetIdx =
      currentIndex >= 0
        ? currentIndex + 1 < queue.length
          ? currentIndex + 1
          : 0
        : 0;
    const nextTr = queue[targetIdx];
    if (!nextTr || !nextTr.id) return;

    const isDrive = Boolean(
      nextTr.drive_file_id || extractDriveFileId(nextTr.file_path || '')
    );
    if (isDrive) {
      deps.triggerDrivePrewarm([nextTr]);
      if (!audioUrlCache.has(nextTr.id)) {
        void getAudioUrlCached(nextTr).catch(() => {});
      }
      return;
    }

    if (nextTr.source === 'nhaccuatui' && nextTr.nhaccuatui_id) {
      if (!deps.getCachedNctUrl(nextTr.nhaccuatui_id)) {
        void deps.prewarmNctUrl(nextTr.nhaccuatui_id).catch(() => {});
      }
      return;
    }

    const nextClass = classifyTrack(nextTr, deps.isIOS());
    if (!nextClass.needsCatalogResolution && nextClass.isDirectPlayable) {
      if (!audioUrlCache.has(nextTr.id)) {
        void getAudioUrlCached(nextTr).catch(() => {});
      }
      return;
    }

    const targetTrackId = nextTr.id;
    if (resolvingTrackIds.has(targetTrackId)) return;
    resolvingTrackIds.add(targetTrackId);

    void deps.resolution
      .resolve({
        title: nextTr.title,
        artist: nextTr.artist,
        duration: nextTr.duration,
        album: nextTr.album,
      })
      .then((resolved) => {
        if (!resolved || disposed) return;
        const mergedTrack: Track = {
          ...applyResolvedStreamToTrack(nextTr, resolved),
          audio_url: undefined,
        };
        setBounded(
          trackResolutionCache,
          targetTrackId,
          {
            activeTrack: mergedTrack,
            expiresAt: deps.clock.now() + TRACK_RESOLUTION_TTL_MS,
          },
          TRACK_RESOLUTION_MAX_ENTRIES
        );
        if (resolved.streamUrl && resolved.source !== 'youtube') {
          setBounded(
            audioUrlCache,
            targetTrackId,
            { url: resolved.streamUrl, ts: deps.clock.now() },
            AUDIO_URL_MAX_ENTRIES
          );
        } else if (resolved.source === 'nhaccuatui') {
          if (!deps.getCachedNctUrl(resolved.id)) {
            void deps.prewarmNctUrl(resolved.id).catch(() => {});
          }
          const nctUrl = deps.getNctStreamUrl(mergedTrack);
          if (nctUrl) {
            setBounded(
              audioUrlCache,
              targetTrackId,
              { url: nctUrl, ts: deps.clock.now() },
              AUDIO_URL_MAX_ENTRIES
            );
          }
        } else if (resolved.source === 'drive') {
          deps.triggerDrivePrewarm([mergedTrack]);
          if (!audioUrlCache.has(targetTrackId)) {
            void getAudioUrlCached(mergedTrack).catch(() => {});
          }
        } else if (resolved.source === 'soundcloud') {
          if (!audioUrlCache.has(targetTrackId)) {
            void getAudioUrlCached(mergedTrack).catch(() => {});
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        resolvingTrackIds.delete(targetTrackId);
      });
  };

  const prewarmUpcoming = (
    queue: Track[],
    currentIndex: number,
    repeatMode: 'off' | 'all' | 'one',
    options?: { tabHidden?: boolean }
  ): void => {
    if (disposed) return;
    const upcoming = planUpcomingPrewarm(queue, currentIndex, {
      fastConnection: deps.isFastConnection(),
    });
    if (upcoming.length > 0) {
      void deps.prewarmTrackBatch(upcoming).catch(() => {});
    }
    if (deps.isIOS() || Boolean(options?.tabHidden)) {
      prewarmNextAdaptive(queue, currentIndex, repeatMode);
    }
  };

  const prewarmNearEnd = (
    queue: Track[],
    currentIndex: number,
    repeatMode: 'off' | 'all' | 'one',
    isShuffle: boolean
  ): void => {
    if (disposed || !deps.isFastConnection()) return;
    if (isShuffle || currentIndex < 0 || queue.length <= 1) return;

    const nextIdx =
      repeatMode === 'one' ? currentIndex : (currentIndex + 1) % queue.length;
    const rawNextTr = queue[nextIdx];
    if (!rawNextTr || !rawNextTr.id) return;

    const cachedRes = getBoundedRefreshed(
      trackResolutionCache,
      rawNextTr.id,
      (entry) => deps.clock.now() >= entry.expiresAt
    );
    const nextTr = cachedRes?.activeTrack || rawNextTr;
    const nextClass = classifyTrack(nextTr, deps.isIOS());

    if (!cachedRes && nextClass.needsCatalogResolution) {
      prewarmNextAdaptive(queue, currentIndex, repeatMode);
    } else if (nextTr.source === 'nhaccuatui' && nextTr.nhaccuatui_id) {
      void deps.prewarmNctUrl(nextTr.nhaccuatui_id).catch(() => {});
    } else if (
      deps.isIOS() &&
      (nextTr.source === 'youtube' || Boolean(nextTr.youtube_id))
    ) {
      // Intentionally do not HEAD-prewarm YouTube on iOS
    } else if (!audioUrlCache.has(nextTr.id)) {
      void getAudioUrlCached(nextTr).catch(() => {});
    }
  };

  const hydrateRestoredTrack = async (
    rawTrack: Track,
    initialTime: number
  ): Promise<PreparedPlayback | null> => {
    if (disposed || !rawTrack) return null;
    const restoredTrack = inferTrackSource(rawTrack);
    if (
      restoredTrack.source === 'youtube' &&
      restoredTrack.youtube_id &&
      !deps.isIOS()
    ) {
      return {
        track: restoredTrack,
        engine: 'youtube',
        target: restoredTrack.youtube_id,
        initialTime,
      };
    }

    let playableTrack = restoredTrack;
    if (restoredTrack.source === 'nhaccuatui' && restoredTrack.nhaccuatui_id) {
      try {
        const song = await deps.resolveNctSong(restoredTrack.nhaccuatui_id);
        if (song) {
          playableTrack = {
            ...restoredTrack,
            title: song.title || restoredTrack.title,
            artist: song.artist || restoredTrack.artist,
            cover_url: restoredTrack.cover_url || song.coverUrl || null,
            duration: song.duration || restoredTrack.duration,
          };
        }
      } catch {
        // Keep restoredTrack
      }
    }

    const url = await getAudioUrlCached(playableTrack);
    if (url) {
      return {
        track: playableTrack,
        engine: 'html5',
        target: url,
        initialTime,
      };
    }

    const resolved = await resolvePlayable({
      track: playableTrack,
      initialTime,
    });
    if (
      resolved &&
      resolved.engine === 'html5' &&
      resolved.track.source === 'nhaccuatui' &&
      resolved.track.nhaccuatui_id &&
      resolved.target.startsWith('/api/nhaccuatui/stream')
    ) {
      try {
        await deps.resolveNctSong(resolved.track.nhaccuatui_id);
        const directUrl = deps.getCachedNctUrl(resolved.track.nhaccuatui_id);
        if (directUrl) {
          return {
            ...resolved,
            target: directUrl,
          };
        }
      } catch {
        // Keep proxy stream URL
      }
    }
    return resolved;
  };

  return {
    resolveImmediate,
    resolvePlayable,
    resolveFallback,
    resolveYouTubeAlternate,
    refreshStream,
    searchYouTubeCandidate,
    invalidateTrack,
    prewarmUpcoming,
    prewarmNextAdaptive,
    prewarmNearEnd,
    hydrateRestoredTrack,
    dispose() {
      disposed = true;
      audioUrlCache.clear();
      trackResolutionCache.clear();
      pendingYoutubeFallbackByTrackId.clear();
      resolutionIdentities.clear();
      resolvingTrackIds.clear();
    },
  };
}
