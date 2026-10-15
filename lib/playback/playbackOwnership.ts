import type { PlaybackOwner } from './ports';

export interface PlaybackOwnershipManager {
  issueRequest(trackId: string): PlaybackOwner;
  restoreOwner(trackId: string): PlaybackOwner;
  setOwnerTrack(trackId: string): PlaybackOwner | null;
  getOwner(): PlaybackOwner | null;
  getRequestId(): number;
  isCurrentOwner(owner: PlaybackOwner, activeTrackId?: string | null): boolean;
  isCurrentRequest(requestId: number, trackId?: string | null): boolean;
  nextToggle(desired: 'playing' | 'paused'): number;
  bumpToggle(): number;
  isCurrentToggle(actionId: number, desired: 'playing' | 'paused'): boolean;
  setDesiredState(desired: 'playing' | 'paused' | null): void;
  getDesiredState(): 'playing' | 'paused' | null;
  beginFallbackSignal(): AbortSignal;
  abortFallback(): void;
}

export function createPlaybackOwnership(): PlaybackOwnershipManager {
  let requestId = 0;
  let generation = 0;
  let toggleId = 0;
  let desiredState: 'playing' | 'paused' | null = null;
  let current: PlaybackOwner | null = null;
  let fallbackController: AbortController | null = null;

  const abortFallback = () => {
    if (fallbackController) {
      fallbackController.abort();
      fallbackController = null;
    }
  };

  return {
    issueRequest(trackId: string): PlaybackOwner {
      abortFallback();
      requestId += 1;
      generation += 1;
      toggleId += 1;
      current = {
        requestId,
        generation,
        trackId,
      };
      return { ...current };
    },
    restoreOwner(trackId: string): PlaybackOwner {
      current = {
        requestId,
        generation,
        trackId,
      };
      return { ...current };
    },
    setOwnerTrack(trackId: string): PlaybackOwner | null {
      if (!current) {
        current = { requestId, generation, trackId };
      } else {
        current = { ...current, trackId };
      }
      return { ...current };
    },
    getOwner(): PlaybackOwner | null {
      return current ? { ...current } : null;
    },
    getRequestId(): number {
      return requestId;
    },
    isCurrentOwner(owner: PlaybackOwner, activeTrackId?: string | null): boolean {
      if (!current) return false;
      if (
        current.requestId !== owner.requestId ||
        current.generation !== owner.generation ||
        current.trackId !== owner.trackId
      ) {
        return false;
      }
      if (activeTrackId !== undefined && activeTrackId !== owner.trackId) {
        return false;
      }
      return true;
    },
    isCurrentRequest(targetRequestId: number, trackId?: string | null): boolean {
      if (!current || current.requestId !== targetRequestId) return false;
      if (trackId !== undefined && trackId !== null && current.trackId !== trackId) {
        return false;
      }
      return true;
    },
    nextToggle(desired: 'playing' | 'paused'): number {
      desiredState = desired;
      toggleId += 1;
      return toggleId;
    },
    bumpToggle(): number {
      toggleId += 1;
      return toggleId;
    },
    isCurrentToggle(actionId: number, desired: 'playing' | 'paused'): boolean {
      return actionId === toggleId && desiredState === desired;
    },
    setDesiredState(desired: 'playing' | 'paused' | null): void {
      desiredState = desired;
    },
    getDesiredState(): 'playing' | 'paused' | null {
      return desiredState;
    },
    beginFallbackSignal(): AbortSignal {
      abortFallback();
      fallbackController = new AbortController();
      return fallbackController.signal;
    },
    abortFallback,
  };
}
