import { describe, expect, it } from 'vitest'
import { getNextTrendingRefreshAt, getTrendingCacheSeconds, getTrendingDay } from '../trendingDay'

describe('Vietnam daily trending boundary', () => {
  it.each([
    ['2026-10-25T16:59:59.999Z', '2026-10-25', '2026-10-25T17:00:00.000Z'],
    ['2026-10-25T17:00:00.000Z', '2026-10-26', '2026-10-26T17:00:00.000Z'],
    ['2026-12-31T17:00:00.000Z', '2027-01-01', '2027-01-01T17:00:00.000Z'],
    ['2028-02-28T17:00:00.000Z', '2028-02-29', '2028-02-29T17:00:00.000Z'],
  ])('uses the local calendar date at %s', (iso, day, next) => {
    const now = Date.parse(iso)
    expect(getTrendingDay(now)).toBe(day)
    expect(new Date(getNextTrendingRefreshAt(now)).toISOString()).toBe(next)
  })

  it('never lets an HTTP cache entry cross local midnight', () => {
    expect(getTrendingCacheSeconds(Date.parse('2026-10-25T16:59:59.500Z'))).toBe(0)
    expect(getTrendingCacheSeconds(Date.parse('2026-10-25T17:00:00Z'))).toBe(86400)
  })
})
