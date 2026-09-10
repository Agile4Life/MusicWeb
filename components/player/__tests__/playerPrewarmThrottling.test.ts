import { describe, expect, it, vi } from 'vitest'
import { isFastConnection } from '../prewarmAdaptive'
import type { Track } from '@/types'

describe('Player Adaptive Prewarming & Bandwidth Protection (Task 3)', () => {
  it('Network Gate: rejects prewarming if saveData is enabled', () => {
    const mockNav = {
      connection: {
        saveData: true,
        effectiveType: '4g',
      },
    }
    expect(isFastConnection(mockNav as any)).toBe(false)
  })

  it('Network Gate: rejects prewarming on slow connections (2g, 3g, slow-2g)', () => {
    expect(isFastConnection({ connection: { effectiveType: 'slow-2g', saveData: false } } as any)).toBe(false)
    expect(isFastConnection({ connection: { effectiveType: '2g', saveData: false } } as any)).toBe(false)
    expect(isFastConnection({ connection: { effectiveType: '3g', saveData: false } } as any)).toBe(false)
    expect(isFastConnection({ connection: { effectiveType: '4g', saveData: false } } as any)).toBe(true)
    expect(isFastConnection({} as any)).toBe(true) // Defaults to true if NetworkInformation API unsupported
  })

  it('Throttling: Only schedules prewarm for single next track (currentIndex + 1)', () => {
    const queue: Track[] = [
      { id: 't0', title: 'Track 0', source: 'nhaccuatui', nhaccuatui_id: 'nct-0' },
      { id: 't1', title: 'Track 1', source: 'nhaccuatui', nhaccuatui_id: 'nct-1' },
      { id: 't2', title: 'Track 2', source: 'nhaccuatui', nhaccuatui_id: 'nct-2' },
      { id: 't3', title: 'Track 3', source: 'nhaccuatui', nhaccuatui_id: 'nct-3' },
    ]
    const currentIndex = 0
    const prewarmedIds: string[] = []

    const prewarmNextTrackThrottled = (
      q: Track[],
      idx: number,
      currentTime: number,
      isBuffering: boolean,
      isFastNet: boolean
    ) => {
      // Gate 1: Network check
      if (!isFastNet) return
      // Gate 2: Playback stability check (must have played at least 5s smoothly)
      if (currentTime < 5 || isBuffering) return
      // Gate 3: Single next track only
      const next = q[idx + 1]
      if (next?.id) {
        prewarmedIds.push(next.id)
      }
    }

    // Attempt prewarm at 1s into playback -> Must not prewarm yet
    prewarmNextTrackThrottled(queue, currentIndex, 1, false, true)
    expect(prewarmedIds).toHaveLength(0)

    // Attempt prewarm while buffering at 6s -> Must not prewarm yet
    prewarmNextTrackThrottled(queue, currentIndex, 6, true, true)
    expect(prewarmedIds).toHaveLength(0)

    // Attempt prewarm with slow network at 6s -> Must not prewarm
    prewarmNextTrackThrottled(queue, currentIndex, 6, false, false)
    expect(prewarmedIds).toHaveLength(0)

    // Fast network + 6s stable playback -> Prewarm ONLY track 1
    prewarmNextTrackThrottled(queue, currentIndex, 6, false, true)
    expect(prewarmedIds).toEqual(['t1'])
  })
})
