import type { PlaybackController } from '@/lib/playback/controllerTypes';
import type { Cancel, PlaybackClock } from '@/lib/playback/ports';

export interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(
    action: string,
    handler: (() => void) | null
  ): void;
  setPositionState?(state: {
    duration: number;
    playbackRate: number;
    position: number;
  }): void;
}

export interface MediaSessionBindingOptions {
  clock: PlaybackClock;
  mediaSession?: MediaSessionLike | null;
  origin?: string;
  createMetadata?: (init: {
    title: string;
    artist: string;
    album: string;
    artwork: Array<{ src: string; sizes: string; type: string }>;
  }) => unknown;
}

export function bindMediaSession(
  controller: PlaybackController,
  options: MediaSessionBindingOptions
): Cancel {
  const mediaSession =
    options.mediaSession !== undefined
      ? options.mediaSession
      : typeof navigator !== 'undefined' && 'mediaSession' in navigator
        ? (navigator.mediaSession as unknown as MediaSessionLike)
        : null;

  if (!mediaSession) {
    return () => {};
  }

  const origin =
    options.origin ??
    (typeof window !== 'undefined' ? window.location.origin : '');
  const createMetadata =
    options.createMetadata ??
    ((init) =>
      typeof MediaMetadata !== 'undefined' ? new MediaMetadata(init) : init);

  let lastTrackKey = '';
  let lastTrackId: string | null = null;
  let cancelPositionTimer: Cancel | null = null;

  const stopPositionTimer = () => {
    if (cancelPositionTimer) {
      cancelPositionTimer();
      cancelPositionTimer = null;
    }
  };

  const registerActionHandlers = () => {
    try {
      mediaSession.setActionHandler('play', () => {
        const snap = controller.getSnapshot();
        if (!snap.isPlaying) {
          void controller.togglePlay();
        }
      });
      mediaSession.setActionHandler('pause', () => {
        const snap = controller.getSnapshot();
        if (snap.isPlaying || snap.isBuffering) {
          void controller.togglePlay();
        }
      });
      mediaSession.setActionHandler('previoustrack', () => {
        controller.prevTrack();
      });
      mediaSession.setActionHandler('nexttrack', () => {
        controller.nextTrack();
      });

      // Deliberately set seek handlers to null so Android Chrome displays
      // Previous/Next buttons in the lock-screen media notification.
      try {
        mediaSession.setActionHandler('seekbackward', null);
        mediaSession.setActionHandler('seekforward', null);
        mediaSession.setActionHandler('seekto', null);
      } catch {
        // Ignore unsupported seek handler clearing
      }

      try {
        mediaSession.setActionHandler('stop', () => {
          const snap = controller.getSnapshot();
          if (snap.isPlaying || snap.isBuffering) {
            void controller.togglePlay();
          }
        });
      } catch {
        // Ignore unsupported stop action
      }
    } catch (err) {
      console.warn('MediaSession init error:', err);
    }
  };

  const sync = () => {
    const snap = controller.getSnapshot();
    const track = snap.currentTrack;

    if (!track) {
      stopPositionTimer();
      return;
    }

    const trackKey = `${track.id}|${track.title}|${track.artist ?? ''}|${
      track.album ?? ''
    }|${track.cover_url ?? ''}`;
    if (trackKey !== lastTrackKey) {
      lastTrackKey = trackKey;
      try {
        const rawCover = track.cover_url || '';
        const coverSrc = rawCover
          ? rawCover.startsWith('http')
            ? rawCover
            : `${origin}${rawCover}`
          : `${origin}/favicon.ico`;

        mediaSession.metadata = createMetadata({
          title: track.title,
          artist: track.artist || 'Nghệ sĩ chưa xác định',
          album: track.album || 'MusicWeb Studio',
          artwork: [
            { src: coverSrc, sizes: '96x96', type: 'image/png' },
            { src: coverSrc, sizes: '128x128', type: 'image/png' },
            { src: coverSrc, sizes: '192x192', type: 'image/png' },
            { src: coverSrc, sizes: '256x256', type: 'image/png' },
            { src: coverSrc, sizes: '384x384', type: 'image/png' },
            { src: coverSrc, sizes: '512x512', type: 'image/png' },
          ],
        });
      } catch (err) {
        console.warn('MediaSession metadata update error:', err);
      }
    }

    if (track.id !== lastTrackId) {
      lastTrackId = track.id;
      registerActionHandlers();
    }

    try {
      const shouldReportPlaying = snap.isPlaying || snap.isBuffering;
      mediaSession.playbackState = shouldReportPlaying ? 'playing' : 'paused';
    } catch {
      // Ignore playbackState errors
    }

    const syncPositionState = () => {
      try {
        const prog = controller.getProgress();
        const curSnap = controller.getSnapshot();
        const d =
          prog.duration > 0
            ? prog.duration
            : curSnap.currentTrack?.duration || 0;
        const t = prog.currentTime;
        if (d > 0 && t >= 0 && Number.isFinite(d) && Number.isFinite(t)) {
          mediaSession.setPositionState?.({
            duration: Math.max(d, 0),
            playbackRate: 1,
            position: Math.min(Math.max(t, 0), d),
          });
        }
      } catch {
        // Ignore position state errors
      }
    };

    if (snap.isPlaying && typeof mediaSession.setPositionState === 'function') {
      syncPositionState();
      if (!cancelPositionTimer) {
        cancelPositionTimer = options.clock.every(1000, syncPositionState);
      }
    } else {
      stopPositionTimer();
    }
  };

  sync();
  const unsubscribe = controller.subscribe(sync);

  return () => {
    unsubscribe();
    stopPositionTimer();
    for (const action of [
      'play',
      'pause',
      'previoustrack',
      'nexttrack',
      'seekbackward',
      'seekforward',
      'seekto',
      'stop',
    ]) {
      try {
        mediaSession.setActionHandler(action, null);
      } catch {
        // Ignore
      }
    }
  };
}
