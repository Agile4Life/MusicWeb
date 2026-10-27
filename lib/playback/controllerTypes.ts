import type { Track } from '@/types';
import type {
  Cancel,
  PlaybackClock,
  PlaybackPersistencePort,
  PlaybackTransport,
  PlaybackUserEffects,
} from './ports';
import type { PlaybackSourceService } from './playbackSourceService';

export type RepeatMode = 'off' | 'all' | 'one';

export interface PlaybackSnapshot {
  currentTrack: Track | null;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  isShuffle: boolean;
  repeatMode: RepeatMode;
  autoPlayNext: boolean;
  playbackError: string | null;
  mvIntroOffset: number;
  queue: Track[];
  currentIndex: number;
  isQueueOpen: boolean;
  isNowPlayingOpen: boolean;
}

export interface PlaybackProgressSnapshot {
  currentTime: number;
  duration: number;
}

export interface PlaybackController {
  getSnapshot(): PlaybackSnapshot;
  getProgress(): PlaybackProgressSnapshot;
  subscribe(listener: () => void): Cancel;
  subscribeProgress(listener: () => void): Cancel;
  restoreFromPersistence(): Promise<void>;
  playTrack(
    track: Track,
    newQueue?: Track[],
    forceIndex?: number,
    startFromTime?: number
  ): Promise<void>;
  playSearchTrack(track: Track): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  togglePlay(): Promise<void>;
  seek(time: number): void;
  setVolume(val: number): void;
  nextTrack(): void;
  prevTrack(): void;
  toggleShuffle(): void;
  toggleRepeat(): void;
  setAutoPlayNext(value: boolean): void;
  toggleFavoriteCurrentTrack(): Promise<void>;
  addToQueue(track: Track): void;
  removeFromQueue(index: number): void;
  clearQueue(): void;
  toggleQueue(): void;
  closeQueue(): void;
  toggleNowPlayingOverlay(): void;
  openNowPlayingOverlay(): void;
  closeNowPlayingOverlay(): void;
  setMvIntroOffset(offset: number): void;
  updateCurrentTrackViewCount(youtubeId: string, viewCount: number): void;
  handleVisibilityChange(hidden: boolean): void;
  handleUserActivation(): void;
  handlePageHide(): void;
  checkBackgroundCompletion(): void;
  dispose(): void;
}

export interface PlaybackControllerDeps {
  clock: PlaybackClock;
  transport: PlaybackTransport;
  sources: PlaybackSourceService;
  persistence: PlaybackPersistencePort;
  userEffects: PlaybackUserEffects;
  canUseYouTubeIframe?: () => boolean;
}
