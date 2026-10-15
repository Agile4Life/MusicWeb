import type { Cancel, PlaybackClock, PlaybackOwner } from '@/lib/playback/ports';
import type { BrowserTransport } from '../adapters/browserTransport';
import type { YouTubeIframeEngine } from '../engines/YouTubeIframeEngine';

export interface YouTubeBindingOptions {
  clock: PlaybackClock;
  youtubeEngine: YouTubeIframeEngine;
  transport: BrowserTransport;
  getActiveOwner: () => PlaybackOwner | null;
  getVolume: () => number;
  isPlayingWanted?: () => boolean;
  win?: Window;
  doc?: Document;
}

interface YTPlayerInstance {
  playVideo?: () => void;
  destroy?: () => void;
}

interface YTWindow extends Window {
  YT?: {
    Player?: new (
      containerId: string,
      options: Record<string, unknown>
    ) => YTPlayerInstance;
  };
  onYouTubeIframeAPIReady?: () => void;
}

export function bindYouTubeIframe(options: YouTubeBindingOptions): Cancel {
  const win = (options.win ??
    (typeof window !== 'undefined' ? window : undefined)) as
    | YTWindow
    | undefined;
  const doc =
    options.doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!win || !doc) {
    return () => {};
  }

  const {
    clock,
    youtubeEngine,
    transport,
    getActiveOwner,
    getVolume,
    isPlayingWanted,
  } = options;
  let disposed = false;
  let playerInstance: YTPlayerInstance | null = null;
  let cancelPollTimer: Cancel | null = null;
  let cancelStuckWatchdog: Cancel | null = null;
  let pendingCall: {
    mode: 'play' | 'paused';
    videoId: string;
    initialTime: number;
    volume: number;
    resolve: () => void;
    reject: (err: unknown) => void;
  } | null = null;

  // Wrap loadAndPlay and loadPaused so cold-start calls before YT.Player is ready
  // queue cleanly and execute as soon as onReady fires.
  const origLoadAndPlay = youtubeEngine.loadAndPlay.bind(youtubeEngine);
  const origLoadPaused = youtubeEngine.loadPaused.bind(youtubeEngine);

  youtubeEngine.loadAndPlay = (videoId: string, initialTime = 0, volume = 0.8) => {
    if (youtubeEngine.getPlayerInstance()?.loadVideoById) {
      pendingCall = null;
      return origLoadAndPlay(videoId, initialTime, volume);
    }
    youtubeEngine.setLoadedVideoId(videoId);
    return new Promise<void>((resolve, reject) => {
      pendingCall = {
        mode: 'play',
        videoId,
        initialTime,
        volume,
        resolve,
        reject,
      };
    });
  };

  youtubeEngine.loadPaused = (videoId: string, initialTime = 0, volume = 0.8) => {
    if (youtubeEngine.getPlayerInstance()?.cueVideoById) {
      pendingCall = null;
      origLoadPaused(videoId, initialTime, volume);
      return;
    }
    youtubeEngine.setLoadedVideoId(videoId);
    pendingCall = {
      mode: 'paused',
      videoId,
      initialTime,
      volume,
      resolve: () => {},
      reject: () => {},
    };
  };

  const clearStuckWatchdog = () => {
    if (cancelStuckWatchdog) {
      cancelStuckWatchdog();
      cancelStuckWatchdog = null;
    }
  };

  const stopPollTimer = () => {
    if (cancelPollTimer) {
      cancelPollTimer();
      cancelPollTimer = null;
    }
  };

  const startPollTimer = () => {
    if (cancelPollTimer) return;
    cancelPollTimer = clock.every(250, () => {
      if (disposed) return;
      const owner = getActiveOwner();
      if (!owner) return;
      const time = youtubeEngine.getCurrentTime();
      const duration = youtubeEngine.getDuration();
      transport.handleYouTubeEvent({
        type: 'time',
        owner,
        time,
        duration,
      });
    });
  };

  const armStuckWatchdog = (expectedOwner: PlaybackOwner) => {
    clearStuckWatchdog();
    if (isPlayingWanted && !isPlayingWanted()) return;
    cancelStuckWatchdog = clock.after(1500, () => {
      cancelStuckWatchdog = null;
      if (disposed) return;
      if (isPlayingWanted && !isPlayingWanted()) return;
      const curOwner = getActiveOwner();
      if (
        !curOwner ||
        curOwner.requestId !== expectedOwner.requestId ||
        curOwner.trackId !== expectedOwner.trackId
      ) {
        return;
      }
      try {
        playerInstance?.playVideo?.();
      } catch {
        // Ignore
      }
    });
  };

  const initYouTubePlayer = () => {
    if (disposed || playerInstance || !win.YT?.Player) return;
    const container = doc.getElementById('yt-player-container');
    if (!container) return;

    try {
      playerInstance = new win.YT.Player('yt-player-container', {
        height: '1',
        width: '1',
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          playsinline: 1,
          enablejsapi: 1,
          rel: 0,
          origin: win.location?.origin ?? 'http://localhost',
        },
        events: {
          onReady: () => {
            if (disposed) return;
            youtubeEngine.setPlayerInstance(playerInstance);
            youtubeEngine.ensureUnmuted(getVolume());

            if (pendingCall) {
              const call = pendingCall;
              pendingCall = null;
              try {
                if (call.mode === 'play') {
                  void origLoadAndPlay(
                    call.videoId,
                    call.initialTime,
                    call.volume
                  ).then(call.resolve, call.reject);
                } else {
                  origLoadPaused(call.videoId, call.initialTime, call.volume);
                  call.resolve();
                }
              } catch (err) {
                call.reject(err);
              }
            }
          },
          onStateChange: (event: { data: number }) => {
            if (disposed) return;
            const owner = getActiveOwner();
            if (!owner) return;

            if (event.data === 1) {
              clearStuckWatchdog();
              youtubeEngine.ensureUnmuted(getVolume());
              startPollTimer();
              transport.handleYouTubeEvent({
                type: 'buffering',
                owner,
                value: false,
              });
              transport.handleYouTubeEvent({
                type: 'playing',
                owner,
              });
              const dur = youtubeEngine.getDuration();
              if (dur > 0) {
                transport.handleYouTubeEvent({
                  type: 'time',
                  owner,
                  time: youtubeEngine.getCurrentTime(),
                  duration: dur,
                });
              }
            } else if (event.data === 3) {
              transport.handleYouTubeEvent({
                type: 'buffering',
                owner,
                value: true,
              });
              armStuckWatchdog(owner);
            } else if (event.data === 2) {
              clearStuckWatchdog();
              stopPollTimer();
              transport.handleYouTubeEvent({
                type: 'buffering',
                owner,
                value: false,
              });
              transport.handleYouTubeEvent({
                type: 'paused',
                owner,
              });
            } else if (event.data === 0) {
              clearStuckWatchdog();
              stopPollTimer();
              transport.handleYouTubeEvent({
                type: 'ended',
                owner,
              });
            } else if (event.data === -1 || event.data === 5) {
              armStuckWatchdog(owner);
            }
          },
          onError: (event: { data?: number }) => {
            if (disposed) return;
            clearStuckWatchdog();
            stopPollTimer();
            const owner = getActiveOwner();
            if (!owner) return;
            transport.handleYouTubeEvent({
              type: 'error',
              owner,
              error: event?.data,
            });
          },
        },
      });
    } catch (err) {
      console.warn('YT Player init exception:', err);
    }
  };

  if (!win.YT) {
    const existingScript = doc.querySelector?.(
      'script[src="https://www.youtube.com/iframe_api"]'
    );
    if (!existingScript && doc.createElement) {
      const tag = doc.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = doc.getElementsByTagName?.('script')?.[0];
      if (firstScriptTag?.parentNode) {
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
      } else {
        doc.head?.appendChild(tag);
      }
    }
    const prevReady = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      if (typeof prevReady === 'function') prevReady();
      initYouTubePlayer();
    };
  } else {
    initYouTubePlayer();
  }

  return () => {
    disposed = true;
    pendingCall = null;
    clearStuckWatchdog();
    stopPollTimer();
    youtubeEngine.loadAndPlay = origLoadAndPlay;
    youtubeEngine.loadPaused = origLoadPaused;
    try {
      playerInstance?.destroy?.();
    } catch {
      // Ignore destroy errors
    }
    playerInstance = null;
    youtubeEngine.setPlayerInstance(null);
  };
}
