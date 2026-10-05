import { describe, expect, it } from 'vitest'
import { SupersedableRequest, isAbortError, planUpcomingPrewarm } from '../prewarmPlan'
import type { Track } from '@/types'

const t = (id: string) => ({ id, title: id, artist: 'a' }) as Track
const queue = ['a', 'b', 'c', 'd', 'e'].map(t)

describe('planUpcomingPrewarm', () => {
  it('returns up to 3 tracks after the current index', () => {
    expect(planUpcomingPrewarm(queue, 0).map((x) => x.id)).toEqual(['b', 'c', 'd'])
  })

  it('never goes past the end of the queue and excludes the current track', () => {
    expect(planUpcomingPrewarm(queue, 3).map((x) => x.id)).toEqual(['e'])
    expect(planUpcomingPrewarm(queue, 4)).toEqual([])
  })

  it('returns nothing on a slow connection (saveData / 2g / 3g)', () => {
    expect(planUpcomingPrewarm(queue, 0, { fastConnection: false })).toEqual([])
  })

  it('handles invalid input safely', () => {
    expect(planUpcomingPrewarm([], 0)).toEqual([])
    expect(planUpcomingPrewarm(queue, -1)).toEqual([])
  })

  it('dedupes repeated ids and skips the current track id if repeated', () => {
    const q = ['a', 'b', 'a', 'b', 'c'].map(t)
    expect(planUpcomingPrewarm(q, 0, { count: 4 }).map((x) => x.id)).toEqual(['b', 'c'])
  })

  it('respects a custom count', () => {
    expect(planUpcomingPrewarm(queue, 0, { count: 1 }).map((x) => x.id)).toEqual(['b'])
  })
})

describe('SupersedableRequest', () => {
  it('aborts the previous signal when a new request begins', () => {
    const r = new SupersedableRequest()
    const first = r.begin()
    expect(first.aborted).toBe(false)
    const second = r.begin()
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(false)
  })

  it('abort() cancels the active request and is idempotent', () => {
    const r = new SupersedableRequest()
    const s = r.begin()
    r.abort()
    r.abort()
    expect(s.aborted).toBe(true)
  })

  it('actually cancels an in-flight fetch-like promise (rapid skip scenario)', async () => {
    const r = new SupersedableRequest()
    const slowFetch = (signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => resolve('done'), 1000)
        signal.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }))
        })
      })

    const p1 = slowFetch(r.begin()) // track 1 search
    const p2 = slowFetch(r.begin()) // user skipped -> track 2 search
    await expect(p1).rejects.toSatisfy(isAbortError)
    r.abort()
    await expect(p2).rejects.toSatisfy(isAbortError)
  })
})

describe('isAbortError', () => {
  it('recognises AbortError by name or message', () => {
    expect(isAbortError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true)
    expect(isAbortError(new Error('The user aborted a request.'))).toBe(true)
  })

  it('rejects unrelated errors', () => {
    expect(isAbortError(new Error('network down'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})
