import type { Track } from '@/types';
import { getValidUserId } from '@/lib/accessControl';
import type { PlaybackController } from '@/lib/playback/controllerTypes';
import { createPlaybackController } from '@/lib/playback/playbackController';
import { createPlaybackSourceService } from '@/lib/playback/playbackSourceService';
import type { Cancel, PlaybackClock, PlaybackOwner } from '@/lib/playback/ports';
import { getSmartRecommendedTracks } from '@/lib/smartRecommend';
import { getMusicOfftopicSegments, calculateIntroOffset } from '@/lib/sponsorblock';
import { createClient } from '@/lib/supabase/client';
import { resolveExternalTrackId } from '@/lib/trackPersistence';
import { extractYouTubeVideoId, fetchViewCountForVideo } from '@/lib/youtube';
import { createBrowserPersistence } from '../adapters/browserPersistence';
import { createBrowserSourceDependencies } from '../adapters/browserSourceDependencies';
import {
  type BrowserTransport,
  createBrowserTransport,
} from '../adapters/browserTransport';
import { createBrowserUserEffects } from '../adapters/browserUserEffects';
import { Html5AudioEngine, YouTubeIframeEngine } from '../engines';
import { bindBrowserLifecycle } from './browserLifecycle';
import { bindMediaSession } from './mediaSessionBinding';
import { bindYouTubeIframe } from './youtubeBinding';

export function createBrowserClock(): PlaybackClock {
  return {
    now: () => Date.now(),
    after: (ms, callback) => {
      const id = setTimeout(callback, ms);
      return () => clearTimeout(id);
    },
    every: (ms, callback) => {
      const id = setInterval(callback, ms);
      return () => clearInterval(id);
    },
  };
}

export interface PlayerRuntime {
  controller: PlaybackController;
  attachAudioElement(audio: HTMLAudioElement | null): Cancel;
  setActiveUserEmail(email: string | null | undefined): void;
  dispose(): void;
}

export interface WebAudioGainManagerOptions {
  getAudioElement: () => HTMLAudioElement | null;
  isPlaying: () => boolean;
  getAudioContextClass?: () => (new () => AudioContext) | undefined;
}

export function createWebAudioGainManager(options: WebAudioGainManagerOptions) {
  let audioContext: AudioContext | null = null;
  let gainNode: GainNode | null = null;
  let connectedAudioElement: HTMLAudioElement | null = null;

  return {
    ensureGain(volume: number) {
      const currentAudioElement = options.getAudioElement();
      if (!currentAudioElement) return;

      try {
        if (!audioContext) {
          const AudioCtxClass =
            options.getAudioContextClass?.() ??
            (typeof window !== 'undefined'
              ? window.AudioContext ||
                (
                  window as unknown as {
                    webkitAudioContext?: new () => AudioContext;
                  }
                ).webkitAudioContext
              : undefined);
          if (!AudioCtxClass) return;
          const createdCtx: AudioContext = new AudioCtxClass();
          try {
            createdCtx.onstatechange = () => {
              const st = createdCtx.state as string;
              if (
                options.isPlaying() &&
                (st === 'suspended' || st === 'interrupted')
              ) {
                createdCtx.resume().catch(() => {});
              }
            };
          } catch {
            // Ignore
          }
          audioContext = createdCtx;
        }

        if (
          audioContext &&
          (audioContext.state === 'suspended' ||
            (audioContext.state as string) === 'interrupted')
        ) {
          audioContext.resume().catch(() => {});
        }

        if (!gainNode && audioContext) {
          gainNode = audioContext.createGain();
          gainNode.gain.value = volume;
        }

        if (
          audioContext &&
          gainNode &&
          connectedAudioElement !== currentAudioElement
        ) {
          try {
            const source =
              audioContext.createMediaElementSource(currentAudioElement);
            source.connect(gainNode);
            gainNode.connect(audioContext.destination);
            connectedAudioElement = currentAudioElement;
          } catch {
            // Already connected or deferred
          }
        }

        if (connectedAudioElement === currentAudioElement && gainNode) {
          currentAudioElement.volume = 1;
          currentAudioElement.muted = volume === 0;
          gainNode.gain.value = volume;
        }
      } catch {
        // Ignore WebAudio setup errors
      }
    },
  };
}

export function createPlayerRuntime(): PlayerRuntime {
  const clock = createBrowserClock();
  const supabase = createClient();
  let activeUserEmail: string | null = null;
  let activeOwner: PlaybackOwner | null = null;

  const html5Engine = new Html5AudioEngine();
  const youtubeEngine = new YouTubeIframeEngine();

  // Placeholder audio element for SSR / pre-mount until <audio ref> attaches
  const fallbackAudio =
    typeof document !== 'undefined'
      ? document.createElement('audio')
      : ({
          addEventListener: () => {},
          removeEventListener: () => {},
          pause: () => {},
          removeAttribute: () => {},
        } as unknown as HTMLAudioElement);

  let currentAudioElement: HTMLAudioElement = fallbackAudio;
  html5Engine.setAudioElement(currentAudioElement);

  // Proxy HTMLAudioElement so BrowserTransport always binds listeners to the mounted <audio> element
  const audioProxy = new Proxy(fallbackAudio, {
    get(_target, prop) {
      const value = Reflect.get(currentAudioElement, prop);
      return typeof value === 'function'
        ? value.bind(currentAudioElement)
        : value;
    },
    set(_target, prop, value) {
      return Reflect.set(currentAudioElement, prop, value);
    },
  });

  const webAudioGain = createWebAudioGainManager({
    getAudioElement: () =>
      currentAudioElement !== fallbackAudio ? currentAudioElement : null,
    isPlaying: () => {
      const snap = controller.getSnapshot();
      return snap.isPlaying || snap.isBuffering;
    },
  });

  const baseTransport: BrowserTransport = createBrowserTransport({
    audio: audioProxy,
    html5: html5Engine,
    youtube: youtubeEngine,
  });

  const transport: BrowserTransport = {
    ...baseTransport,
    start(target, owner, volume, mode) {
      activeOwner = target.engine === 'youtube' ? { ...owner } : null;
      const p = baseTransport.start(target, owner, volume, mode);
      if (target.engine === 'html5' && mode === 'play') {
        webAudioGain.ensureGain(volume);
      }
      return p;
    },
    resume() {
      const p = baseTransport.resume();
      if (!activeOwner) {
        webAudioGain.ensureGain(controller.getSnapshot().volume);
      }
      return p;
    },
    stop() {
      activeOwner = null;
      baseTransport.stop();
    },
    setVolume(volume) {
      baseTransport.setVolume(volume);
      webAudioGain.ensureGain(volume);
    },
  };

  const persistence = createBrowserPersistence();
  const userEffects = createBrowserUserEffects({
    fetch: (...args) => fetch(...args),
    clock,
    resolveExternalTrack: async (track: Track) => {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      const activeUser =
        currentUser ||
        (activeUserEmail ? { id: activeUserEmail, email: activeUserEmail } : null);
      const userId = activeUser ? getValidUserId(activeUser) : null;
      if (!userId) return null;
      return resolveExternalTrackId(supabase, track, userId);
    },
    recommendFallback: (seed, queue, count) =>
      getSmartRecommendedTracks(seed, queue, count),
  });

  const sourceDeps = createBrowserSourceDependencies(clock);
  const sources = createPlaybackSourceService(sourceDeps);

  const controller = createPlaybackController({
    clock,
    transport,
    sources,
    persistence,
    userEffects,
  });

  // Track side effects on currentTrack changes: SponsorBlock MV intro offset & YouTube view count
  let lastSponsorBlockTrackId: string | null = null;
  let lastViewCountKey = '';

  const unsubscribeTrackMetadataEffects = controller.subscribe(() => {
    const snap = controller.getSnapshot();
    const track = snap.currentTrack;

    if ((track?.id ?? null) !== lastSponsorBlockTrackId) {
      lastSponsorBlockTrackId = track?.id ?? null;
      controller.setMvIntroOffset(0);
      if (track) {
        const ytId =
          track.youtube_id ||
          extractYouTubeVideoId(track.file_path || '') ||
          (track.id?.startsWith('yt-') ? track.id.replace('yt-', '') : null);
        if (ytId) {
          const expectedTrackId = track.id;
          void getMusicOfftopicSegments(ytId)
            .then((segments) => {
              if (controller.getSnapshot().currentTrack?.id === expectedTrackId) {
                controller.setMvIntroOffset(calculateIntroOffset(segments));
              }
            })
            .catch(() => {});
        }
      }
    }

    const viewKey =
      track && track.youtube_id && track.view_count == null
        ? `${track.id}|${track.youtube_id}`
        : '';
    if (viewKey && viewKey !== lastViewCountKey) {
      lastViewCountKey = viewKey;
      const ytId = track!.youtube_id!;
      void fetchViewCountForVideo(ytId)
        .then((views) => {
          if (views != null) {
            controller.updateCurrentTrackViewCount(ytId, views);
          }
        })
        .catch(() => {});
    }
  });

  let hasRestoredFromPersistence = false;

  return {
    controller,
    setActiveUserEmail(email) {
      activeUserEmail = email ?? null;
    },
    attachAudioElement(audio: HTMLAudioElement | null): Cancel {
      if (!audio) return () => {};
      currentAudioElement = audio;
      html5Engine.setAudioElement(audio);

      const unbindLifecycle = bindBrowserLifecycle(controller, { clock });
      const unbindMediaSession = bindMediaSession(controller, { clock });
      const unbindYouTube = bindYouTubeIframe({
        clock,
        youtubeEngine,
        transport,
        getActiveOwner: () => activeOwner,
        getVolume: () => controller.getSnapshot().volume,
        isPlayingWanted: () => {
          const snap = controller.getSnapshot();
          return snap.isPlaying || snap.isBuffering;
        },
      });

      // Load user's auto_play setting and restore persisted session once on mount
      let active = true;
      void supabase.auth
        .getUser()
        .then(async (result: { data: { user: { id: string } | null } }) => {
          const user = result.data.user;
          if (!user || !active) return;
          const { data } = await supabase
            .from('user_settings')
            .select('auto_play')
            .eq('user_id', user.id)
            .maybeSingle();
          if (active && typeof data?.auto_play === 'boolean') {
            controller.setAutoPlayNext(data.auto_play);
          }
        })
        .catch(() => {});

      if (!hasRestoredFromPersistence) {
        hasRestoredFromPersistence = true;
        void controller.restoreFromPersistence();
      }

      return () => {
        active = false;
        transport.stop();
        unbindYouTube();
        unbindMediaSession();
        unbindLifecycle();
        if (currentAudioElement === audio) {
          html5Engine.setAudioElement(fallbackAudio);
          currentAudioElement = fallbackAudio;
        }
      };
    },
    dispose() {
      unsubscribeTrackMetadataEffects();
      controller.dispose();
      html5Engine.setAudioElement(fallbackAudio);
      currentAudioElement = fallbackAudio;
    },
  };
}
