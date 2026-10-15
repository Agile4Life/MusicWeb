import { describe, it, expect, vi, afterEach } from 'vitest'
import { PlaybackPersistenceScheduler, type PersistStatePayload } from '../../playbackPersistenceScheduler'
import type { Track } from '@/types'

const track = { id: 'a', title: 'A', artist: 'Artist', duration: 50, source: 'local' } as Track
const payload = (time = 0): PersistStatePayload => ({ track, currentTime: time, queue: [track], currentIndex: 0, volume: .8 })
afterEach(() => vi.useRealTimers())
describe('injected persistence scheduler', () => {
  it('isolates stores and writes latest time on the original cadence', () => {
    vi.useFakeTimers()
    const first: string[] = [], second: string[] = []
    const deps = (store: string[]) => ({ now: () => 1234, write: (_key: string, value: string) => { store.push(value) }, after: (ms: number, fn: () => void) => { const id = setTimeout(fn, ms); return () => clearTimeout(id) }, onIdle: (fn: () => void) => { fn(); return () => {} } })
    const a = new PlaybackPersistenceScheduler(deps(first))
    const b = new PlaybackPersistenceScheduler(deps(second))
    a.scheduleDebounced(payload(1)); b.scheduleDebounced(payload(2))
    vi.advanceTimersByTime(10000)
    a.scheduleDebounced(payload(3)); a.updatePendingTime(4)
    vi.advanceTimersByTime(5000)
    expect(first.map(value => JSON.parse(value))).toEqual([expect.objectContaining({ currentTime: 4, track: expect.objectContaining({ id: 'a' }), savedAt: 1234 })])
    expect(second.map(value => JSON.parse(value))).toEqual([expect.objectContaining({ currentTime: 2 })])
  })
  it('flush cancels deferred writes and disposal discards pending work', () => {
    const writes: string[] = [], timers: (() => void)[] = [], idle: (() => void)[] = []
    const cancelTimer = vi.fn(), cancelIdle = vi.fn()
    const scheduler = new PlaybackPersistenceScheduler({ now: () => 0, write: (_key, value) => { writes.push(value) }, after: (_ms, fn) => { timers.push(fn); return cancelTimer }, onIdle: fn => { idle.push(fn); return cancelIdle } })
    scheduler.scheduleDebounced(payload()); timers[0]()
    scheduler.flushPending(); idle[0]()
    expect(writes).toHaveLength(1); expect(cancelIdle).toHaveBeenCalled()
    scheduler.scheduleDebounced(payload(2)); scheduler.dispose(); timers[1]()
    expect(writes).toHaveLength(1); expect(cancelTimer).toHaveBeenCalled()
  })
})
