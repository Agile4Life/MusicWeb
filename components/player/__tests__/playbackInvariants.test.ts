import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Source-level invariants for PlayerContext. These guard bugs that are easy to
 * re-introduce in a 4000-line component and can't be exercised without a DOM.
 */
const source = readFileSync(path.resolve(__dirname, '../PlayerContext.tsx'), 'utf8').replace(/\r\n/g, '\n')

function sliceBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  expect(start, `marker not found: ${startMarker}`).toBeGreaterThan(-1)
  const end = source.indexOf(endMarker, start + startMarker.length)
  expect(end, `marker not found: ${endMarker}`).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('queue writes', () => {
  it('only commitQueue calls setQueue (ref and state can never diverge)', () => {
    const calls = source.match(/\bsetQueue\(/g) ?? []
    // 1 call inside commitQueue itself
    expect(calls.length).toBe(1)
    const commit = sliceBetween('const commitQueue = useCallback(', '}, [])')
    expect(commit).toContain('queueRef.current = next')
    // ref must be published BEFORE scheduling state
    expect(commit.indexOf('queueRef.current = next')).toBeLessThan(commit.indexOf('setQueue(next)'))
  })

  it('removeFromQueue does not filter the already-filtered queue a second time', () => {
    const body = sliceBetween('const removeFromQueue = useCallback(', '}, [commitQueue, playTrack, tryQuickPlayFromCache])')
    expect(body).not.toMatch(/queueRef\.current\.filter\(/)
  })
})

describe('skip analytics', () => {
  it('both playTrack and quick-play report the skipped track', () => {
    const playTrackBody = sliceBetween('const playTrack = useCallback(async (', 'playTrackRef.current = playTrack')
    expect(playTrackBody).toContain('recordSkipOfCurrent(')
    const quick = sliceBetween('const tryQuickPlayFromCache = useCallback(', 'const playResolvedTrack = useCallback(')
    expect(quick).toContain('recordSkipOfCurrent(')
    // must run before the engine mode / current track are overwritten
    expect(quick.indexOf('recordSkipOfCurrent(')).toBeLessThan(quick.indexOf('beginNewPlaybackRequest(track)'))
    expect(quick.indexOf('recordSkipOfCurrent(')).toBeLessThan(quick.indexOf('commitNavigation('))
  })
})

describe('caller object safety', () => {
  it('playTrack never assigns onto the caller-provided rawTrack', () => {
    const playTrackBody = sliceBetween('const playTrack = useCallback(async (', 'playTrackRef.current = playTrack')
    expect(playTrackBody).not.toMatch(/\brawTrack\.\w+\s*=[^=]/)
    expect(playTrackBody).toContain('const track = { ...inferTrackSource(rawTrack) }')
  })
})

describe('smart queue fill', () => {
  it('does not use a boolean in-flight flag that drops newer seeds', () => {
    expect(source).not.toContain('autoFetchSmartQueueRef')
    const body = sliceBetween('const triggerSmartQueueFill = useCallback(', '}, [commitQueue])')
    expect(body).toContain('decideSmartFill(')
    expect(body).toContain('signal')
  })
})
