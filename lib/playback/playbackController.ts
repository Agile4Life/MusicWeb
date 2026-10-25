import type { Track } from '@/types';
import { decideSmartFill, shouldRecordSkip } from '@/lib/playbackDecisions';
import { isAbortError, SupersedableRequest } from '@/lib/prewarmPlan';
import { inferTrackSource } from '@/lib/trackSourceClassifier';
import { deduplicateQueueTracks } from '@/lib/utils';
import { createCompletionCoordinator } from './completionCoordinator';
import type {
  PlaybackController,
  PlaybackControllerDeps,
  RepeatMode,
} from './controllerTypes';
import { createPlaybackOwnership } from './playbackOwnership';
import {
  createPlaybackStateStore,
  DEFAULT_PLAYBACK_VOLUME,
} from './playbackState';
import type { Cancel, PlaybackEvent, PlaybackOwner, PreparedPlayback } from './ports';
import { createQueueController } from './queueController';
import {
  AUDIO_STALL_WATCHDOG_TIMEOUT_MS,
  createRecoveryPolicy,
  MAX_CONSECUTIVE_SKIPS,
  NCT_RETRY_RACE_TIMEOUT_MS,
} from './recoveryPolicy';

function isInterruptionError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string })?.name;
  const msg = String((err as { message?: string })?.message || err);
  return name === 'AbortError' || msg.includes('interrupted');
}

function isNotAllowedError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: string })?.name;
  const msg = String((err as { message?: string })?.message || err).toLowerCase();
  return name === 'NotAllowedError' || msg.includes('not allowed');
}

function resolveEffectiveDuration(
  reportedDuration: number,
  trackDuration: number | undefined,
  fallbackDuration: number
): number {
  if (!(reportedDuration > 0 && Number.isFinite(reportedDuration))) {
    return fallbackDuration;
  }
  const knownTrackDuration =
    typeof trackDuration === 'number' && Number.isFinite(trackDuration)
      ? trackDuration
      : 0;
  // Guard against fragmented MP4 (fMP4) streams whose initial sidx box reports
  // only the first ~10s segment duration for a full-length track (>45s).
  if (
    knownTrackDuration > 45 &&
    reportedDuration < Math.min(35, knownTrackDuration * 0.5)
  ) {
    return Math.max(reportedDuration, knownTrackDuration, fallbackDuration);
  }
  return reportedDuration;
}

export function createPlaybackController(
  deps: PlaybackControllerDeps
): PlaybackController {
  const store = createPlaybackStateStore();
  const ownership = createPlaybackOwnership();
  const queueController = createQueueController();
  const completion = createCompletionCoordinator(deps.clock);
  const recovery = createRecoveryPolicy(MAX_CONSECUTIVE_SKIPS);
  const smartFillAbort = new SupersedableRequest();
  const canUseYouTubeIframe = () => deps.canUseYouTubeIframe?.() ?? true;

  let disposed = false;
  let tabHidden = false;
  let activeEngine: 'html5' | 'youtube' = 'html5';
  let activeTargetUrl = '';
  let activeTransportOwner: PlaybackOwner | null = null;
  let ytHtml5Mode = false;
  let inFlightErrorRequestId: number | null = null;
  let pendingSeek: number | null = null;
  let pendingResume = false;
  let isErrorAutoSkip = false;
  let hasPrewarmedNextTrack = false;
  let nextTrackEndPrewarmed = false;
  let lastSavedTime = 0;
  let smartFillSeedId: string | null = null;
  let activeQueueRequestId = 0;
  let youtubeBgPauseRetries = 0;
  let html5BgPauseRetries = 0;
  const ytHtml5FallbackAttempted = new Set<number>();

  let cancelStallWatchdog: Cancel | null = null;
  let cancelAutoSkipTimer: Cancel | null = null;

  const clearStallWatchdog = () => {
    if (cancelStallWatchdog) {
      cancelStallWatchdog();
      cancelStallWatchdog = null;
    }
  };

  const clearAutoSkipTimer = () => {
    if (cancelAutoSkipTimer) {
      cancelAutoSkipTimer();
      cancelAutoSkipTimer = null;
    }
  };

  const clearTimers = () => {
    clearStallWatchdog();
    clearAutoSkipTimer();
    completion.clearNearEndWatchdog();
  };

  const saveState = (
    immediate = false,
    override?: {
      track?: Track | null;
      currentTime?: number;
      queue?: Track[];
      currentIndex?: number;
      volume?: number;
    }
  ) => {
    const snap = store.getSnapshot();
    const prog = store.getProgress();
    const track = override?.track !== undefined ? override.track : snap.currentTrack;
    if (!track) return;
    deps.persistence.save(
      {
        track,
        currentTime:
          override?.currentTime !== undefined
            ? override.currentTime
            : prog.currentTime,
        queue: override?.queue !== undefined ? override.queue : snap.queue,
        currentIndex:
          override?.currentIndex !== undefined
            ? override.currentIndex
            : snap.currentIndex,
        volume: override?.volume !== undefined ? override.volume : snap.volume,
      },
      immediate
    );
  };

  const getActiveTime = (): number => {
    const read = deps.transport.read();
    return read.time > 0 ? read.time : store.getProgress().currentTime;
  };

  const recordSkipOfCurrent = (nextTrackId: string) => {
    const prev = store.getSnapshot().currentTrack;
    if (!prev || prev.id === nextTrackId) return;
    const activeTime = getActiveTime();
    if (shouldRecordSkip({ activeTime, duration: prev.duration })) {
      deps.userEffects.recordListen(prev, false, activeTime);
    }
  };

  const triggerSmartQueueFill = async (seedTrack: Track, currentQ: Track[]) => {
    if (disposed || !seedTrack) return;
    const snap = store.getSnapshot();
    if (
      decideSmartFill({
        inflightSeedId: smartFillSeedId,
        seedId: seedTrack.id,
        repeatMode: snap.repeatMode,
      }) === 'skip'
    ) {
      return;
    }
    smartFillSeedId = seedTrack.id;
    const signal = smartFillAbort.begin();
    const requestId = ++activeQueueRequestId;
    try {
      const recs = await deps.userEffects.recommend(seedTrack, currentQ, signal);
      if (disposed || requestId !== activeQueueRequestId) return;
      if (store.getSnapshot().currentTrack?.id !== seedTrack.id) return;
      if (recs && recs.length > 0) {
        const latestQueue = store.getSnapshot().queue;
        const merged = deduplicateQueueTracks([...latestQueue, ...recs]);
        store.patch({ queue: merged });
      }
    } catch (err) {
      if (!isAbortError(err)) {
        console.warn('Smart queue auto-fill error:', err);
      }
    } finally {
      if (requestId === activeQueueRequestId) {
        smartFillSeedId = null;
      }
    }
  };

  const scheduleErrorAutoSkip = (requestId: number, delayMs: number) => {
    clearAutoSkipTimer();
    cancelAutoSkipTimer = deps.clock.after(delayMs, () => {
      cancelAutoSkipTimer = null;
      if (
        disposed ||
        !ownership.isCurrentRequest(requestId) ||
        ownership.getDesiredState() === 'paused'
      ) {
        return;
      }
      isErrorAutoSkip = true;
      try {
        nextTrack();
      } finally {
        isErrorAutoSkip = false;
      }
    });
  };

  const handleUnrecoverableFailure = (
    owner: PlaybackOwner,
    track: Track,
    options?: { errorMessage?: string; isYouTube?: boolean }
  ) => {
    if (
      disposed ||
      !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id)
    ) {
      return;
    }
    if (ownership.getDesiredState() === 'paused') {
      store.patch({ isPlaying: false, isBuffering: false });
      return;
    }
    const snap = store.getSnapshot();
    const outcome = recovery.recordUnrecoverableFailure({
      trackTitle: track.title,
      queueLength: snap.queue.length,
      autoPlayNext: snap.autoPlayNext,
      repeatMode: snap.repeatMode,
      errorMessage: options?.errorMessage,
      isYouTube: options?.isYouTube,
    });
    store.patch({
      isPlaying: false,
      isBuffering: false,
      playbackError: outcome.error,
    });
    if (outcome.shouldAutoSkip) {
      scheduleErrorAutoSkip(owner.requestId, outcome.autoSkipDelayMs);
    }
  };

  const isPlaybackWanted = (owner: PlaybackOwner) =>
    !disposed &&
    ownership.getDesiredState() === 'playing' &&
    ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id);

  const executePreparedPlayback = async (
    prepared: PreparedPlayback,
    owner: PlaybackOwner,
    originalTrack: Track,
    options?: { isFallback?: boolean }
  ): Promise<boolean> => {
    if (disposed || !ownership.isCurrentRequest(owner.requestId)) return false;
    if (prepared.engine === 'youtube' && !canUseYouTubeIframe()) {
      throw new Error('A native audio stream is required on this device');
    }

    const syncedTrack: Track = {
      ...prepared.track,
      id: originalTrack.id,
    };
    const nextOwner = ownership.setOwnerTrack(syncedTrack.id) ?? owner;

    const currentQ = store.getSnapshot().queue;
    const syncedQueue = queueController.mergeResolvedTrack(currentQ, syncedTrack);
    store.patch({
      currentTrack: syncedTrack,
      queue: syncedQueue,
      playbackError: null,
    });

    const targetStartTime =
      pendingSeek !== null
        ? (() => {
            const seekTime = pendingSeek;
            pendingSeek = null;
            return seekTime;
          })()
        : prepared.initialTime;

    lastSavedTime = targetStartTime;
    saveState(true, {
      track: syncedTrack,
      currentTime: targetStartTime,
      queue: syncedQueue,
    });

    activeEngine = prepared.engine;
    activeTargetUrl = prepared.target;
    activeTransportOwner = { ...nextOwner };
    ytHtml5Mode =
      prepared.engine === 'html5' &&
      (syncedTrack.source === 'youtube' || Boolean(syncedTrack.youtube_id));

    const targetPlayback: PreparedPlayback = {
      ...prepared,
      track: syncedTrack,
      initialTime: targetStartTime,
    };

    if (ownership.getDesiredState() === 'paused') {
      await deps.transport
        .start(targetPlayback, nextOwner, store.getSnapshot().volume, 'paused')
        .catch(() => {});
      if (ownership.isCurrentOwner(nextOwner, store.getSnapshot().currentTrack?.id)) {
        store.patch({ isPlaying: false, isBuffering: false });
      }
      return false;
    }

    try {
      await deps.transport.start(
        targetPlayback,
        nextOwner,
        store.getSnapshot().volume,
        'play'
      );
      if (
        disposed ||
        !ownership.isCurrentOwner(nextOwner, store.getSnapshot().currentTrack?.id)
      ) {
        return false;
      }
      if (ownership.getDesiredState() === 'paused') {
        deps.transport.pause();
        store.patch({ isPlaying: false, isBuffering: false });
        return false;
      }
      completion.reset();
      if (targetPlayback.engine === 'html5') {
        recovery.resetConsecutiveSkips();
      }
      pendingResume = false;
      store.patch({
        isPlaying: true,
        isBuffering: false,
        playbackError: null,
      });
      if (!options?.isFallback) {
        deps.userEffects.recordHistory(originalTrack);
        const snap = store.getSnapshot();
        deps.sources.prewarmUpcoming(
          snap.queue,
          snap.currentIndex,
          snap.repeatMode,
          { tabHidden }
        );
        if (tabHidden) {
          hasPrewarmedNextTrack = true;
        }
      }
      return true;
    } catch (err) {
      if (
        disposed ||
        !ownership.isCurrentOwner(nextOwner, store.getSnapshot().currentTrack?.id)
      ) {
        return false;
      }
      if (ownership.getDesiredState() === 'paused') {
        store.patch({ isPlaying: false, isBuffering: false });
        return false;
      }
      if (isInterruptionError(err) || isNotAllowedError(err)) {
        pendingResume = true;
        store.patch({ isPlaying: false, isBuffering: false });
        return false;
      }
      if (activeTransportOwner?.requestId === nextOwner.requestId) {
        activeTransportOwner = null;
      }
      throw err;
    }
  };

  const runFallbackToYouTube = async (
    track: Track,
    owner: PlaybackOwner,
    preSearched?: Track | null
  ): Promise<void> => {
    if (
      disposed ||
      !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id) ||
      ownership.getDesiredState() === 'paused'
    ) {
      return;
    }
    if (recovery.isFallbackInProgress(owner.requestId)) {
      return;
    }

    const transportState = deps.transport.read();
    if (
      transportState.playing &&
      activeEngine === 'html5' &&
      activeTransportOwner !== null &&
      ownership.isCurrentOwner(activeTransportOwner, track.id)
    ) {
      return;
    }

    recovery.beginFallback(owner.requestId);
    store.patch({ isBuffering: true });

    try {
      const currentTime = getActiveTime();
      const fallbackPrepared = await deps.sources.resolveFallback(
        track,
        currentTime,
        preSearched
      );
      if (
        disposed ||
        !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id)
      ) {
        return;
      }
      if (!fallbackPrepared) {
        handleUnrecoverableFailure(owner, track);
        return;
      }

      const tryIosHtml5ToYoutubeFallback = async (
        candidate: PreparedPlayback
      ): Promise<boolean> => {
        const ytId = candidate.track.youtube_id;
        if (candidate.engine === 'html5' && ytId) {
          try {
            await executePreparedPlayback(
              {
                track: candidate.track,
                engine: 'youtube',
                target: ytId,
                initialTime: candidate.initialTime,
              },
              owner,
              track,
              { isFallback: true }
            );
            return true;
          } catch {
            return false;
          }
        }
        return false;
      };

      try {
        await executePreparedPlayback(fallbackPrepared, owner, track, {
          isFallback: true,
        });
      } catch {
        if (
          disposed ||
          !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id)
        ) {
          return;
        }
        if (ownership.getDesiredState() === 'paused') {
          store.patch({ isPlaying: false, isBuffering: false });
          return;
        }

        // If an alternate NCT or SoundCloud fallback stream failed, continue to the YouTube candidate
        if (
          fallbackPrepared.track.source === 'nhaccuatui' ||
          Boolean(fallbackPrepared.track.nhaccuatui_id) ||
          fallbackPrepared.track.source === 'soundcloud' ||
          Boolean(fallbackPrepared.track.soundcloud_id)
        ) {
          const ytFallback = await deps.sources.resolveFallback(
            fallbackPrepared.track,
            getActiveTime(),
            preSearched
          );
          if (
            disposed ||
            !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id)
          ) {
            return;
          }
          if (ownership.getDesiredState() === 'paused') {
            store.patch({ isPlaying: false, isBuffering: false });
            return;
          }
          if (ytFallback) {
            try {
              await executePreparedPlayback(ytFallback, owner, track, {
                isFallback: true,
              });
              return;
            } catch {
              if (
                disposed ||
                !ownership.isCurrentOwner(
                  owner,
                  store.getSnapshot().currentTrack?.id
                )
              ) {
                return;
              }
              if (await tryIosHtml5ToYoutubeFallback(ytFallback)) {
                return;
              }
            }
          }
          handleUnrecoverableFailure(owner, track);
          return;
        }

        if (await tryIosHtml5ToYoutubeFallback(fallbackPrepared)) {
          return;
        }
        handleUnrecoverableFailure(owner, track);
      }
    } finally {
      recovery.endFallback(owner.requestId);
    }
  };

  const switchYouTubeToHtml5InBackground = async (
    owner: PlaybackOwner,
    track: Track,
    resumeTime: number
  ): Promise<void> => {
    if (
      disposed ||
      !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id) ||
      ownership.getDesiredState() !== 'playing' ||
      recovery.isFallbackInProgress(owner.requestId)
    ) {
      return;
    }
    recovery.beginFallback(owner.requestId);
    try {
      const html5Prepared = await deps.sources.resolveFallback(
        track,
        resumeTime,
        undefined,
        { preferHtml5: true }
      );
      if (
        disposed ||
        !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id) ||
        ownership.getDesiredState() !== 'playing'
      ) {
        return;
      }
      if (html5Prepared && html5Prepared.engine === 'html5') {
        await executePreparedPlayback(html5Prepared, owner, track, {
          isFallback: true,
        });
      }
    } catch {
      // Keep current track state if background HTML5 switch fails;
      // foreground visibility restore can still resume YouTube iframe.
    } finally {
      recovery.endFallback(owner.requestId);
    }
  };

  const armStallWatchdog = (owner: PlaybackOwner) => {
    if (cancelStallWatchdog) return;
    cancelStallWatchdog = deps.clock.after(
      AUDIO_STALL_WATCHDOG_TIMEOUT_MS,
      async () => {
        cancelStallWatchdog = null;
        if (
          disposed ||
          !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id)
        ) {
          return;
        }
        const current = store.getSnapshot().currentTrack;
        if (!current) return;
        if (ownership.getDesiredState() === 'paused') {
          store.patch({ isBuffering: false });
          return;
        }

        const decision = recovery.decideStall({
          requestId: owner.requestId,
          track: current,
        });
        if (decision.type === 'ignore') return;

        if (decision.type === 'refresh-soundcloud') {
          try {
            const refreshed = await deps.sources.refreshStream(
              current,
              getActiveTime()
            );
            if (
              disposed ||
              !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id) ||
              ownership.getDesiredState() === 'paused'
            ) {
              return;
            }
            if (refreshed) {
              await executePreparedPlayback(refreshed, owner, current, {
                isFallback: true,
              });
            }
          } catch {
            // Ignore stall refresh failure
          }
          return;
        }

        const preSearched = await deps.sources.searchYouTubeCandidate(current);
        if (
          disposed ||
          !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id)
        ) {
          return;
        }
        if (deps.transport.read().playing) {
          store.patch({ isBuffering: false, isPlaying: true });
          return;
        }
        await runFallbackToYouTube(current, owner, preSearched);
      }
    );
  };

  const triggerCompletion = (reason: string) => {
    clearStallWatchdog();
    const snap = store.getSnapshot();
    const owner = ownership.getOwner();
    if (!snap.currentTrack || !owner) return;

    const action = completion.complete({
      trackId: snap.currentTrack.id,
      requestId: owner.requestId,
      reason,
      desiredState: ownership.getDesiredState(),
      repeatMode: snap.repeatMode,
      autoPlayNext: snap.autoPlayNext,
      isShuffle: snap.isShuffle,
      currentIndex: snap.currentIndex,
      queueLength: snap.queue.length,
      consecutiveSkips: recovery.getConsecutiveSkips(),
      maxConsecutiveSkips: MAX_CONSECUTIVE_SKIPS,
    });

    if (action.action === 'ignore') return;
    if (action.action === 'circuit-breaker') {
      store.patch({ isPlaying: false });
      return;
    }

    deps.userEffects.recordListen(snap.currentTrack, true);

    if (action.action === 'repeat-one') {
      if (activeEngine === 'youtube') {
        void playTrack(snap.currentTrack);
      } else {
        deps.transport.seek(0);
        void deps.transport
          .resume()
          .then(() => {
            if (isPlaybackWanted(owner)) {
              completion.reset();
              store.patch({ isPlaying: true });
            }
          })
          .catch(() => {});
      }
      return;
    }

    if (action.action === 'next') {
      nextTrack();
      return;
    }

    store.patch({ isPlaying: false });
  };

  const handleTransportError = async (owner: PlaybackOwner, rawError: unknown) => {
    clearStallWatchdog();
    const snap = store.getSnapshot();
    const current = snap.currentTrack;
    if (
      !current ||
      !ownership.isCurrentOwner(owner, current.id) ||
      recovery.isFallbackInProgress(owner.requestId) ||
      inFlightErrorRequestId === owner.requestId
    ) {
      return;
    }

    if (activeEngine === 'youtube') {
      // Ignore late HTML5 MediaError objects that arrive after switching to YouTube IFrame
      if (
        typeof rawError === 'object' &&
        rawError !== null &&
        'message' in rawError &&
        !('data' in rawError)
      ) {
        return;
      }
      const errorCode =
        typeof rawError === 'number'
          ? rawError
          : (rawError as { code?: number; data?: number })?.data ??
            (rawError as { code?: number })?.code;
      const ytDecision = recovery.decideYouTubeError({
        requestId: owner.requestId,
        errorCode,
      });

      if (ytDecision.invalidate) {
        await deps.sources.invalidateTrack(current);
        if (
          disposed ||
          !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id) ||
          ownership.getDesiredState() === 'paused'
        ) {
          return;
        }
      }

      if (ytDecision.type === 'retry-youtube-alternate') {
        const alternate = await deps.sources.resolveYouTubeAlternate(
          current,
          getActiveTime()
        );
        if (
          disposed ||
          !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id) ||
          ownership.getDesiredState() === 'paused'
        ) {
          return;
        }
        if (alternate) {
          try {
            await executePreparedPlayback(
              alternate,
              owner,
              current,
              { isFallback: true }
            );
            return;
          } catch {
            // Fall through to failure
          }
        }
      }

      if (!ytHtml5FallbackAttempted.has(owner.requestId)) {
        ytHtml5FallbackAttempted.add(owner.requestId);
        if (ytHtml5FallbackAttempted.size > 50) {
          const oldest = ytHtml5FallbackAttempted.values().next().value;
          if (oldest !== undefined) ytHtml5FallbackAttempted.delete(oldest);
        }
        inFlightErrorRequestId = owner.requestId;
        try {
          const html5Fallback = await deps.sources.resolveFallback(
            current,
            getActiveTime(),
            undefined,
            { preferHtml5: true }
          );
          if (
            disposed ||
            !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id) ||
            ownership.getDesiredState() === 'paused'
          ) {
            return;
          }
          if (html5Fallback) {
            try {
              await executePreparedPlayback(
                html5Fallback,
                owner,
                current,
                { isFallback: true }
              );
              return;
            } catch {
              // Fall through to failure
            }
          }
        } finally {
          if (inFlightErrorRequestId === owner.requestId) {
            inFlightErrorRequestId = null;
          }
        }
      }

      handleUnrecoverableFailure(owner, current, {
        errorMessage: ytDecision.type === 'fail' ? ytDecision.message : undefined,
        isYouTube: true,
      });
      return;
    }

    inFlightErrorRequestId = owner.requestId;
    try {
      const hadFallbackBeforeError = recovery.hasAttemptedFallback(owner.requestId);
      // A failed YouTube proxy does not invalidate a different catalog source
      // that was prepared concurrently for this track.
      if (!ytHtml5Mode) await deps.sources.invalidateTrack(current);
      if (
        disposed ||
        !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id)
      ) {
        return;
      }
      if (ownership.getDesiredState() === 'paused') {
        store.patch({ isBuffering: false });
        return;
      }
      if (
        (activeEngine as string) === 'youtube' ||
        recovery.isFallbackInProgress(owner.requestId) ||
        (!hadFallbackBeforeError && recovery.hasAttemptedFallback(owner.requestId)) ||
        deps.transport.read().playing
      ) {
        return;
      }

      const decision = recovery.decideHtml5Error({
        requestId: owner.requestId,
        track: current,
        currentSrc: activeTargetUrl,
        isIosYouTubeProxy: ytHtml5Mode,
      });

      if (decision.type === 'ignore') return;

      if (decision.type === 'switch-to-youtube-iframe') {
        const resumeTime = Math.floor(getActiveTime());
        const failedSrc = activeTargetUrl;
        const safeResume = resumeTime >= 3 ? resumeTime : 0;
        try {
          const html5Alt = await deps.sources.resolveFallback(
            current,
            safeResume,
            undefined,
            { preferHtml5: true }
          );
          if (
            disposed ||
            !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id)
          ) {
            return;
          }
          if (ownership.getDesiredState() === 'paused') {
            store.patch({ isPlaying: false, isBuffering: false });
            return;
          }
          const isSameFailingYtProxy =
            !html5Alt ||
            html5Alt.engine !== 'html5' ||
            html5Alt.target === failedSrc ||
            (html5Alt.track.source === 'youtube' &&
              (html5Alt.track.youtube_id || decision.videoId) === decision.videoId);
          if (!isSameFailingYtProxy) {
            await executePreparedPlayback(
              html5Alt,
              owner,
              current,
              { isFallback: true }
            );
            return;
          }
        } catch {
          if (
            disposed ||
            !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id)
          ) {
            return;
          }
        }

        ytHtml5Mode = false;
        try {
          await executePreparedPlayback(
            {
              track: current,
              engine: 'youtube',
              target: decision.videoId,
              initialTime: safeResume,
            },
            owner,
            current,
            { isFallback: true }
          );
        } catch {
          handleUnrecoverableFailure(owner, current, { isYouTube: true });
        }
        return;
      }

      if (decision.type === 'retry-nct-proxy') {
        const searchPromise = deps.sources.searchYouTubeCandidate(current);
        const savedTime = getActiveTime();
        store.patch({ isBuffering: true });

        let nctSucceeded = false;
        let cancelTimeout: Cancel | undefined;
        try {
          await Promise.race([
            executePreparedPlayback(
              {
                track: current,
                engine: 'html5',
                target: decision.fallbackUrl,
                initialTime: savedTime >= 3 ? savedTime : 0,
              },
              owner,
              current,
              { isFallback: true }
            ).then((ok) => {
              nctSucceeded = ok;
            }),
            new Promise<void>((resolve) => {
              cancelTimeout = deps.clock.after(NCT_RETRY_RACE_TIMEOUT_MS, resolve);
            }),
          ]);
        } catch {
          recovery.markNctRetryAborted(owner.requestId);
        } finally {
          cancelTimeout?.();
        }

        if (
          !nctSucceeded &&
          ownership.getDesiredState() === 'playing' &&
          ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id) &&
          !recovery.isFallbackInProgress(owner.requestId)
        ) {
          const preSearched = await searchPromise;
          await runFallbackToYouTube(current, owner, preSearched);
        }
        return;
      }

      if (decision.type === 'retry-soundcloud-fresh') {
        const fresh = await deps.sources.refreshStream(current, getActiveTime());
        if (
          disposed ||
          !ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id)
        ) {
          return;
        }
        if (ownership.getDesiredState() === 'paused') {
          store.patch({ isBuffering: false });
          return;
        }
        if (!fresh) {
          await runFallbackToYouTube(current, owner);
          return;
        }
        try {
          await executePreparedPlayback(fresh, owner, current, {
            isFallback: true,
          });
        } catch {
          if (ownership.isCurrentOwner(owner, store.getSnapshot().currentTrack?.id)) {
            await runFallbackToYouTube(current, owner);
          }
        }
        return;
      }

      if (decision.type === 'fallback-to-youtube') {
        await runFallbackToYouTube(current, owner);
        return;
      }

      if (recovery.shouldSuppressRapidError(deps.clock.now())) {
        return;
      }

      const mediaErr = rawError as { code?: number; message?: string } | null;
      const errText = `Audio lỗi${mediaErr?.code ? ` (mã ${mediaErr.code})` : ''}: ${
        mediaErr?.message || 'không đọc được file'
      }`;
      store.setProgress({ duration: 0 });
      handleUnrecoverableFailure(owner, current, { errorMessage: errText });
    } finally {
      if (inFlightErrorRequestId === owner.requestId) {
        inFlightErrorRequestId = null;
      }
    }
  };

  const handleTransportEvent = (event: PlaybackEvent) => {
    if (disposed) return;
    const snap = store.getSnapshot();
    if (!ownership.isCurrentOwner(event.owner, snap.currentTrack?.id)) {
      return;
    }

    switch (event.type) {
      case 'playing': {
        clearStallWatchdog();
        if (ownership.getDesiredState() === 'paused') {
          deps.transport.pause();
          store.patch({ isPlaying: false, isBuffering: false });
          return;
        }
        recovery.resetConsecutiveSkips();
        completion.reset();
        store.patch({
          isPlaying: true,
          isBuffering: false,
          playbackError: null,
        });
        const live = deps.transport.read();
        if (live.duration > 0) {
          const prevProg = store.getProgress();
          const effectiveDur = resolveEffectiveDuration(
            live.duration,
            snap.currentTrack?.duration,
            prevProg.duration
          );
          store.setProgress({ duration: effectiveDur }, { silent: tabHidden });
        }
        return;
      }

      case 'paused': {
        clearStallWatchdog();
        const prog = store.getProgress();
        const live = deps.transport.read();
        const time = live.time || prog.currentTime;
        const duration = resolveEffectiveDuration(
          live.duration,
          snap.currentTrack?.duration,
          prog.duration
        );
        if (
          completion.shouldCompleteOnHtml5Pause({
            desiredState: ownership.getDesiredState(),
            time,
            duration,
          })
        ) {
          triggerCompletion(
            activeEngine === 'youtube'
              ? 'youtube-pause-at-eof'
              : 'html5-pause-at-eof'
          );
          return;
        }
        if (
          activeEngine === 'youtube' &&
          ownership.getDesiredState() === 'playing'
        ) {
          if (youtubeBgPauseRetries < 2) {
            youtubeBgPauseRetries += 1;
            void deps.transport.resume().catch(() => {});
            return;
          }
          youtubeBgPauseRetries = 0;
          if (snap.currentTrack && tabHidden) {
            void switchYouTubeToHtml5InBackground(
              event.owner,
              snap.currentTrack,
              time
            );
            return;
          }
          if (tabHidden) {
            return;
          }
        }
        if (
          tabHidden &&
          activeEngine === 'html5' &&
          ownership.getDesiredState() === 'playing' &&
          !pendingResume
        ) {
          if (html5BgPauseRetries < 2) {
            html5BgPauseRetries += 1;
            void deps.transport
              .resume()
              .then(() => {
                if (isPlaybackWanted(event.owner)) {
                  store.patch({ isPlaying: true, isBuffering: false });
                }
              })
              .catch(() => {
                if (
                  ownership.isCurrentRequest(event.owner.requestId) &&
                  ownership.getDesiredState() === 'playing'
                ) {
                  pendingResume = true;
                  store.patch({ isPlaying: false, isBuffering: false });
                }
              });
            return;
          }
        }
        store.patch({ isPlaying: false, isBuffering: false });
        return;
      }

      case 'ended': {
        triggerCompletion(
          activeEngine === 'youtube'
            ? 'youtube-native-ended'
            : 'html5-native-ended'
        );
        return;
      }

      case 'time': {
        const prevProg = store.getProgress();
        const nextDur = resolveEffectiveDuration(
          event.duration,
          snap.currentTrack?.duration,
          prevProg.duration
        );
        store.setProgress(
          {
            currentTime: event.time,
            duration: nextDur,
          },
          { silent: tabHidden }
        );
        deps.persistence.updateTime(event.time);

        if (event.time >= 3) {
          if (recovery.getConsecutiveSkips() > 0) {
            recovery.resetConsecutiveSkips();
          }
          if (deps.transport.read().playing) {
            youtubeBgPauseRetries = 0;
            html5BgPauseRetries = 0;
          }
        }

        const triggered = completion.evaluateTimeUpdate({
          engine: activeEngine,
          time: event.time,
          duration: nextDur || (snap.currentTrack?.duration ?? 0),
          onTrigger: (reason) => triggerCompletion(reason),
          readTransportState: () => deps.transport.read(),
        });
        if (triggered) return;

        if (Math.abs(event.time - lastSavedTime) > 15 && snap.currentTrack) {
          lastSavedTime = event.time;
          saveState(false, { currentTime: event.time });
        }

        if (
          !hasPrewarmedNextTrack &&
          event.time >= 5 &&
          !store.getSnapshot().isBuffering
        ) {
          const cur = store.getSnapshot();
          if (
            cur.queue.length > cur.currentIndex + 1 ||
            (cur.repeatMode === 'all' && cur.queue.length > 1)
          ) {
            hasPrewarmedNextTrack = true;
            deps.sources.prewarmNextAdaptive(
              cur.queue,
              cur.currentIndex,
              cur.repeatMode
            );
          }
        }

        if (!nextTrackEndPrewarmed) {
          const effectiveDur = nextDur || (snap.currentTrack?.duration ?? 0);
          if (effectiveDur > 0) {
            const remaining = effectiveDur - event.time;
            if (remaining <= 30 && remaining >= 0) {
              nextTrackEndPrewarmed = true;
              const cur = store.getSnapshot();
              deps.sources.prewarmNearEnd(
                cur.queue,
                cur.currentIndex,
                cur.repeatMode,
                cur.isShuffle
              );
            }
          }
        }
        return;
      }

      case 'buffering': {
        if (event.value) {
          if (ownership.getDesiredState() === 'paused') {
            store.patch({ isBuffering: false });
            return;
          }
          const prog = store.getProgress();
          if (
            activeEngine === 'html5' &&
            completion.shouldCompleteOnBufferNearEnd({
              desiredState: ownership.getDesiredState(),
              time: prog.currentTime,
              duration: prog.duration,
            })
          ) {
            triggerCompletion('html5-waiting-at-eof');
            return;
          }
          store.patch({ isBuffering: true });
          if (activeEngine === 'html5') {
            armStallWatchdog(event.owner);
          }
        } else {
          clearStallWatchdog();
          store.patch({ isBuffering: false });
          if (
            ownership.getDesiredState() === 'playing' &&
            pendingResume &&
            !deps.transport.read().playing
          ) {
            pendingResume = false;
            void deps.transport
              .resume()
              .then(() => {
                if (isPlaybackWanted(event.owner)) {
                  store.patch({ isPlaying: true, isBuffering: false });
                }
              })
              .catch(() => {
                if (
                  ownership.isCurrentRequest(event.owner.requestId) &&
                  ownership.getDesiredState() === 'playing'
                ) {
                  pendingResume = true;
                }
              });
          }
        }
        return;
      }

      case 'error': {
        void handleTransportError(event.owner, event.error);
        return;
      }
    }
  };

  const unsubscribeTransport = deps.transport.subscribe(handleTransportEvent);

  const playTrack = async (
    rawTrack: Track,
    newQueue?: Track[],
    forceIndex?: number,
    startFromTime?: number
  ): Promise<void> => {
    if (disposed) return;
    const track = { ...inferTrackSource(rawTrack) };

    if (!isErrorAutoSkip) {
      recovery.resetConsecutiveSkips();
    }
    nextTrackEndPrewarmed = false;
    hasPrewarmedNextTrack = false;
    pendingSeek = null;
    pendingResume = false;
    youtubeBgPauseRetries = 0;
    html5BgPauseRetries = 0;
    clearTimers();
    completion.reset();

    recordSkipOfCurrent(track.id);

    ownership.setDesiredState('playing');
    const owner = ownership.issueRequest(track.id);

    const prevSnap = store.getSnapshot();
    const queueTransition = queueController.preparePlayTrack({
      track,
      queue: prevSnap.queue,
      currentIndex: prevSnap.currentIndex,
      currentTrack: prevSnap.currentTrack,
      newQueue,
      forceIndex,
    });

    const initialTime =
      typeof startFromTime === 'number' && startFromTime >= 0
        ? startFromTime
        : 0;

    store.patch({
      currentTrack: track,
      queue: queueTransition.queue,
      currentIndex: queueTransition.currentIndex,
      isPlaying: false,
      isBuffering: true,
      playbackError: null,
      mvIntroOffset:
        prevSnap.currentTrack?.id === track.id ? prevSnap.mvIntroOffset : 0,
    });
    store.setProgress({
      currentTime: initialTime,
      duration: track.duration || 0,
    });
    saveState(true, {
      track,
      currentTime: initialTime,
      queue: queueTransition.queue,
      currentIndex: queueTransition.currentIndex,
    });

    if (queueTransition.shouldSmartFill) {
      void triggerSmartQueueFill(track, queueTransition.queue);
    }

    // Fast path: check immediate synchronous resolution first
    const immediate = deps.sources.resolveImmediate({
      track,
      initialTime,
      preserveGesture: false,
      tabHidden,
    });

    if (!immediate) {
      ytHtml5Mode = false;
      activeTransportOwner = null;
      activeTargetUrl = '';
      if (!tabHidden || activeEngine === 'youtube') {
        deps.transport.stop();
      }
    }

    const prepared =
      immediate ??
      (await deps.sources.resolvePlayable({
        track,
        initialTime,
        tabHidden,
        signal: ownership.beginFallbackSignal(),
      }));

    if (disposed || !ownership.isCurrentRequest(owner.requestId)) {
      return;
    }

    if (!prepared) {
      if (ownership.getDesiredState() === 'paused') {
        store.patch({ isPlaying: false, isBuffering: false });
        return;
      }
      await runFallbackToYouTube(track, owner);
      return;
    }

    try {
      await executePreparedPlayback(prepared, owner, track);
    } catch {
      if (disposed || !ownership.isCurrentRequest(owner.requestId)) return;
      if (ownership.getDesiredState() === 'paused') {
        store.patch({ isPlaying: false, isBuffering: false });
        return;
      }
      if (
        inFlightErrorRequestId === owner.requestId ||
        recovery.isFallbackInProgress(owner.requestId) ||
        recovery.hasAttemptedFallback(owner.requestId) ||
        (prepared.engine === 'html5' && activeEngine === 'youtube')
      ) {
        return;
      }

      const directYtId =
        prepared.track.youtube_id ||
        (prepared.track.source === 'youtube' ? prepared.target : null);
      if (prepared.engine === 'html5' && directYtId) {
        inFlightErrorRequestId = owner.requestId;
        try {
          try {
            const html5Alt = await deps.sources.resolveFallback(
              prepared.track,
              prepared.initialTime,
              undefined,
              { preferHtml5: true }
            );
            if (disposed || !ownership.isCurrentRequest(owner.requestId)) return;
            if (ownership.getDesiredState() === 'paused') {
              store.patch({ isPlaying: false, isBuffering: false });
              return;
            }
            const isSameFailingYtProxy =
              !html5Alt ||
              html5Alt.engine !== 'html5' ||
              html5Alt.target === prepared.target ||
              (html5Alt.track.source === 'youtube' &&
                (html5Alt.track.youtube_id || directYtId) === directYtId);
            if (!isSameFailingYtProxy) {
              await executePreparedPlayback(
                html5Alt,
                owner,
                track,
                { isFallback: true }
              );
              return;
            }
          } catch {
            if (disposed || !ownership.isCurrentRequest(owner.requestId)) return;
          }

          ytHtml5Mode = false;
          await executePreparedPlayback(
            {
              track: prepared.track,
              engine: 'youtube',
              target: directYtId,
              initialTime: prepared.initialTime,
            },
            owner,
            track
          );
          return;
        } catch {
          handleUnrecoverableFailure(owner, prepared.track, { isYouTube: true });
          return;
        } finally {
          if (inFlightErrorRequestId === owner.requestId) {
            inFlightErrorRequestId = null;
          }
        }
      }

      inFlightErrorRequestId = owner.requestId;
      try {
        await deps.sources.invalidateTrack(prepared.track);
        if (disposed || !ownership.isCurrentRequest(owner.requestId)) return;
        await runFallbackToYouTube(prepared.track, owner);
      } finally {
        if (inFlightErrorRequestId === owner.requestId) {
          inFlightErrorRequestId = null;
        }
      }
    }
  };

  const tryQuickPlayFromCache = (rawTrack: Track, idx?: number): boolean => {
    if (disposed || !rawTrack) return false;
    const immediate = deps.sources.resolveImmediate({
      track: rawTrack,
      initialTime: 0,
      preserveGesture: true,
      tabHidden,
    });
    if (!immediate || immediate.engine !== 'html5') {
      return false;
    }

    const track = immediate.track;
    recordSkipOfCurrent(track.id);
    clearTimers();
    completion.reset();
    ownership.setDesiredState('playing');
    const owner = ownership.issueRequest(track.id);

    nextTrackEndPrewarmed = false;
    hasPrewarmedNextTrack = false;
    pendingSeek = null;
    pendingResume = false;
    youtubeBgPauseRetries = 0;
    html5BgPauseRetries = 0;

    const prevSnap = store.getSnapshot();
    const transition = queueController.preparePlayTrack({
      track,
      queue: prevSnap.queue,
      currentIndex: prevSnap.currentIndex,
      currentTrack: prevSnap.currentTrack,
      forceIndex: typeof idx === 'number' && idx >= 0 ? idx : undefined,
    });
    const syncedQueue = queueController.mergeResolvedTrack(transition.queue, {
      ...track,
      id: rawTrack.id,
    });

    store.patch({
      currentTrack: track,
      queue: syncedQueue,
      currentIndex: transition.currentIndex,
      isPlaying: false,
      isBuffering: true,
      playbackError: null,
      mvIntroOffset:
        prevSnap.currentTrack?.id === track.id ? prevSnap.mvIntroOffset : 0,
    });
    store.setProgress({
      currentTime: 0,
      duration: track.duration || 0,
    });
    saveState(true, {
      track,
      currentTime: 0,
      queue: syncedQueue,
      currentIndex: transition.currentIndex,
    });

    void executePreparedPlayback(immediate, owner, rawTrack).catch(async () => {
      if (
        disposed ||
        !ownership.isCurrentRequest(owner.requestId) ||
        ownership.getDesiredState() === 'paused' ||
        inFlightErrorRequestId === owner.requestId ||
        recovery.isFallbackInProgress(owner.requestId) ||
        recovery.hasAttemptedFallback(owner.requestId) ||
        activeEngine === 'youtube'
      ) {
        return;
      }

      const directYtId =
        track.youtube_id ||
        (track.source === 'youtube' ? immediate.target : null);
      if (immediate.engine === 'html5' && directYtId) {
        inFlightErrorRequestId = owner.requestId;
        try {
          try {
            const html5Alt = await deps.sources.resolveFallback(
              track,
              immediate.initialTime,
              undefined,
              { preferHtml5: true }
            );
            if (disposed || !ownership.isCurrentRequest(owner.requestId)) return;
            if (ownership.getDesiredState() === 'paused') {
              store.patch({ isPlaying: false, isBuffering: false });
              return;
            }
            const isSameFailingYtProxy =
              !html5Alt ||
              html5Alt.engine !== 'html5' ||
              html5Alt.target === immediate.target ||
              (html5Alt.track.source === 'youtube' &&
                (html5Alt.track.youtube_id || directYtId) === directYtId);
            if (!isSameFailingYtProxy) {
              await executePreparedPlayback(
                html5Alt,
                owner,
                rawTrack,
                { isFallback: true }
              );
              return;
            }
          } catch {
            if (disposed || !ownership.isCurrentRequest(owner.requestId)) return;
          }

          ytHtml5Mode = false;
          await executePreparedPlayback(
            {
              track,
              engine: 'youtube',
              target: directYtId,
              initialTime: immediate.initialTime,
            },
            owner,
            rawTrack
          );
          return;
        } catch {
          handleUnrecoverableFailure(owner, track, { isYouTube: true });
          return;
        } finally {
          if (inFlightErrorRequestId === owner.requestId) {
            inFlightErrorRequestId = null;
          }
        }
      }

      inFlightErrorRequestId = owner.requestId;
      try {
        await deps.sources.invalidateTrack(track);
        if (disposed || !ownership.isCurrentRequest(owner.requestId)) return;
        await runFallbackToYouTube(track, owner);
      } finally {
        if (inFlightErrorRequestId === owner.requestId) {
          inFlightErrorRequestId = null;
        }
      }
    });

    return true;
  };

  const playResolvedTrack = (track: Track, index: number) => {
    const targetIdx = index >= 0 ? index : -1;
    if (!tryQuickPlayFromCache(track, targetIdx >= 0 ? targetIdx : undefined)) {
      void playTrack(track, undefined, targetIdx >= 0 ? targetIdx : undefined);
    }
  };

  const nextTrack = () => {
    if (disposed) return;
    if (!isErrorAutoSkip) {
      recovery.resetConsecutiveSkips();
    }
    const snap = store.getSnapshot();
    const decision = queueController.selectNext({
      queue: snap.queue,
      currentIndex: snap.currentIndex,
      currentTrack: snap.currentTrack,
      isShuffle: snap.isShuffle,
    });
    if (decision.action !== 'play') return;

    playResolvedTrack(decision.track, decision.index);
    if (decision.shouldSmartFill) {
      void triggerSmartQueueFill(decision.track, store.getSnapshot().queue);
    }
  };

  const prevTrack = () => {
    if (disposed) return;
    recovery.resetConsecutiveSkips();
    const snap = store.getSnapshot();
    const decision = queueController.selectPrevious({
      queue: snap.queue,
      currentIndex: snap.currentIndex,
      currentTrack: snap.currentTrack,
      isShuffle: snap.isShuffle,
      activeTime: getActiveTime(),
      now: deps.clock.now(),
    });
    if (decision.action === 'none') return;
    if (decision.action === 'restart') {
      seek(0);
      return;
    }
    playResolvedTrack(decision.track, decision.index);
  };

  const seek = (time: number) => {
    if (disposed) return;
    const safeTime = Math.max(0, time);
    store.setProgress({ currentTime: safeTime });
    deps.persistence.updateTime(safeTime);

    const snap = store.getSnapshot();
    if (snap.isBuffering && !deps.transport.read().playing && !activeTargetUrl) {
      pendingSeek = safeTime;
    } else {
      deps.transport.seek(safeTime);
    }

    if (snap.currentTrack) {
      saveState(true, { currentTime: safeTime });
    }
  };

  const pause = () => {
    if (disposed || !store.getSnapshot().currentTrack) return;
    ownership.nextToggle('paused');
    pendingResume = false;
    youtubeBgPauseRetries = 0;
    html5BgPauseRetries = 0;
    clearTimers();
    const pausedTime = getActiveTime();
    deps.transport.pause();
    store.patch({ isPlaying: false, isBuffering: false });
    saveState(true, { currentTime: pausedTime });
  };

  const play = async (): Promise<void> => {
    if (disposed) return;
    const snap = store.getSnapshot();
    if (!snap.currentTrack) return;
    if (
      ownership.getDesiredState() === 'playing' &&
      !pendingResume &&
      (deps.transport.read().playing || snap.isBuffering)
    ) {
      return;
    }

    const actionId = ownership.nextToggle('playing');
    pendingResume = false;
    youtubeBgPauseRetries = 0;
    html5BgPauseRetries = 0;
    clearTimers();
    recovery.resetConsecutiveSkips();
    const currentOwner =
      ownership.getOwner() ?? ownership.issueRequest(snap.currentTrack.id);
    store.patch({ isBuffering: true, playbackError: null });

    try {
      await deps.transport.resume();
      if (disposed || !ownership.isCurrentRequest(currentOwner.requestId)) return;
      if (ownership.getDesiredState() === 'paused') {
        deps.transport.pause();
        store.patch({ isPlaying: false, isBuffering: false });
        return;
      }
      if (!ownership.isCurrentToggle(actionId, 'playing')) return;
      completion.reset();
      store.patch({ isPlaying: true, isBuffering: false });
    } catch (err) {
      if (
        disposed ||
        !ownership.isCurrentRequest(currentOwner.requestId) ||
        !ownership.isCurrentToggle(actionId, 'playing')
      ) {
        return;
      }
      if (isNotAllowedError(err) || isInterruptionError(err)) {
        pendingResume = true;
        store.patch({ isPlaying: false, isBuffering: false });
        return;
      }
      await playTrack(
        snap.currentTrack,
        snap.queue,
        snap.currentIndex,
        store.getProgress().currentTime
      );
    }
  };

  return {
    getSnapshot: () => store.getSnapshot(),
    getProgress: () => store.getProgress(),
    subscribe: (listener) => store.subscribe(listener),
    subscribeProgress: (listener) => store.subscribeProgress(listener),

    async restoreFromPersistence(): Promise<void> {
      if (disposed) return;
      const savedRepeat = deps.persistence.getRepeat();
      store.patch({ repeatMode: savedRepeat });

      const restored = deps.persistence.restore();
      if (!restored || !restored.track) return;

      const restoreReqId = ownership.getRequestId();
      const owner = ownership.restoreOwner(restored.track.id);
      lastSavedTime = restored.currentTime;

      store.patch({
        currentTrack: restored.track,
        queue: restored.queue,
        currentIndex: restored.currentIndex,
        volume: restored.volume,
      });
      store.setProgress({
        currentTime: restored.currentTime,
        duration: restored.track.duration || 0,
      });
      deps.transport.setVolume(restored.volume);

      try {
        const prepared = await deps.sources.hydrateRestoredTrack(
          restored.track,
          restored.currentTime
        );
        if (
          disposed ||
          ownership.getRequestId() !== restoreReqId ||
          ownership.getDesiredState() === 'playing' ||
          deps.transport.read().playing
        ) {
          return;
        }
        if (!prepared) return;
        if (prepared.engine === 'youtube' && !canUseYouTubeIframe()) return;

        const nextOwner = ownership.setOwnerTrack(prepared.track.id) ?? owner;
        activeEngine = prepared.engine;
        activeTargetUrl = prepared.target;
        activeTransportOwner = { ...nextOwner };
        const syncedQueue = queueController.mergeResolvedTrack(
          store.getSnapshot().queue,
          prepared.track
        );
        store.patch({ currentTrack: prepared.track, queue: syncedQueue });
        if (
          prepared.track.source !== restored.track.source ||
          prepared.track.nhaccuatui_id !== restored.track.nhaccuatui_id ||
          prepared.track.youtube_id !== restored.track.youtube_id ||
          prepared.track.soundcloud_id !== restored.track.soundcloud_id
        ) {
          saveState(true, {
            track: prepared.track,
            currentTime: restored.currentTime,
            queue: syncedQueue,
          });
        }
        await deps.transport.start(
          prepared,
          nextOwner,
          restored.volume,
          'paused'
        );
      } catch {
        // Ignore restore hydration errors
      }
    },

    playTrack,
    play,
    pause,

    async playSearchTrack(rawTrack: Track): Promise<void> {
      if (disposed) return;
      const track = inferTrackSource(rawTrack);
      const snap = store.getSnapshot();
      const plan = queueController.prepareSearchTrack({
        track,
        queue: snap.queue,
        currentIndex: snap.currentIndex,
      });
      await playTrack(plan.track, plan.newQueue, plan.forceIndex);
    },

    async togglePlay(): Promise<void> {
      if (disposed) return;
      const snap = store.getSnapshot();
      if (!snap.currentTrack) return;

      const live = deps.transport.read();
      const isCurrentlyActive =
        !pendingResume &&
        (snap.isPlaying || live.playing || snap.isBuffering) &&
        ownership.getDesiredState() !== 'paused';

      if (isCurrentlyActive) {
        pause();
        return;
      }
      await play();
    },

    seek,

    setVolume(val: number) {
      if (disposed) return;
      const safeVol =
        typeof val === 'number' && !Number.isNaN(val)
          ? Math.max(0, Math.min(1, val))
          : DEFAULT_PLAYBACK_VOLUME;
      store.patch({ volume: safeVol });
      deps.transport.setVolume(safeVol);
      saveState(false, { volume: safeVol });
    },

    nextTrack,
    prevTrack,

    toggleShuffle() {
      if (disposed) return;
      store.patch({ isShuffle: !store.getSnapshot().isShuffle });
    },

    toggleRepeat() {
      if (disposed) return;
      const prev = store.getSnapshot().repeatMode;
      const next: RepeatMode =
        prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off';
      store.patch({ repeatMode: next });
      deps.persistence.setRepeat(next);
    },

    setAutoPlayNext(value: boolean) {
      if (disposed) return;
      store.patch({ autoPlayNext: value });
    },

    async toggleFavoriteCurrentTrack(): Promise<void> {
      if (disposed) return;
      const current = store.getSnapshot().currentTrack;
      if (!current) return;
      const nextValue = !current.is_favorite;
      store.patch({
        currentTrack: { ...current, is_favorite: nextValue },
      });
      try {
        await deps.userEffects.setFavorite(current, nextValue);
      } catch {
        const latest = store.getSnapshot().currentTrack;
        if (latest && latest.id === current.id) {
          store.patch({
            currentTrack: { ...latest, is_favorite: !nextValue },
          });
        }
      }
    },

    addToQueue(track: Track) {
      if (disposed) return;
      const snap = store.getSnapshot();
      const nextQueue = queueController.addToQueue(
        snap.queue,
        snap.currentIndex,
        track
      );
      store.patch({ queue: nextQueue });
      saveState(false, { queue: nextQueue });
      deps.sources.prewarmNextAdaptive([track], -1, snap.repeatMode);
    },

    removeFromQueue(index: number) {
      if (disposed) return;
      const snap = store.getSnapshot();
      const result = queueController.removeFromQueue(
        snap.queue,
        snap.currentIndex,
        index
      );
      if (!result.removedCurrent) {
        store.patch({
          queue: result.queue,
          currentIndex: result.currentIndex,
        });
        saveState(false, {
          queue: result.queue,
          currentIndex: result.currentIndex,
        });
        return;
      }

      if (!result.nextTrack) {
        deps.transport.pause();
        store.patch({
          currentTrack: null,
          queue: [],
          currentIndex: -1,
          isPlaying: false,
          isBuffering: false,
        });
        return;
      }

      store.patch({
        queue: result.queue,
        currentIndex: result.currentIndex,
      });
      if (!tryQuickPlayFromCache(result.nextTrack, result.currentIndex)) {
        void playTrack(result.nextTrack, undefined, result.currentIndex);
      }
    },

    clearQueue() {
      if (disposed) return;
      const snap = store.getSnapshot();
      const cleared = queueController.clearQueue(snap.currentTrack);
      store.patch(cleared);
      saveState(false, {
        queue: cleared.queue,
        currentIndex: cleared.currentIndex,
      });
    },

    toggleQueue() {
      if (disposed) return;
      store.patch({ isQueueOpen: !store.getSnapshot().isQueueOpen });
    },

    closeQueue() {
      if (disposed) return;
      store.patch({ isQueueOpen: false });
    },

    toggleNowPlayingOverlay() {
      if (disposed) return;
      store.patch({ isNowPlayingOpen: !store.getSnapshot().isNowPlayingOpen });
    },

    openNowPlayingOverlay() {
      if (disposed) return;
      store.patch({ isNowPlayingOpen: true });
    },

    closeNowPlayingOverlay() {
      if (disposed) return;
      store.patch({ isNowPlayingOpen: false });
    },

    setMvIntroOffset(offset: number) {
      if (disposed) return;
      store.patch({ mvIntroOffset: offset });
    },

    updateCurrentTrackViewCount(youtubeId: string, viewCount: number) {
      if (disposed) return;
      const snap = store.getSnapshot();
      const nextTrackObj =
        snap.currentTrack && snap.currentTrack.youtube_id === youtubeId
          ? { ...snap.currentTrack, view_count: viewCount }
          : snap.currentTrack;
      const nextQueue = snap.queue.map((t) =>
        t.youtube_id === youtubeId ? { ...t, view_count: viewCount } : t
      );
      store.patch({
        currentTrack: nextTrackObj,
        queue: nextQueue,
      });
    },

    handleVisibilityChange(hidden: boolean) {
      if (disposed) return;
      tabHidden = hidden;
      const snap = store.getSnapshot();

      if (hidden) {
        if (snap.currentTrack) {
          saveState(true, { currentTime: getActiveTime() });
        } else {
          deps.persistence.flush();
        }
        if (ownership.getDesiredState() === 'playing') {
          if (
            snap.queue.length > snap.currentIndex + 1 ||
            (snap.repeatMode === 'all' && snap.queue.length > 1)
          ) {
            hasPrewarmedNextTrack = true;
            deps.sources.prewarmNextAdaptive(
              snap.queue,
              snap.currentIndex,
              snap.repeatMode
            );
          }
        }
        const liveOnHide = deps.transport.read();
        const ownerOnHide = ownership.getOwner();
        if (
          ownership.getDesiredState() === 'playing' &&
          snap.currentTrack &&
          ownerOnHide &&
          !snap.isBuffering &&
          !pendingResume &&
          !liveOnHide.playing &&
          inFlightErrorRequestId !== ownerOnHide.requestId &&
          !recovery.isFallbackInProgress(ownerOnHide.requestId)
        ) {
          void deps.transport
            .resume()
            .then(() => {
              if (isPlaybackWanted(ownerOnHide)) {
                store.patch({ isPlaying: true, isBuffering: false });
              }
            })
            .catch(() => {});
        }
        return;
      }

      youtubeBgPauseRetries = 0;
      html5BgPauseRetries = 0;

      const live = deps.transport.read();
      if (
        completion.shouldCompleteOnBackgroundCheck({
          engine: activeEngine,
          desiredState: ownership.getDesiredState(),
          time: live.time,
          duration: live.duration || store.getProgress().duration,
        })
      ) {
        triggerCompletion(
          activeEngine === 'youtube'
            ? 'youtube-visibility-restore-eof'
            : 'html5-visibility-restore-eof'
        );
        return;
      }

      if (live.time > 0 || live.duration > 0) {
        store.setProgress({
          currentTime: live.time,
          duration:
            live.duration > 0 ? live.duration : store.getProgress().duration,
        });
      }

      const userWantsToPlay = ownership.getDesiredState() === 'playing';
      if (live.playing) {
        store.patch({ isPlaying: true, isBuffering: false });
      } else if (userWantsToPlay && snap.currentTrack) {
        pendingResume = false;
        const owner = ownership.getOwner();
        void deps.transport
          .resume()
          .then(() => {
            if (owner && isPlaybackWanted(owner)) {
              store.patch({ isPlaying: true, isBuffering: false });
            }
          })
          .catch(() => {
            if (
              owner &&
              ownership.isCurrentRequest(owner.requestId) &&
              ownership.getDesiredState() === 'playing'
            ) {
              pendingResume = true;
              store.patch({ isPlaying: false, isBuffering: false });
            }
          });
      } else if (!pendingResume) {
        store.patch({ isPlaying: false });
      }
    },

    handleUserActivation() {
      if (
        disposed ||
        !pendingResume ||
        ownership.getDesiredState() !== 'playing'
      ) {
        return;
      }
      void play();
    },

    handlePageHide() {
      if (disposed) return;
      if (store.getSnapshot().currentTrack) {
        saveState(true, { currentTime: getActiveTime() });
      } else {
        deps.persistence.flush();
      }
    },

    checkBackgroundCompletion() {
      if (
        disposed ||
        !tabHidden ||
        ownership.getDesiredState() !== 'playing'
      ) {
        return;
      }
      const snap = store.getSnapshot();
      const owner = ownership.getOwner();
      if (!snap.currentTrack || !owner) return;

      const live = deps.transport.read();
      if (
        activeEngine === 'html5' &&
        !hasPrewarmedNextTrack &&
        live.time >= 5 &&
        !snap.isBuffering
      ) {
        if (
          snap.queue.length > snap.currentIndex + 1 ||
          (snap.repeatMode === 'all' && snap.queue.length > 1)
        ) {
          hasPrewarmedNextTrack = true;
          deps.sources.prewarmNextAdaptive(
            snap.queue,
            snap.currentIndex,
            snap.repeatMode
          );
        }
      }

      if (
        completion.shouldCompleteOnBackgroundCheck({
          engine: activeEngine,
          desiredState: ownership.getDesiredState(),
          time: live.time,
          duration: live.duration || store.getProgress().duration,
        })
      ) {
        triggerCompletion(
          activeEngine === 'youtube'
            ? 'youtube-background-heartbeat-eof'
            : 'html5-background-heartbeat-eof'
        );
        return;
      }

      if (
        !live.playing &&
        !snap.isBuffering &&
        !pendingResume &&
        inFlightErrorRequestId !== owner.requestId &&
        !recovery.isFallbackInProgress(owner.requestId)
      ) {
        if (activeEngine === 'youtube') {
          if (youtubeBgPauseRetries < 2) {
            youtubeBgPauseRetries += 1;
            void deps.transport.resume().catch(() => {});
          } else {
            youtubeBgPauseRetries = 0;
            void switchYouTubeToHtml5InBackground(
              owner,
              snap.currentTrack,
              live.time || store.getProgress().currentTime
            );
          }
        } else if (html5BgPauseRetries < 2) {
          html5BgPauseRetries += 1;
          void deps.transport
            .resume()
            .then(() => {
              if (isPlaybackWanted(owner)) {
                store.patch({ isPlaying: true, isBuffering: false });
              }
            })
            .catch(() => {});
        }
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeTransport();
      clearTimers();
      ownership.abortFallback();
      smartFillAbort.abort();
      completion.dispose();
      deps.transport.dispose();
      deps.sources.dispose();
      deps.persistence.dispose();
      deps.userEffects.dispose();
      store.clearListeners();
    },
  };
}
