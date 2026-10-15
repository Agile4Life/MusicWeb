import type React from 'react';
import type { Track } from '@/types';
import type { RepeatMode } from '@/lib/playback/controllerTypes';

export type { RepeatMode };

export interface PlayerControlsContextType {
  playTrack: (
    track: Track,
    newQueue?: Track[],
    forceIndex?: number,
    startFromTime?: number
  ) => Promise<void>;
  playSearchTrack: (track: Track) => Promise<void>;
  togglePlay: () => void;
  seek: (time: number) => void;
  setVolume: (val: number) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  toggleFavoriteCurrentTrack: () => Promise<void>;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  toggleQueue: () => void;
  closeQueue: () => void;
  toggleNowPlayingOverlay: () => void;
  openNowPlayingOverlay: () => void;
  closeNowPlayingOverlay: () => void;
}

export interface PlayerTrackContextType {
  currentTrack: Track | null;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  isShuffle: boolean;
  repeatMode: RepeatMode;
  playbackError: string | null;
  frequencyData: Uint8Array;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  mvIntroOffset: number;
}

export interface PlayerQueueContextType {
  queue: Track[];
  currentIndex: number;
  isQueueOpen: boolean;
  isNowPlayingOpen: boolean;
  addToQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
}

export interface PlayerContextType
  extends PlayerTrackContextType,
    PlayerControlsContextType {
  queue: Track[];
  currentIndex: number;
  isQueueOpen: boolean;
  isNowPlayingOpen: boolean;
}

export interface PlaybackProgressContextType {
  currentTime: number;
  duration: number;
}
