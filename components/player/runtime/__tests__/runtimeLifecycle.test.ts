import { describe, expect, it, vi } from 'vitest';
import { bindBrowserLifecycle } from '../browserLifecycle';
import type { PlaybackController, PlaybackSnapshot } from '@/lib/playback/controllerTypes';

function createStubController(initial: Partial<PlaybackSnapshot> = {}) {
  let snapshot: PlaybackSnapshot = {
    currentTrack: null,
    isPlaying: false,
    isBuffering: false,
    volume: 0.8,
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
  const listeners = new Set<() => void>();

  const controller = {
    getSnapshot: () => snapshot,
    getProgress: () => ({ currentTime: 0, duration: 0 }),
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    subscribeProgress: () => () => {},
    handleVisibilityChange: vi.fn(),
    handlePageHide: vi.fn(),
    handleUserActivation: vi.fn(),
    checkBackgroundCompletion: vi.fn(),
    patch(partial: Partial<PlaybackSnapshot>) {
      snapshot = { ...snapshot, ...partial };
      for (const l of listeners) l();
    },
  } as unknown as PlaybackController & { patch(p: Partial<PlaybackSnapshot>): void };

  return controller;
}

describe('browserLifecycle', () => {
  it('registers and symmetrically cleans up all document, window, timer, and worker listeners', () => {
    const docListeners = new Map<string, EventListener>();
    const winListeners = new Map<string, EventListener>();
    const attrs = new Map<string, string>();

    const fakeDoc = {
      hidden: false,
      documentElement: {
        setAttribute: (k: string, v: string) => attrs.set(k, v),
        removeAttribute: (k: string) => attrs.delete(k),
      },
      addEventListener: vi.fn((name: string, cb: EventListener) => {
        docListeners.set(name, cb);
      }),
      removeEventListener: vi.fn((name: string, cb: EventListener) => {
        if (docListeners.get(name) === cb) docListeners.delete(name);
      }),
    } as unknown as Document;

    const fakeWin = {
      addEventListener: vi.fn((name: string, cb: EventListener) => {
        winListeners.set(name, cb);
      }),
      removeEventListener: vi.fn((name: string, cb: EventListener) => {
        if (winListeners.get(name) === cb) winListeners.delete(name);
      }),
    } as unknown as Window;

    const postMessage = vi.fn();
    const terminate = vi.fn();
    const fakeWorker = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null as (() => void) | null,
      postMessage,
      terminate,
    } as unknown as Worker;

    const intervals = new Set<() => void>();
    const controller = createStubController();

    const dispose = bindBrowserLifecycle(controller, {
      clock: {
        now: () => 1000,
        after: () => () => {},
        every: (_ms, cb) => {
          intervals.add(cb);
          return () => intervals.delete(cb);
        },
      },
      doc: fakeDoc,
      win: fakeWin,
      createWorker: () => fakeWorker,
    });

    expect(docListeners.size).toBe(1);
    expect(winListeners.size).toBe(4);
    expect(postMessage).toHaveBeenCalledWith('stop');

    // Simulate visibility hidden
    (fakeDoc as unknown as { hidden: boolean }).hidden = true;
    docListeners.get('visibilitychange')!(new Event('visibilitychange'));
    expect(controller.handleVisibilityChange).toHaveBeenCalledWith(true);
    expect(attrs.get('data-tab-hidden')).toBe('true');
    expect(postMessage).toHaveBeenCalledWith('start');

    // Simulate worker tick
    fakeWorker.onmessage?.({ data: 'tick' } as MessageEvent);
    expect(controller.checkBackgroundCompletion).toHaveBeenCalledTimes(1);

    // Dispose and verify 100% cleanup symmetry
    dispose();
    expect(docListeners.size).toBe(0);
    expect(winListeners.size).toBe(0);
    expect(intervals.size).toBe(0);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(attrs.has('data-tab-hidden')).toBe(false);
  });
});
