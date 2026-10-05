import { describe, expect, it } from 'vitest'
import { decideSmartFill, shouldRecordSkip } from '../playbackDecisions'

describe('decideSmartFill', () => {
  it('starts when nothing is in flight', () => {
    expect(decideSmartFill({ inflightSeedId: null, seedId: 'a', repeatMode: 'off' })).toBe('start')
  })

  it('skips a duplicate call for the same seed', () => {
    expect(decideSmartFill({ inflightSeedId: 'a', seedId: 'a', repeatMode: 'off' })).toBe('skip')
  })

  it('supersedes a stale request when the user moved to another track (starvation bug)', () => {
    expect(decideSmartFill({ inflightSeedId: 'a', seedId: 'b', repeatMode: 'off' })).toBe('start')
  })

  it('never fills while repeat is active', () => {
    expect(decideSmartFill({ inflightSeedId: null, seedId: 'a', repeatMode: 'all' })).toBe('skip')
    expect(decideSmartFill({ inflightSeedId: null, seedId: 'a', repeatMode: 'one' })).toBe('skip')
  })
})

describe('shouldRecordSkip', () => {
  it('ignores accidental taps (<= 2s)', () => {
    expect(shouldRecordSkip({ activeTime: 1.5, duration: 200 })).toBe(false)
    expect(shouldRecordSkip({ activeTime: 2, duration: 200 })).toBe(false)
  })

  it('records a mid-track skip', () => {
    expect(shouldRecordSkip({ activeTime: 30, duration: 200 })).toBe(true)
  })

  it('does not record a skip in the final 5s (effectively completed)', () => {
    expect(shouldRecordSkip({ activeTime: 196, duration: 200 })).toBe(false)
  })

  it('records when the duration is unknown', () => {
    expect(shouldRecordSkip({ activeTime: 10, duration: 0 })).toBe(true)
    expect(shouldRecordSkip({ activeTime: 10, duration: null })).toBe(true)
  })

  it('rejects non-finite times', () => {
    expect(shouldRecordSkip({ activeTime: NaN, duration: 200 })).toBe(false)
  })
})
