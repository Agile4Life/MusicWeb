import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startDailyTrendingRefresh, isTrendingSnapshotFresh, retainTrendingSnapshot } from '../dailyTrendingRefresh'
import type { GlobalSearchTracks } from '../searchApi'
import type { Track } from '@/types'

const track = (id: string): Track => ({ id, user_id: 'spotify', title: 'Song', artist: 'Artist', duration: 180, file_path: id, cover_url: null, created_at: '2026-10-24T00:00:00Z', source: 'spotify' })

describe('daily trending refresh lifecycle', () => {
  let focus: EventTarget
  let visibility: EventTarget & { visibilityState: string }
  const stops: Array<() => void> = []
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T16:59:30Z'))
    focus = new EventTarget()
    visibility = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  })
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop())
    vi.useRealTimers()
  })
  const flush = () => vi.advanceTimersByTimeAsync(0)

  it('refreshes at Vietnam midnight once and ignores same-day focus and visibility events', async () => {
    const loadedDays: string[] = []
    stops.push(startDailyTrendingRefresh(async (day) => { loadedDays.push(day); return true }, { focus, visibility }))
    await flush()
    focus.dispatchEvent(new Event('focus'))
    visibility.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(loadedDays).toEqual(['2026-10-25'])
    await vi.advanceTimersByTimeAsync(30_000)
    focus.dispatchEvent(new Event('focus'))
    await flush()
    expect(loadedDays).toEqual(['2026-10-25', '2026-10-26'])
    expect(vi.getTimerCount()).toBe(1)
  })

  it('catches up when a suspended tab returns on a later day and removes listeners on disposal', async () => {
    const loadedDays: string[] = []
    const stop = startDailyTrendingRefresh(async (day) => { loadedDays.push(day); return true }, { focus, visibility })
    stops.push(stop)
    await flush()
    vi.setSystemTime(new Date('2026-10-27T01:00:00Z'))
    visibility.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(loadedDays).toEqual(['2026-10-25', '2026-10-27'])
    stop()
    vi.setSystemTime(new Date('2026-10-28T01:00:00Z'))
    focus.dispatchEvent(new Event('focus'))
    await flush()
    expect(loadedDays).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retries empty or stale failures after five minutes without focus request storms', async () => {
    vi.setSystemTime(new Date('2026-10-25T01:00:00Z'))
    let attempts = 0
    stops.push(startDailyTrendingRefresh(async () => ++attempts >= 2, { focus, visibility }))
    await flush()
    focus.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(299_999)
    expect(attempts).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(attempts).toBe(2)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(attempts).toBe(2)
  })

  it('keeps the new-day schedule when an old request resolves late', async () => {
    let resolveOld!: (value: boolean) => void
    const days: string[] = []
    stops.push(startDailyTrendingRefresh((day) => {
      days.push(day)
      return days.length === 1 ? new Promise((resolve) => { resolveOld = resolve }) : Promise.resolve(true)
    }, { focus, visibility }))
    await vi.advanceTimersByTimeAsync(30_000)
    resolveOld(false)
    await flush()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(days).toEqual(['2026-10-25', '2026-10-26'])
    expect(vi.getTimerCount()).toBe(1)
  })

  it('does not treat yesterday or an empty snapshot as refreshed', () => {
    const data: GlobalSearchTracks = { nhaccuatui: [], local: [], youtube: [], spotify: [track('song')], deezer: [] }
    expect(isTrendingSnapshotFresh(data, '2026-10-25')).toBe(true)
    expect(isTrendingSnapshotFresh({ ...data, spotify: [] }, '2026-10-25')).toBe(false)
    const trending = { date: '2026-10-24', stale: false, updatedAt: '', nextRefreshAt: '' }
    expect(isTrendingSnapshotFresh({ ...data, trending }, '2026-10-25')).toBe(false)
    expect(isTrendingSnapshotFresh({ ...data, trending: { ...trending, date: '2026-10-25', stale: true } }, '2026-10-25')).toBe(false)
  })

  it('retains the last usable snapshot with its real date when a refresh returns no tracks', () => {
    const previous: GlobalSearchTracks = { nhaccuatui: [], local: [], youtube: [], spotify: [track('yesterday')], deezer: [],
      trending: { date: '2026-10-24', updatedAt: '2026-10-24T00:00:00Z', nextRefreshAt: '', stale: false },
    }
    const empty = { nhaccuatui: [], local: [], youtube: [], spotify: [], deezer: [] }
    const retained = retainTrendingSnapshot(previous, empty)
    expect(retained.spotify[0].id).toBe('yesterday')
    expect(retained.trending?.date).toBe('2026-10-24')
    expect(retained.trending?.stale).toBe(true)
    expect(previous.trending?.stale).toBe(false)
  })
})
