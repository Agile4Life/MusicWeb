import type { GlobalSearchTracks } from '@/lib/searchApi'
import { getNextTrendingRefreshAt, getTrendingDay } from '@/lib/trendingDay'

export function retainTrendingSnapshot(previous: GlobalSearchTracks, next: GlobalSearchTracks): GlobalSearchTracks {
  if (next.spotify.length + next.deezer.length + next.nhaccuatui.length > 0) return next
  if (previous.spotify.length + previous.deezer.length + previous.nhaccuatui.length === 0) return next
  return { ...previous, ...(previous.trending ? { trending: { ...previous.trending, stale: true } } : {}) }
}

export function isTrendingSnapshotFresh(data: GlobalSearchTracks, day: string): boolean {
  const hasTracks = data.spotify.length + data.deezer.length + data.nhaccuatui.length > 0
  return hasTracks && (!data.trending || (!data.trending.stale && data.trending.date === day))
}

export function startDailyTrendingRefresh(
  refresh: (day: string) => Promise<boolean>,
  events: { focus: EventTarget; visibility: EventTarget & { visibilityState: string } },
): () => void {
  let day = ''
  let generation = 0
  let disposed = false
  let retryAt = Infinity
  let timer: ReturnType<typeof setTimeout>

  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(check, Math.max(1, Math.min(retryAt, getNextTrendingRefreshAt()) - Date.now()))
  }
  const run = () => {
    day = getTrendingDay()
    const current = ++generation
    retryAt = Infinity
    // Keep midnight armed even while a request is still in flight.
    schedule()
    Promise.resolve().then(() => disposed ? true : refresh(day)).catch(() => false).then((fresh) => {
      if (disposed || current !== generation) return
      retryAt = fresh ? Infinity : Date.now() + 5 * 60 * 1000
      schedule()
    })
  }
  function check() {
    if (disposed) return
    if (day !== getTrendingDay() || Date.now() >= retryAt) run()
    else schedule()
  }
  const onVisibility = () => {
    if (events.visibility.visibilityState === 'visible') check()
  }
  events.focus.addEventListener('focus', check)
  events.visibility.addEventListener('visibilitychange', onVisibility)
  run()
  return () => {
    disposed = true
    generation++
    clearTimeout(timer)
    events.focus.removeEventListener('focus', check)
    events.visibility.removeEventListener('visibilitychange', onVisibility)
  }
}
