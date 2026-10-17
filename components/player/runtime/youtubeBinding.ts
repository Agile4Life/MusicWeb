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
    owner: PlaybackOwner | null;
    videoId: string;
    initialTime: number;
    volume: number;
    resolve: () => void;
    reject: (err: unknown) => void;
  } | null = null;

  const abortedError = () =>
    Object.assign(new Error('Playback ownership changed'), { name: 'AbortError' });

  const isSameOwner = (
    a: PlaybackOwner | null | undefined,
    b: PlaybackOwner | null | undefined
  ): boolean => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
      a.requestId === b.requestId &&
      a.generation === b.generation &&
      a.trackId === b.trackId
    );
  };

  const cancelPendingCall = () => {
    if (!pendingCall) return;
    const prev = pendingCall;
    pendingCall = null;
    if (prev.mode === 'play') {
      prev.reject(abortedError());
    }
  };

  // Wrap loadAndPlay, loadPaused, pause, and stop so cold-start calls before YT.Player is ready
  // queue with ownership and are invalidated on switch/pause/stop.
  const origLoadAndPlay = youtubeEngine.loadAndPlay.bind(youtubeEngine);
  const origLoadPaused = youtubeEngine.loadPaused.bind(youtubeEngine);
  const origResume = youtubeEngine.resume.bind(youtubeEngine);
  const origSeek = youtubeEngine.seek.bind(youtubeEngine);
  const origSetVolume = youtubeEngine.setVolume.bind(youtubeEngine);
  const origPause = youtubeEngine.pause.bind(youtubeEngine);
  const origStop = youtubeEngine.stop.bind(youtubeEngine);

  youtubeEngine.loadAndPlay = (videoId: string, initialTime = 0, volume = 0.8) => {
    cancelPendingCall();
    if (youtubeEngine.getPlayerInstance()?.loadVideoById) {
      return origLoadAndPlay(videoId, initialTime, volume);
    }
    const currentOwner = getActiveOwner();
    const capturedOwner = currentOwner ? { ...currentOwner } : null;
    youtubeEngine.setLoadedVideoId(videoId);
    return new Promise<void>((resolve, reject) => {
      pendingCall = {
        mode: 'play',
        owner: capturedOwner,
        videoId,
        initialTime,
        volume,
        resolve,
        reject,
      };
    });
  };

  youtubeEngine.loadPaused = (videoId: string, initialTime = 0, volume = 0.8) => {
    cancelPendingCall();
    if (youtubeEngine.getPlayerInstance()?.cueVideoById) {
      origLoadPaused(videoId, initialTime, volume);
      return;
    }
    const currentOwner = getActiveOwner();
    const capturedOwner = currentOwner ? { ...currentOwner } : null;
    youtubeEngine.setLoadedVideoId(videoId);
    pendingCall = {
      mode: 'paused',
      owner: capturedOwner,
      videoId,
      initialTime,
      volume,
      resolve: () => {},
      reject: () => {},
    };
  };

  youtubeEngine.resume = () => {
    if (pendingCall && !youtubeEngine.getPlayerInstance()?.playVideo) {
      const prev = pendingCall;
      return new Promise<void>((resolve, reject) => {
        pendingCall = {
          ...prev,
          mode: 'play',
          resolve,
          reject,
        };
      });
    }
    return origResume();
  };

  youtubeEngine.seek = (time: number) => {
    if (pendingCall && !youtubeEngine.getPlayerInstance()?.seekTo) {
      pendingCall.initialTime = time;
      return;
    }
    origSeek(time);
  };

  youtubeEngine.setVolume = (volume: number) => {
    if (pendingCall && !youtubeEngine.getPlayerInstance()?.setVolume) {
      pendingCall.volume = volume;
      return;
    }
    origSetVolume(volume);
  };

  youtubeEngine.pause = () => {
    cancelPendingCall();
    clearStuckWatchdog();
    stopPollTimer();
    origPause();
  };

  youtubeEngine.stop = () => {
    cancelPendingCall();
    clearStuckWatchdog();
    stopPollTimer();
    youtubeEngine.setLoadedVideoId(null);
    origStop();
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
      const loadedVideoId = youtubeEngine.getLoadedVideoId();
      if (!owner || !loadedVideoId) return;
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

  const armStuckWatchdog = (
    expectedOwner: PlaybackOwner,
    expectedVideoId: string
  ) => {
    clearStuckWatchdog();
    if (!expectedVideoId) return;
    if (isPlayingWanted && !isPlayingWanted()) return;
    cancelStuckWatchdog = clock.after(1500, () => {
      cancelStuckWatchdog = null;
      if (disposed) return;
      if (isPlayingWanted && !isPlayingWanted()) return;
      const curOwner = getActiveOwner();
      if (
        !curOwner ||
        !isSameOwner(curOwner, expectedOwner) ||
        youtubeEngine.getLoadedVideoId() !== expectedVideoId ||
        !youtubeEngine.matchesVideo(expectedVideoId)
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
              if (
                !isSameOwner(call.owner, getActiveOwner()) ||
                youtubeEngine.getLoadedVideoId() !== call.videoId
              ) {
                if (call.mode === 'play') {
                  call.reject(abortedError());
                }
                return;
              }
              try {
                if (call.mode === 'play' && (!isPlayingWanted || isPlayingWanted())) {
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
            const loadedVideoId = youtubeEngine.getLoadedVideoId();
            if (
              !owner ||
              !loadedVideoId ||
              !youtubeEngine.matchesVideo(loadedVideoId)
            ) {
              clearStuckWatchdog();
              stopPollTimer();
              if (event.data === 1) {
                origStop();
              }
              return;
            }

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
              armStuckWatchdog(owner, loadedVideoId);
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
              armStuckWatchdog(owner, loadedVideoId);
            }
          },
          onError: (event: { data?: number }) => {
            if (disposed) return;
            clearStuckWatchdog();
            stopPollTimer();
            const owner = getActiveOwner();
            const loadedVideoId = youtubeEngine.getLoadedVideoId();
            if (!owner || !loadedVideoId) return;
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
    cancelPendingCall();
    clearStuckWatchdog();
    stopPollTimer();
    youtubeEngine.loadAndPlay = origLoadAndPlay;
    youtubeEngine.loadPaused = origLoadPaused;
    youtubeEngine.pause = origPause;
    youtubeEngine.stop = origStop;
    try {
      playerInstance?.destroy?.();
    } catch {
      // Ignore destroy errors
    }
    playerInstance = null;
    youtubeEngine.setPlayerInstance(null);
  };
}
