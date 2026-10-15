'use client'

import React, { createContext, useContext, useMemo } from 'react'
import type { PlaybackController } from '@/lib/playback/controllerTypes'
import { DEFAULT_PLAYBACK_VOLUME } from '@/lib/playback/playbackState'
import {
  AUDIO_STALL_WATCHDOG_TIMEOUT_MS,
  MAX_CONSECUTIVE_SKIPS,
} from '@/lib/playback/recoveryPolicy'
import {
  inferTrackSource,
  isBackgroundPlayableTrack,
  isFullYouTubeQueue,
} from '@/lib/trackSourceClassifier'
import { usePlaybackProgressStore } from './PlaybackProgressStore'
import type {
  PlaybackProgressContextType,
  PlayerContextType,
  PlayerControlsContextType,
  PlayerQueueContextType,
  PlayerTrackContextType,
  RepeatMode,
} from './playerContextTypes'
import type { PlayerRuntime } from './runtime/createPlayerRuntime'
import { usePlayerRuntime } from './usePlayerRuntime'

export {
  isBackgroundPlayableTrack,
  isFullYouTubeQueue,
  inferTrackSource,
  MAX_CONSECUTIVE_SKIPS,
  AUDIO_STALL_WATCHDOG_TIMEOUT_MS,
}
export type {
  RepeatMode,
  PlayerControlsContextType,
  PlayerTrackContextType,
  PlayerQueueContextType,
  PlayerContextType,
}

export const DEFAULT_VOLUME = DEFAULT_PLAYBACK_VOLUME

const PlayerControlsContext = createContext<PlayerControlsContextType | undefined>(undefined)
const PlayerTrackContext = createContext<PlayerTrackContextType | undefined>(undefined)
const PlayerQueueContext = createContext<PlayerQueueContextType | undefined>(undefined)
const PlayerContext = createContext<PlayerContextType | undefined>(undefined)
const PlaybackProgressContext = createContext<PlaybackProgressContextType>({
  currentTime: 0,
  duration: 0,
})

export function usePlayerControls() {
  const context = useContext(PlayerControlsContext)
  if (!context) {
    throw new Error('usePlayerControls must be used within a PlayerProvider')
  }
  return context
}

export function usePlayerTrack() {
  const context = useContext(PlayerTrackContext)
  if (!context) {
    throw new Error('usePlayerTrack must be used within a PlayerProvider')
  }
  return context
}

export function usePlayerQueue() {
  const context = useContext(PlayerQueueContext)
  if (!context) {
    throw new Error('usePlayerQueue must be used within a PlayerProvider')
  }
  return context
}

export function usePlaybackProgress() {
  return usePlaybackProgressStore()
}

export function usePlayer() {
  const context = useContext(PlayerContext)
  if (!context) {
    throw new Error('usePlayer must be used within a PlayerProvider')
  }
  return context
}

export function PlayerProvider({
  children,
  runtime,
  controller,
}: {
  children: React.ReactNode
  runtime?: PlayerRuntime
  controller?: PlaybackController
}) {
  const { slices, audioRef, effectiveDuration } = usePlayerRuntime({
    runtime,
    controller,
  })

  const progressValue = useMemo(
    () => ({ currentTime: 0, duration: effectiveDuration }),
    [effectiveDuration]
  )

  return (
    <PlayerControlsContext.Provider value={slices.controls}>
      <PlayerTrackContext.Provider value={slices.track}>
        <PlayerQueueContext.Provider value={slices.queue}>
          <PlayerContext.Provider value={slices.player}>
            <PlaybackProgressContext.Provider value={progressValue}>
              {children}
              {/* preload="auto" — buffer audio frames. webkit-playsinline for iOS background audio */}
              <audio
                ref={audioRef}
                preload="auto"
                playsInline
                crossOrigin="anonymous"
                {...({ 'webkit-playsinline': '' } as React.AudioHTMLAttributes<HTMLAudioElement>)}
              />
              {/* Hidden YouTube Player IFrame container (Must have non-zero dimensions to prevent YouTube SDK 4s auto-pause) */}
              <div className="fixed top-0 left-0 w-1 h-1 opacity-0 pointer-events-none overflow-hidden -z-50">
                <div id="yt-player-container" />
              </div>
            </PlaybackProgressContext.Provider>
          </PlayerContext.Provider>
        </PlayerQueueContext.Provider>
      </PlayerTrackContext.Provider>
    </PlayerControlsContext.Provider>
  )
}
