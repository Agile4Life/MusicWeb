import { describe, expect, it } from 'vitest'
import { isCurrentPlayback } from '../playbackRaceGuards'

describe('isCurrentPlayback', () => {
  it('accepts the active request and track', () => {
    expect(isCurrentPlayback({ requestId: 4, currentRequestId: 4, trackId: 'track-b', currentTrackId: 'track-b' })).toBe(true)
  })

  it('rejects a callback from an older playback request', () => {
    expect(isCurrentPlayback({ requestId: 3, currentRequestId: 4, trackId: 'track-b', currentTrackId: 'track-b' })).toBe(false)
  })

  it('rejects a callback for a different track in the same request', () => {
    expect(isCurrentPlayback({ requestId: 4, currentRequestId: 4, trackId: 'track-a', currentTrackId: 'track-b' })).toBe(false)
  })
})
