export interface PlaybackGuardInput {
  requestId: number
  currentRequestId: number
  trackId?: string | null
  currentTrackId?: string | null
}

export function isCurrentPlayback({
  requestId,
  currentRequestId,
  trackId,
  currentTrackId,
}: PlaybackGuardInput): boolean {
  return requestId === currentRequestId && trackId === currentTrackId
}

export type PlaybackStartAction = 'drop' | 'load-paused' | 'play'

/**
 * Decides what to do once async resolution of a track has finished.
 * - 'drop'        : a newer request owns playback, discard this one.
 * - 'load-paused' : the user pressed Pause while resolving; keep the source
 *                   loaded so Resume works, but do NOT start audio.
 * - 'play'        : safe to start audio.
 */
export function resolveStartAction(input: {
  requestId: number
  currentRequestId: number
  desiredState: 'playing' | 'paused' | null
}): PlaybackStartAction {
  if (input.requestId !== input.currentRequestId) return 'drop'
  if (input.desiredState === 'paused') return 'load-paused'
  return 'play'
}
