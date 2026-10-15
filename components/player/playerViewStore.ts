import type React from 'react';
import type { PlaybackController } from '@/lib/playback/controllerTypes';
import type { Cancel } from '@/lib/playback/ports';
import type {
  PlayerContextType,
  PlayerControlsContextType,
  PlayerQueueContextType,
  PlayerTrackContextType,
} from './playerContextTypes';

export interface PlayerViewSlices {
  controls: PlayerControlsContextType;
  track: PlayerTrackContextType;
  queue: PlayerQueueContextType;
  player: PlayerContextType;
}

export interface PlayerViewStore {
  readonly audioRef: React.RefObject<HTMLAudioElement | null>;
  getControls(): PlayerControlsContextType;
  getSlices(): PlayerViewSlices;
  subscribe(listener: () => void): Cancel;
}

export function createPlayerViewStore(
  controller: PlaybackController,
  options: {
    frequencyData?: Uint8Array;
    audioRef?: React.RefObject<HTMLAudioElement | null>;
  } = {}
): PlayerViewStore {
  const frequencyData = options.frequencyData ?? new Uint8Array(16);
  const audioRef: React.RefObject<HTMLAudioElement | null> =
    options.audioRef ?? { current: null };

  const controls: PlayerControlsContextType = {
    playTrack: (track, newQueue, forceIndex, startFromTime) =>
      controller.playTrack(track, newQueue, forceIndex, startFromTime),
    playSearchTrack: (track) => controller.playSearchTrack(track),
    togglePlay: () => {
      void controller.togglePlay();
    },
    seek: (time) => controller.seek(time),
    setVolume: (val) => controller.setVolume(val),
    nextTrack: () => controller.nextTrack(),
    prevTrack: () => controller.prevTrack(),
    toggleShuffle: () => controller.toggleShuffle(),
    toggleRepeat: () => controller.toggleRepeat(),
    toggleFavoriteCurrentTrack: () => controller.toggleFavoriteCurrentTrack(),
    addToQueue: (track) => controller.addToQueue(track),
    removeFromQueue: (index) => controller.removeFromQueue(index),
    clearQueue: () => controller.clearQueue(),
    toggleQueue: () => controller.toggleQueue(),
    closeQueue: () => controller.closeQueue(),
    toggleNowPlayingOverlay: () => controller.toggleNowPlayingOverlay(),
    openNowPlayingOverlay: () => controller.openNowPlayingOverlay(),
    closeNowPlayingOverlay: () => controller.closeNowPlayingOverlay(),
  };

  let lastSnap = controller.getSnapshot();

  let trackSlice: PlayerTrackContextType = {
    currentTrack: lastSnap.currentTrack,
    isPlaying: lastSnap.isPlaying,
    isBuffering: lastSnap.isBuffering,
    volume: lastSnap.volume,
    isShuffle: lastSnap.isShuffle,
    repeatMode: lastSnap.repeatMode,
    playbackError: lastSnap.playbackError,
    frequencyData,
    audioRef,
    mvIntroOffset: lastSnap.mvIntroOffset,
  };

  let queueSlice: PlayerQueueContextType = {
    queue: lastSnap.queue,
    currentIndex: lastSnap.currentIndex,
    isQueueOpen: lastSnap.isQueueOpen,
    isNowPlayingOpen: lastSnap.isNowPlayingOpen,
    addToQueue: controls.addToQueue,
    removeFromQueue: controls.removeFromQueue,
    clearQueue: controls.clearQueue,
  };

  let playerSlice: PlayerContextType = {
    ...trackSlice,
    ...controls,
    ...queueSlice,
  };

  let slices: PlayerViewSlices = {
    controls,
    track: trackSlice,
    queue: queueSlice,
    player: playerSlice,
  };

  const recomputeSlices = (): boolean => {
    const snap = controller.getSnapshot();
    if (snap === lastSnap) return false;

    const trackChanged =
      !Object.is(snap.currentTrack, trackSlice.currentTrack) ||
      snap.isPlaying !== trackSlice.isPlaying ||
      snap.isBuffering !== trackSlice.isBuffering ||
      snap.volume !== trackSlice.volume ||
      snap.isShuffle !== trackSlice.isShuffle ||
      snap.repeatMode !== trackSlice.repeatMode ||
      snap.playbackError !== trackSlice.playbackError ||
      snap.mvIntroOffset !== trackSlice.mvIntroOffset;

    const queueChanged =
      !Object.is(snap.queue, queueSlice.queue) ||
      snap.currentIndex !== queueSlice.currentIndex ||
      snap.isQueueOpen !== queueSlice.isQueueOpen ||
      snap.isNowPlayingOpen !== queueSlice.isNowPlayingOpen;

    lastSnap = snap;
    if (!trackChanged && !queueChanged) {
      return false;
    }

    if (trackChanged) {
      trackSlice = {
        currentTrack: snap.currentTrack,
        isPlaying: snap.isPlaying,
        isBuffering: snap.isBuffering,
        volume: snap.volume,
        isShuffle: snap.isShuffle,
        repeatMode: snap.repeatMode,
        playbackError: snap.playbackError,
        frequencyData,
        audioRef,
        mvIntroOffset: snap.mvIntroOffset,
      };
    }

    if (queueChanged) {
      queueSlice = {
        queue: snap.queue,
        currentIndex: snap.currentIndex,
        isQueueOpen: snap.isQueueOpen,
        isNowPlayingOpen: snap.isNowPlayingOpen,
        addToQueue: controls.addToQueue,
        removeFromQueue: controls.removeFromQueue,
        clearQueue: controls.clearQueue,
      };
    }

    playerSlice = {
      ...trackSlice,
      ...controls,
      ...queueSlice,
    };

    slices = {
      controls,
      track: trackSlice,
      queue: queueSlice,
      player: playerSlice,
    };
    return true;
  };

  return {
    audioRef,
    getControls() {
      return controls;
    },
    getSlices() {
      recomputeSlices();
      return slices;
    },
    subscribe(listener) {
      return controller.subscribe(() => {
        if (recomputeSlices()) {
          listener();
        }
      });
    },
  };
}
