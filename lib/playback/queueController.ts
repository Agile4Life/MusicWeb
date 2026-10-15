import type { Track } from '@/types';
import { mergeResolvedIntoQueue } from '@/lib/queueSync';
import {
  isBackgroundPlayableTrack,
  isFullYouTubeQueue,
} from '@/lib/trackSourceClassifier';
import { deduplicateQueueTracks } from '@/lib/utils';

const MAX_PLAYED_HISTORY = 50;
const RECENT_PREV_CLICK_WINDOW_MS = 2500;
const PREV_RESTART_THRESHOLD_SECONDS = 3;

export interface PreparePlayTrackInput {
  track: Track;
  queue: Track[];
  currentIndex: number;
  currentTrack: Track | null;
  newQueue?: Track[];
  forceIndex?: number;
}

export interface PreparedQueueTransition {
  queue: Track[];
  currentIndex: number;
  shouldSmartFill: boolean;
}

export interface SearchPlayPlan {
  track: Track;
  newQueue?: Track[];
  forceIndex: number;
}

export type NextTrackDecision =
  | { action: 'none' }
  | {
      action: 'play';
      track: Track;
      index: number;
      shouldSmartFill: boolean;
    };

export type PrevTrackDecision =
  | { action: 'none' }
  | { action: 'restart' }
  | {
      action: 'play';
      track: Track;
      index: number;
    };

export interface RemoveFromQueueResult {
  queue: Track[];
  currentIndex: number;
  removedCurrent: boolean;
  nextTrack: Track | null;
}

export interface QueueController {
  preparePlayTrack(input: PreparePlayTrackInput): PreparedQueueTransition;
  prepareSearchTrack(params: {
    track: Track;
    queue: Track[];
    currentIndex: number;
  }): SearchPlayPlan;
  selectNext(params: {
    queue: Track[];
    currentIndex: number;
    currentTrack: Track | null;
    isShuffle: boolean;
  }): NextTrackDecision;
  selectPrevious(params: {
    queue: Track[];
    currentIndex: number;
    currentTrack: Track | null;
    isShuffle: boolean;
    activeTime: number;
    now: number;
  }): PrevTrackDecision;
  addToQueue(queue: Track[], currentIndex: number, track: Track): Track[];
  removeFromQueue(
    queue: Track[],
    currentIndex: number,
    indexToRemove: number
  ): RemoveFromQueueResult;
  clearQueue(currentTrack: Track | null): { queue: Track[]; currentIndex: number };
  mergeResolvedTrack(queue: Track[], resolvedTrack: Track): Track[];
  getHistoryStacks(): { played: Track[]; forward: Track[] };
  reset(): void;
}

export function createQueueController(
  options: { random?: () => number } = {}
): QueueController {
  const random = options.random ?? Math.random;
  let playedHistory: Track[] = [];
  let forwardHistory: Track[] = [];
  let isPrevNextAction = false;
  let isBackwardAction = false;
  let lastPrevClickAt = 0;

  return {
    preparePlayTrack({
      track,
      queue,
      currentIndex,
      currentTrack,
      newQueue,
      forceIndex,
    }): PreparedQueueTransition {
      let nextQueue = queue;
      let nextIndex = currentIndex;

      if (newQueue) {
        nextQueue = deduplicateQueueTracks(newQueue);
        const idx = nextQueue.findIndex((t) => t.id === track.id);
        nextIndex = idx >= 0 ? idx : 0;
      } else if (typeof forceIndex === 'number') {
        nextIndex = forceIndex;
      } else if (nextQueue.length === 0) {
        nextQueue = [track];
        nextIndex = 0;
      } else {
        const existingIdx = nextQueue.findIndex((t) => t.id === track.id);
        if (existingIdx >= 0) {
          nextIndex = existingIdx;
        } else {
          const insertIdx = nextIndex >= 0 ? nextIndex + 1 : nextQueue.length;
          const updated = [...nextQueue];
          updated.splice(insertIdx, 0, track);
          nextQueue = deduplicateQueueTracks(updated);
          const found = nextQueue.findIndex((t) => t.id === track.id);
          nextIndex = found >= 0 ? found : insertIdx;
        }
      }

      if (currentTrack && currentTrack.id !== track.id) {
        if (!isBackwardAction) {
          playedHistory.push(currentTrack);
          if (playedHistory.length > MAX_PLAYED_HISTORY) {
            playedHistory.shift();
          }
        }
      }
      isBackwardAction = false;

      if (!isPrevNextAction) {
        forwardHistory = [];
      }
      isPrevNextAction = false;

      const targetIndex =
        typeof nextIndex === 'number' && nextIndex >= 0 ? nextIndex : -1;

      return {
        queue: nextQueue,
        currentIndex: targetIndex,
        shouldSmartFill:
          targetIndex >= nextQueue.length - 2 || nextQueue.length <= 5,
      };
    },

    prepareSearchTrack({ track, queue, currentIndex }): SearchPlayPlan {
      if (queue.length === 0) {
        return { track, newQueue: [track], forceIndex: 0 };
      }

      const existingIdx = queue.findIndex((t) => t.id === track.id);
      if (existingIdx !== -1) {
        return { track, newQueue: undefined, forceIndex: existingIdx };
      }

      const insertIdx = currentIndex >= 0 ? currentIndex + 1 : queue.length;
      const updatedQueue = [...queue];
      updatedQueue.splice(insertIdx, 0, track);
      const deduped = deduplicateQueueTracks(updatedQueue);
      const targetIdx = deduped.findIndex((t) => t.id === track.id);

      return {
        track,
        newQueue: deduped,
        forceIndex: targetIdx >= 0 ? targetIdx : insertIdx,
      };
    },

    selectNext({ queue, currentIndex, currentTrack, isShuffle }): NextTrackDecision {
      isPrevNextAction = true;
      isBackwardAction = false;

      if (forwardHistory.length > 0) {
        const forwardSong = forwardHistory.pop();
        if (forwardSong) {
          const forwardIndex = queue.findIndex((t) => t.id === forwardSong.id);
          return {
            action: 'play',
            track: forwardSong,
            index: forwardIndex,
            shouldSmartFill:
              forwardIndex >= 0 && forwardIndex >= queue.length - 2,
          };
        }
      }

      if (queue.length === 0) {
        isPrevNextAction = false;
        return { action: 'none' };
      }

      let idx = currentIndex >= 0 ? currentIndex : -1;
      if (idx < 0 && currentTrack) {
        idx = queue.findIndex((t) => t.id === currentTrack.id);
      }
      if (idx < 0) idx = 0;

      let nextIdx = 0;
      const preserveOrder = isFullYouTubeQueue(queue);
      if (isShuffle && queue.length > 1) {
        if (preserveOrder) {
          let guard = 0;
          do {
            nextIdx = Math.floor(random() * queue.length);
            guard += 1;
          } while (nextIdx === idx && guard < 16);
          if (nextIdx === idx) nextIdx = (idx + 1) % queue.length;
        } else {
          const candidates: { track: Track; index: number }[] = [];
          const fallbackCandidates: { track: Track; index: number }[] = [];

          queue.forEach((t, i) => {
            if (i === idx) return;
            fallbackCandidates.push({ track: t, index: i });
            if (isBackgroundPlayableTrack(t)) {
              candidates.push({ track: t, index: i });
            }
          });

          if (candidates.length > 0) {
            const chosen =
              candidates[Math.floor(random() * candidates.length)];
            nextIdx = chosen.index;
          } else if (fallbackCandidates.length > 0) {
            const chosen =
              fallbackCandidates[
                Math.floor(random() * fallbackCandidates.length)
              ];
            nextIdx = chosen.index;
          } else {
            nextIdx = idx;
          }
        }
      } else {
        nextIdx = (idx + 1) % queue.length;
      }

      return {
        action: 'play',
        track: queue[nextIdx],
        index: nextIdx,
        shouldSmartFill: nextIdx >= queue.length - 2,
      };
    },

    selectPrevious({
      queue,
      currentIndex,
      currentTrack,
      isShuffle,
      activeTime,
      now,
    }): PrevTrackDecision {
      const isRecentClick =
        lastPrevClickAt > 0 && now - lastPrevClickAt < RECENT_PREV_CLICK_WINDOW_MS;
      lastPrevClickAt = now;

      if (activeTime > PREV_RESTART_THRESHOLD_SECONDS && !isRecentClick) {
        isPrevNextAction = false;
        isBackwardAction = false;
        return { action: 'restart' };
      }

      isPrevNextAction = true;
      isBackwardAction = true;

      if (playedHistory.length > 0) {
        const prevSong = playedHistory.pop();
        if (prevSong) {
          if (currentTrack) {
            forwardHistory.push(currentTrack);
          }
          const prevIndex = queue.findIndex((t) => t.id === prevSong.id);
          return {
            action: 'play',
            track: prevSong,
            index: prevIndex,
          };
        }
      }

      if (queue.length === 0) {
        isPrevNextAction = false;
        isBackwardAction = false;
        return { action: 'none' };
      }

      let idx = currentIndex >= 0 ? currentIndex : -1;
      if (idx < 0 && currentTrack) {
        idx = queue.findIndex((t) => t.id === currentTrack.id);
      }
      if (idx < 0) idx = 0;

      let prevIdx = 0;
      if (isShuffle && queue.length > 1) {
        let guard = 0;
        do {
          prevIdx = Math.floor(random() * queue.length);
          guard += 1;
        } while (prevIdx === idx && guard < 16);
        if (prevIdx === idx) prevIdx = (idx - 1 + queue.length) % queue.length;
      } else {
        prevIdx = (idx - 1 + queue.length) % queue.length;
      }

      if (currentTrack) {
        forwardHistory.push(currentTrack);
      }

      return {
        action: 'play',
        track: queue[prevIdx],
        index: prevIdx,
      };
    },

    addToQueue(queue: Track[], currentIndex: number, track: Track): Track[] {
      const insertIdx = currentIndex >= 0 ? currentIndex + 1 : queue.length;
      const next = [...queue];
      next.splice(insertIdx, 0, track);
      return deduplicateQueueTracks(next);
    },

    removeFromQueue(
      queue: Track[],
      currentIndex: number,
      indexToRemove: number
    ): RemoveFromQueueResult {
      const isRemovingCurrent = indexToRemove === currentIndex;
      const nextQueue = queue.filter((_, idx) => idx !== indexToRemove);

      if (currentIndex > indexToRemove) {
        return {
          queue: nextQueue,
          currentIndex: currentIndex - 1,
          removedCurrent: false,
          nextTrack: null,
        };
      }

      if (isRemovingCurrent) {
        if (nextQueue.length === 0) {
          return {
            queue: [],
            currentIndex: -1,
            removedCurrent: true,
            nextTrack: null,
          };
        }
        const nextIdx =
          indexToRemove >= nextQueue.length ? nextQueue.length - 1 : indexToRemove;
        return {
          queue: nextQueue,
          currentIndex: nextIdx,
          removedCurrent: true,
          nextTrack: nextQueue[nextIdx],
        };
      }

      return {
        queue: nextQueue,
        currentIndex,
        removedCurrent: false,
        nextTrack: null,
      };
    },

    clearQueue(currentTrack: Track | null) {
      if (currentTrack) {
        return { queue: [currentTrack], currentIndex: 0 };
      }
      return { queue: [], currentIndex: -1 };
    },

    mergeResolvedTrack(queue: Track[], resolvedTrack: Track): Track[] {
      return mergeResolvedIntoQueue(queue, resolvedTrack);
    },

    getHistoryStacks() {
      return {
        played: [...playedHistory],
        forward: [...forwardHistory],
      };
    },

    reset() {
      playedHistory = [];
      forwardHistory = [];
      isPrevNextAction = false;
      isBackwardAction = false;
      lastPrevClickAt = 0;
    },
  };
}
