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
