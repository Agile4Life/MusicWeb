import { describe, expect, it } from 'vitest'
import { isCurrentPlayback, resolveStartAction } from '../playbackRaceGuards'

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

describe('resolveStartAction', () => {
  it('plays when the request is current and the user wants playback', () => {
    expect(resolveStartAction({ requestId: 3, currentRequestId: 3, desiredState: 'playing' })).toBe('play')
  })

  it('plays when desired state is unset (initial/autoplay)', () => {
    expect(resolveStartAction({ requestId: 1, currentRequestId: 1, desiredState: null })).toBe('play')
  })

  it('does NOT start audio when the user paused while resolving', () => {
    expect(resolveStartAction({ requestId: 3, currentRequestId: 3, desiredState: 'paused' })).toBe('load-paused')
  })

  it('drops a superseded request regardless of desired state', () => {
    expect(resolveStartAction({ requestId: 2, currentRequestId: 3, desiredState: 'playing' })).toBe('drop')
    expect(resolveStartAction({ requestId: 2, currentRequestId: 3, desiredState: 'paused' })).toBe('drop')
  })

  it('pause during resolve, then Next (new request sets intent to play) plays again', () => {
    expect(resolveStartAction({ requestId: 5, currentRequestId: 5, desiredState: 'paused' })).toBe('load-paused')
    expect(resolveStartAction({ requestId: 6, currentRequestId: 6, desiredState: 'playing' })).toBe('play')
  })
})
