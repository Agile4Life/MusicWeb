import { describe, expect, it, vi } from 'vitest';
import { createCompletionCoordinator } from '@/lib/playback/completionCoordinator';

describe('completionCoordinator', () => {
  it('deduplicates completion events for the same trackId and requestId', () => {
    const coordinator = createCompletionCoordinator({
      now: () => 1000,
      after: () => () => {},
      every: () => () => {},
    });

    const first = coordinator.complete({
      trackId: 't-1',
      requestId: 7,
      reason: 'html5-native-ended',
      desiredState: 'playing',
      repeatMode: 'off',
      autoPlayNext: true,
      isShuffle: false,
      currentIndex: 0,
      queueLength: 3,
      consecutiveSkips: 0,
      maxConsecutiveSkips: 4,
    });
    const duplicate = coordinator.complete({
      trackId: 't-1',
      requestId: 7,
      reason: 'html5-near-end-watchdog',
      desiredState: 'playing',
      repeatMode: 'off',
      autoPlayNext: true,
      isShuffle: false,
      currentIndex: 0,
      queueLength: 3,
      consecutiveSkips: 0,
      maxConsecutiveSkips: 4,
    });

    expect(first).toEqual({ action: 'next' });
    expect(duplicate).toEqual({ action: 'ignore' });
  });

  it('arms near-end watchdog within 1.5s of end and fires when transport reaches EOF', () => {
    let watchdogCallback: (() => void) | null = null;
    const coordinator = createCompletionCoordinator({
      now: () => 1000,
      after: (_ms, cb) => {
        watchdogCallback = cb;
        return () => {
          watchdogCallback = null;
        };
      },
      every: () => () => {},
    });

    const onTrigger = vi.fn();
    let currentTime = 178.8;
    const triggeredImmediate = coordinator.evaluateTimeUpdate({
      engine: 'html5',
      time: currentTime,
      duration: 180,
      onTrigger,
      readTransportState: () => ({ time: currentTime, duration: 180 }),
    });

    expect(triggeredImmediate).toBe(false);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(watchdogCallback).toBeTypeOf('function');

    currentTime = 179.4;
    watchdogCallback!();
    expect(onTrigger).toHaveBeenCalledWith('html5-near-end-watchdog');
  });

  it('returns repeat-one, stop at end of queue, or circuit-breaker when consecutive skips reach limit', () => {
    const coordinator = createCompletionCoordinator({
      now: () => 1000,
      after: () => () => {},
      every: () => () => {},
    });

    expect(
      coordinator.complete({
        trackId: 't-1',
        requestId: 1,
        reason: 'ended',
        desiredState: 'playing',
        repeatMode: 'one',
        autoPlayNext: true,
        isShuffle: false,
        currentIndex: 0,
        queueLength: 2,
        consecutiveSkips: 0,
        maxConsecutiveSkips: 4,
      })
    ).toEqual({ action: 'repeat-one' });

    expect(
      coordinator.complete({
        trackId: 't-2',
        requestId: 2,
        reason: 'ended',
        desiredState: 'playing',
        repeatMode: 'off',
        autoPlayNext: true,
        isShuffle: false,
        currentIndex: 1,
        queueLength: 2,
        consecutiveSkips: 0,
        maxConsecutiveSkips: 4,
      })
    ).toEqual({ action: 'stop' });

    expect(
      coordinator.complete({
        trackId: 't-3',
        requestId: 3,
        reason: 'ended',
        desiredState: 'playing',
        repeatMode: 'all',
        autoPlayNext: true,
        isShuffle: false,
        currentIndex: 0,
        queueLength: 2,
        consecutiveSkips: 4,
        maxConsecutiveSkips: 4,
      })
    ).toEqual({ action: 'circuit-breaker' });
  });
});
