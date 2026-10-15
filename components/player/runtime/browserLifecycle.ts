import type { PlaybackController } from '@/lib/playback/controllerTypes';
import type { Cancel, PlaybackClock } from '@/lib/playback/ports';

export interface BrowserLifecycleOptions {
  clock: PlaybackClock;
  doc?: Document;
  win?: Window;
  nav?: Navigator;
  createWorker?: (scriptUrl: string) => Worker | null;
}

export function bindBrowserLifecycle(
  controller: PlaybackController,
  options: BrowserLifecycleOptions
): Cancel {
  const doc =
    options.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const win =
    options.win ?? (typeof window !== 'undefined' ? window : undefined);
  const nav =
    options.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);

  const cleanups: Cancel[] = [];
  let worker: Worker | null = null;

  const setDocumentHiddenAttr = (hidden: boolean) => {
    if (!doc?.documentElement) return;
    if (hidden) {
      doc.documentElement.setAttribute('data-tab-hidden', 'true');
    } else {
      doc.documentElement.removeAttribute('data-tab-hidden');
    }
  };

  const setDocumentBufferingAttr = (buffering: boolean) => {
    if (!doc?.documentElement) return;
    if (buffering) {
      doc.documentElement.setAttribute('data-buffering', 'true');
    } else {
      doc.documentElement.removeAttribute('data-buffering');
    }
  };

  const initialHidden = Boolean(doc?.hidden);
  setDocumentHiddenAttr(initialHidden);
  setDocumentBufferingAttr(controller.getSnapshot().isBuffering);

  const createWorkerFn =
    options.createWorker ??
    ((url: string) => {
      try {
        return typeof Worker !== 'undefined' ? new Worker(url) : null;
      } catch {
        return null;
      }
    });

  try {
    worker = createWorkerFn('/backgroundCompletionWorker.js');
    if (worker) {
      worker.onmessage = (event: MessageEvent) => {
        if (event.data === 'tick') {
          controller.checkBackgroundCompletion();
        }
      };
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
      };
      worker.postMessage(initialHidden ? 'start' : 'stop');
    }
  } catch {
    worker = null;
  }

  const cancelHeartbeat = options.clock.every(1500, () => {
    controller.checkBackgroundCompletion();
  });
  cleanups.push(cancelHeartbeat);

  let cancelKeepAlive: Cancel | null = null;
  let lastPlaying = false;
  let lastBuffering = controller.getSnapshot().isBuffering;

  const pingServiceWorker = () => {
    try {
      nav?.serviceWorker?.controller?.postMessage({ type: 'KEEP_ALIVE' });
    } catch {
      // Ignore SW postMessage errors
    }
  };

  const syncFromSnapshot = () => {
    const snap = controller.getSnapshot();
    if (snap.isBuffering !== lastBuffering) {
      lastBuffering = snap.isBuffering;
      setDocumentBufferingAttr(snap.isBuffering);
    }
    if (snap.isPlaying !== lastPlaying) {
      lastPlaying = snap.isPlaying;
      if (cancelKeepAlive) {
        cancelKeepAlive();
        cancelKeepAlive = null;
      }
      if (snap.isPlaying) {
        pingServiceWorker();
        cancelKeepAlive = options.clock.every(20000, pingServiceWorker);
      }
    }
  };

  syncFromSnapshot();
  cleanups.push(controller.subscribe(syncFromSnapshot));

  if (doc) {
    const onVisibilityChange = () => {
      const hidden = Boolean(doc.hidden);
      setDocumentHiddenAttr(hidden);
      worker?.postMessage(hidden ? 'start' : 'stop');
      controller.handleVisibilityChange(hidden);
    };
    doc.addEventListener('visibilitychange', onVisibilityChange);
    cleanups.push(() =>
      doc.removeEventListener('visibilitychange', onVisibilityChange)
    );
  }

  if (win) {
    const onPageHide = () => {
      controller.handlePageHide();
    };
    const onUserActivation = () => {
      controller.handleUserActivation();
    };

    win.addEventListener('pagehide', onPageHide);
    win.addEventListener('beforeunload', onPageHide);
    win.addEventListener('pointerdown', onUserActivation, { passive: true });
    win.addEventListener('keydown', onUserActivation, { passive: true });

    cleanups.push(() => {
      win.removeEventListener('pagehide', onPageHide);
      win.removeEventListener('beforeunload', onPageHide);
      win.removeEventListener('pointerdown', onUserActivation);
      win.removeEventListener('keydown', onUserActivation);
    });
  }

  return () => {
    if (cancelKeepAlive) {
      cancelKeepAlive();
      cancelKeepAlive = null;
    }
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups.length = 0;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
    }
    setDocumentHiddenAttr(false);
    setDocumentBufferingAttr(false);
  };
}
