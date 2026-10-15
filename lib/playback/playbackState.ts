import type { Cancel } from './ports';
import type {
  PlaybackProgressSnapshot,
  PlaybackSnapshot,
} from './controllerTypes';

export const DEFAULT_PLAYBACK_VOLUME = 0.8;

export interface PlaybackStateStore {
  getSnapshot(): PlaybackSnapshot;
  getProgress(): PlaybackProgressSnapshot;
  patch(partial: Partial<PlaybackSnapshot>): void;
  setProgress(
    partial: Partial<PlaybackProgressSnapshot>,
    options?: { silent?: boolean }
  ): void;
  subscribe(listener: () => void): Cancel;
  subscribeProgress(listener: () => void): Cancel;
  clearListeners(): void;
}

export function createPlaybackStateStore(
  initial: Partial<PlaybackSnapshot> = {},
  initialProgress: Partial<PlaybackProgressSnapshot> = {}
): PlaybackStateStore {
  let snapshot: PlaybackSnapshot = {
    currentTrack: null,
    isPlaying: false,
    isBuffering: false,
    volume: DEFAULT_PLAYBACK_VOLUME,
    isShuffle: false,
    repeatMode: 'off',
    autoPlayNext: true,
    playbackError: null,
    mvIntroOffset: 0,
    queue: [],
    currentIndex: -1,
    isQueueOpen: false,
    isNowPlayingOpen: false,
    ...initial,
  };

  let progress: PlaybackProgressSnapshot = {
    currentTime: 0,
    duration: 0,
    ...initialProgress,
  };

  const listeners = new Set<() => void>();
  const progressListeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const emitProgress = () => {
    for (const listener of progressListeners) {
      listener();
    }
  };

  return {
    getSnapshot() {
      return snapshot;
    },

    getProgress() {
      return progress;
    },

    patch(partial) {
      let changed = false;
      for (const key of Object.keys(partial) as Array<keyof PlaybackSnapshot>) {
        if (!Object.is(snapshot[key], partial[key])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      snapshot = { ...snapshot, ...partial };
      emit();
    },

    setProgress(partial, options) {
      const nextTime =
        partial.currentTime !== undefined
          ? partial.currentTime
          : progress.currentTime;
      const nextDuration =
        partial.duration !== undefined ? partial.duration : progress.duration;
      if (
        Object.is(progress.currentTime, nextTime) &&
        Object.is(progress.duration, nextDuration)
      ) {
        return;
      }
      progress = {
        currentTime: nextTime,
        duration: nextDuration,
      };
      if (!options?.silent) {
        emitProgress();
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    subscribeProgress(listener) {
      progressListeners.add(listener);
      return () => {
        progressListeners.delete(listener);
      };
    },

    clearListeners() {
      listeners.clear();
      progressListeners.clear();
    },
  };
}
