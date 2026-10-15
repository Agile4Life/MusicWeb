import type { Cancel, PlaybackClock } from './ports';

export type CompletionAction =
  | { action: 'ignore' }
  | { action: 'circuit-breaker' }
  | { action: 'repeat-one' }
  | { action: 'next' }
  | { action: 'stop' };

export interface CompletionContext {
  trackId: string;
  requestId: number;
  reason: string;
  desiredState: 'playing' | 'paused' | null;
  repeatMode: 'off' | 'all' | 'one';
  autoPlayNext: boolean;
  isShuffle: boolean;
  currentIndex: number;
  queueLength: number;
  consecutiveSkips: number;
  maxConsecutiveSkips: number;
}

export interface CompletionCoordinator {
  reset(): void;
  clearNearEndWatchdog(): void;
  evaluateTimeUpdate(params: {
    engine: 'html5' | 'youtube';
    time: number;
    duration: number;
    onTrigger: (reason: string) => void;
    readTransportState: () => { time: number; duration: number; ended?: boolean };
  }): boolean;
  shouldCompleteOnHtml5Pause(params: {
    desiredState: 'playing' | 'paused' | null;
    time: number;
    duration: number;
    ended?: boolean;
  }): boolean;
  shouldCompleteOnBufferNearEnd(params: {
    desiredState: 'playing' | 'paused' | null;
    time: number;
    duration: number;
  }): boolean;
  shouldCompleteOnBackgroundCheck(params: {
    engine: 'html5' | 'youtube';
    desiredState: 'playing' | 'paused' | null;
    time: number;
    duration: number;
    ended?: boolean;
  }): boolean;
  complete(ctx: CompletionContext): CompletionAction;
  dispose(): void;
}

export function createCompletionCoordinator(
  clock: PlaybackClock
): CompletionCoordinator {
  let handled: { trackId: string; requestId: number } | null = null;
  let cancelNearEndWatchdog: Cancel | null = null;

  const clearNearEndWatchdog = () => {
    if (cancelNearEndWatchdog) {
      cancelNearEndWatchdog();
      cancelNearEndWatchdog = null;
    }
  };

  return {
    reset() {
      handled = null;
      clearNearEndWatchdog();
    },

    clearNearEndWatchdog,

    evaluateTimeUpdate({
      engine,
      time,
      duration,
      onTrigger,
      readTransportState,
    }): boolean {
      if (!Number.isFinite(duration) || duration <= 0 || time < 3) {
        return false;
      }

      if (engine === 'youtube') {
        if (duration > 5 && duration - time <= 0.75) {
          onTrigger('youtube-near-end-interval');
          return true;
        }
        return false;
      }

      const remaining = duration - time;
      if (remaining <= 0.35) {
        onTrigger('html5-near-end-timeupdate');
        return true;
      }

      if (remaining <= 1.5 && remaining > 0 && !cancelNearEndWatchdog) {
        const graceMs = Math.max(150, Math.round(remaining * 1000 + 400));
        cancelNearEndWatchdog = clock.after(graceMs, () => {
          cancelNearEndWatchdog = null;
          const current = readTransportState();
          if (
            current.duration > 0 &&
            (current.duration - current.time <= 0.9 || Boolean(current.ended))
          ) {
            onTrigger('html5-near-end-watchdog');
          }
        });
      }

      return false;
    },

    shouldCompleteOnHtml5Pause({ desiredState, time, duration, ended }) {
      if (desiredState !== 'playing') return false;
      if (ended) return true;
      return (
        Number.isFinite(duration) &&
        duration > 3 &&
        time >= 3 &&
        duration - time <= 0.5
      );
    },

    shouldCompleteOnBufferNearEnd({ desiredState, time, duration }) {
      if (desiredState !== 'playing') return false;
      return (
        Number.isFinite(duration) &&
        duration > 0 &&
        time >= 3 &&
        duration - time <= 1.8
      );
    },

    shouldCompleteOnBackgroundCheck({
      engine,
      desiredState,
      time,
      duration,
      ended,
    }) {
      if (desiredState !== 'playing') return false;
      if (engine === 'youtube') {
        return Boolean(
          ended || (duration > 5 && time >= 3 && duration - time <= 1.0)
        );
      }
      return Boolean(
        (ended && time >= 3) ||
          (duration > 3 && time >= 3 && (duration - time <= 1.0 || ended))
      );
    },

    complete(ctx: CompletionContext): CompletionAction {
      clearNearEndWatchdog();
      if (!ctx.trackId || ctx.desiredState === 'paused') {
        return { action: 'ignore' };
      }
      if (
        handled &&
        handled.trackId === ctx.trackId &&
        handled.requestId === ctx.requestId
      ) {
        return { action: 'ignore' };
      }

      handled = { trackId: ctx.trackId, requestId: ctx.requestId };

      if (ctx.consecutiveSkips >= ctx.maxConsecutiveSkips) {
        return { action: 'circuit-breaker' };
      }

      if (ctx.repeatMode === 'one') {
        return { action: 'repeat-one' };
      }

      if (ctx.repeatMode === 'all') {
        return { action: 'next' };
      }

      if (
        ctx.autoPlayNext &&
        (ctx.isShuffle || ctx.currentIndex < ctx.queueLength - 1)
      ) {
        return { action: 'next' };
      }

      return { action: 'stop' };
    },

    dispose() {
      handled = null;
      clearNearEndWatchdog();
    },
  };
}
