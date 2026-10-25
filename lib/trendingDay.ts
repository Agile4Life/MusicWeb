const DAY_MS = 24 * 60 * 60 * 1000
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000

export function getTrendingDay(now = Date.now()): string {
  return new Date(now + VIETNAM_OFFSET_MS).toISOString().slice(0, 10)
}

export function getNextTrendingRefreshAt(now = Date.now()): number {
  return (Math.floor((now + VIETNAM_OFFSET_MS) / DAY_MS) + 1) * DAY_MS - VIETNAM_OFFSET_MS
}

export function getTrendingCacheSeconds(now = Date.now()): number {
  return Math.max(0, Math.floor((getNextTrendingRefreshAt(now) - now) / 1000))
}
