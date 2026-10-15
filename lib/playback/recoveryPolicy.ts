import type { Track } from '@/types';
import { isSameAudioSource } from '@/components/player/audioSourceSwitch';
import { extractYouTubeVideoId } from '@/lib/youtube';

export const MAX_CONSECUTIVE_SKIPS = 4;
export const AUDIO_STALL_WATCHDOG_TIMEOUT_MS = 12000;
export const NCT_RETRY_RACE_TIMEOUT_MS = 4000;
export const ERROR_AUTO_SKIP_DELAY_MS = 1200;
export const ERROR_DEBOUNCE_COOLDOWN_MS = 800;

function recordBounded(set: Set<number>, id: number, max = 50): void {
  set.add(id);
  if (set.size > max) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
}

export type Html5ErrorDecision =
  | { type: 'ignore' }
  | { type: 'switch-to-youtube-iframe'; videoId: string }
  | { type: 'retry-nct-proxy'; fallbackUrl: string }
  | { type: 'retry-soundcloud-fresh' }
  | { type: 'fallback-to-youtube' }
  | { type: 'fail' };

export type StallDecision =
  | { type: 'ignore' }
  | { type: 'refresh-soundcloud' }
  | { type: 'fallback-to-youtube' };

export type YouTubeErrorDecision =
  | { type: 'retry-youtube-alternate'; invalidate: boolean }
  | { type: 'fail'; invalidate: boolean; message: string };

export interface UnrecoverableFailureOutcome {
  error: string;
  consecutiveSkips: number;
  circuitBroken: boolean;
  shouldAutoSkip: boolean;
  autoSkipDelayMs: number;
}

export interface RecoveryPolicy {
  resetConsecutiveSkips(): void;
  getConsecutiveSkips(): number;
  isFallbackInProgress(requestId: number): boolean;
  hasAttemptedFallback(requestId: number): boolean;
  beginFallback(requestId: number): void;
  endFallback(requestId: number): void;
  markFallbackAttempted(requestId: number): void;
  markNctRetryAborted(requestId: number): void;
  isNctRetryAborted(requestId: number): boolean;
  decideHtml5Error(params: {
    requestId: number;
    track: Track;
    currentSrc?: string;
    isIosYouTubeProxy?: boolean;
  }): Html5ErrorDecision;
  decideStall(params: { requestId: number; track: Track }): StallDecision;
  decideYouTubeError(params: {
    requestId: number;
    errorCode?: number;
  }): YouTubeErrorDecision;
  shouldSuppressRapidError(now: number): boolean;
  recordUnrecoverableFailure(params: {
    trackTitle: string;
    queueLength: number;
    autoPlayNext: boolean;
    repeatMode: 'off' | 'all' | 'one';
    errorMessage?: string;
    isYouTube?: boolean;
  }): UnrecoverableFailureOutcome;
  reset(): void;
}

export function createRecoveryPolicy(
  maxConsecutiveSkips = MAX_CONSECUTIVE_SKIPS
): RecoveryPolicy {
  const fallbackAttempted = new Set<number>();
  const fallbackInProgress = new Set<number>();
  const ytRetried = new Set<number>();
  const nctRetried = new Set<number>();
  const nctRetryAborted = new Set<number>();
  const scRetried = new Set<number>();
  const scStallRecovered = new Set<number>();

  let consecutiveSkips = 0;
  let lastErrorAutoAdvanceAt = 0;

  return {
    resetConsecutiveSkips() {
      consecutiveSkips = 0;
    },

    getConsecutiveSkips() {
      return consecutiveSkips;
    },

    isFallbackInProgress(requestId: number) {
      return fallbackInProgress.has(requestId);
    },

    hasAttemptedFallback(requestId: number) {
      return fallbackAttempted.has(requestId);
    },

    beginFallback(requestId: number) {
      recordBounded(fallbackInProgress, requestId);
      recordBounded(fallbackAttempted, requestId);
    },

    endFallback(requestId: number) {
      fallbackInProgress.delete(requestId);
    },

    markFallbackAttempted(requestId: number) {
      recordBounded(fallbackAttempted, requestId);
    },

    markNctRetryAborted(requestId: number) {
      recordBounded(nctRetryAborted, requestId);
    },

    isNctRetryAborted(requestId: number) {
      return nctRetryAborted.has(requestId);
    },

    decideHtml5Error({
      requestId,
      track,
      currentSrc,
      isIosYouTubeProxy,
    }): Html5ErrorDecision {
      if (fallbackInProgress.has(requestId)) {
        return { type: 'ignore' };
      }

      const directYtId =
        track.youtube_id ||
        (track.source === 'youtube'
          ? extractYouTubeVideoId(track.file_path || '')
          : null);
      if (isIosYouTubeProxy && directYtId) {
        return { type: 'switch-to-youtube-iframe', videoId: directYtId };
      }

      const isNct = Boolean(
        track.source === 'nhaccuatui' ||
          (track.nhaccuatui_id &&
            track.source !== 'youtube' &&
            track.source !== 'soundcloud')
      );
      if (isNct && track.nhaccuatui_id) {
        const fallbackUrl = `/api/nhaccuatui/stream?id=${encodeURIComponent(
          track.nhaccuatui_id
        )}`;
        const isAlreadyLocalProxy = Boolean(
          currentSrc &&
            (isSameAudioSource(currentSrc, fallbackUrl) ||
              currentSrc.includes(fallbackUrl))
        );
        const isTransportSwitch = Boolean(currentSrc && !isAlreadyLocalProxy);
        if (nctRetried.has(requestId)) {
          recordBounded(nctRetryAborted, requestId);
        } else if (!isTransportSwitch) {
          recordBounded(nctRetried, requestId);
          recordBounded(nctRetryAborted, requestId);
        } else {
          recordBounded(nctRetried, requestId);
          return { type: 'retry-nct-proxy', fallbackUrl };
        }
      }

      const isSoundCloud = Boolean(
        track.source === 'soundcloud' ||
          ((track.soundcloud_id || track.id?.startsWith('sc-')) &&
            track.source !== 'youtube' &&
            track.source !== 'nhaccuatui')
      );
      if (isSoundCloud && !scRetried.has(requestId)) {
        recordBounded(scRetried, requestId);
        return { type: 'retry-soundcloud-fresh' };
      }

      if (!fallbackAttempted.has(requestId)) {
        return { type: 'fallback-to-youtube' };
      }

      return { type: 'fail' };
    },

    decideStall({ requestId, track }): StallDecision {
      if (
        fallbackInProgress.has(requestId) ||
        fallbackAttempted.has(requestId)
      ) {
        return { type: 'ignore' };
      }

      const isSoundCloud = Boolean(
        track.source === 'soundcloud' ||
          track.soundcloud_id ||
          track.id?.startsWith('sc-')
      );
      if (isSoundCloud && !scStallRecovered.has(requestId)) {
        recordBounded(scStallRecovered, requestId);
        return { type: 'refresh-soundcloud' };
      }

      recordBounded(fallbackAttempted, requestId);
      return { type: 'fallback-to-youtube' };
    },

    decideYouTubeError({ requestId, errorCode }): YouTubeErrorDecision {
      const isEmbedError =
        errorCode === 150 || errorCode === 101 || errorCode === 100;
      if (isEmbedError && !ytRetried.has(requestId)) {
        recordBounded(ytRetried, requestId);
        return { type: 'retry-youtube-alternate', invalidate: true };
      }
      const message =
        errorCode === 150 || errorCode === 101
          ? 'Video này bị cấm nhúng phát ngoài YouTube. Vui lòng chọn bài khác.'
          : errorCode === 100
            ? 'Video này không còn tồn tại trên YouTube. Vui lòng chọn bài khác.'
            : 'Không thể phát video YouTube này';
      return { type: 'fail', invalidate: isEmbedError, message };
    },

    shouldSuppressRapidError(now: number): boolean {
      if (
        lastErrorAutoAdvanceAt > 0 &&
        now - lastErrorAutoAdvanceAt < ERROR_DEBOUNCE_COOLDOWN_MS
      ) {
        return true;
      }
      lastErrorAutoAdvanceAt = now;
      return false;
    },

    recordUnrecoverableFailure({
      trackTitle,
      queueLength,
      autoPlayNext,
      repeatMode,
      errorMessage,
      isYouTube,
    }): UnrecoverableFailureOutcome {
      consecutiveSkips += 1;
      if (consecutiveSkips >= maxConsecutiveSkips) {
        const prefix = isYouTube ? 'Đã tạm dừng phát' : 'Đã dừng tự động chuyển bài';
        return {
          error: `${prefix} do có ${consecutiveSkips} bài hát liên tiếp gặp sự cố kết nối/nguồn phát. Vui lòng chọn bài khác.`,
          consecutiveSkips,
          circuitBroken: true,
          shouldAutoSkip: false,
          autoSkipDelayMs: ERROR_AUTO_SKIP_DELAY_MS,
        };
      }

      const shouldAutoSkip =
        queueLength > 1 && (autoPlayNext || repeatMode === 'all');
      return {
        error:
          errorMessage ??
          `Không thể phát bài hát "${trackTitle}". Vui lòng chọn bài khác.`,
        consecutiveSkips,
        circuitBroken: false,
        shouldAutoSkip,
        autoSkipDelayMs: ERROR_AUTO_SKIP_DELAY_MS,
      };
    },

    reset() {
      fallbackAttempted.clear();
      fallbackInProgress.clear();
      ytRetried.clear();
      nctRetried.clear();
      nctRetryAborted.clear();
      scRetried.clear();
      scStallRecovered.clear();
      consecutiveSkips = 0;
      lastErrorAutoAdvanceAt = 0;
    },
  };
}
