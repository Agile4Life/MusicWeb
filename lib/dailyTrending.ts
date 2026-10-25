import type { Track } from '@/types'
import { fetchDailySpotifyChartTracks } from '@/lib/trendingSources'
import { getTrendingDeezerTracks } from '@/lib/deezer'
import { normalizeNhacCuaTuiChartResponse, nhacCuaTuiSearchItemToTrack } from '@/lib/nhaccuatui'
import { isCleanTrendingTrack } from '@/lib/spotify'
import { normalizeIdentity } from '@/lib/catalogMatching'
import { isRetiredMusicTrack } from '@/lib/retiredMusicSources'
import { getTrendingDay, getNextTrendingRefreshAt, getTrendingCacheSeconds } from '@/lib/trendingDay'

export interface DailyTrendingResult {
  nhaccuatui: Track[]
  local: Track[]
  youtube: Track[]
  spotify: Track[]
  deezer: Track[]
  soundcloud: Track[]
  trending: { date: string; updatedAt: string; nextRefreshAt: string; stale: boolean }
}

interface TrendingPorts {
  spotify: (category: string) => Promise<Track[]>
  nct: () => Promise<Track[]>
  deezer: () => Promise<Track[]>
  now: () => number
}

const CATEGORIES = new Set(['all', 'vietnamese', 'usuk', 'korean', 'chinese', 'japanese'])
const RETRY_MS = 5 * 60 * 1000

function cleanTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>()
  return tracks.filter(track => {
    if (!track || isRetiredMusicTrack(track) || !isCleanTrendingTrack(track.title, track.artist)) return false
    const key = `${normalizeIdentity(track.title)}::${normalizeIdentity((track.artist || '').split(',')[0])}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 50)
}

const emptyGroups = () => ({ nhaccuatui: [], local: [], youtube: [], spotify: [], deezer: [], soundcloud: [] })

/** Six normalized categories bound snapshot storage; failed refreshes retry in five minutes. */
export function createDailyTrendingService(ports: TrendingPorts) {
  const snapshots = new Map<string, DailyTrendingResult>()
  const retries = new Map<string, { day: string; at: number }>()
  const inFlight = new Map<string, Promise<DailyTrendingResult>>()

  async function get(category = 'all'): Promise<DailyTrendingResult> {
    category = CATEGORIES.has(category) ? category : 'all'
    const now = ports.now()
    const day = getTrendingDay(now)
    const snapshot = snapshots.get(category)
    if (snapshot?.trending.date === day && !snapshot.trending.stale) return snapshot
    const retry = retries.get(category)
    const staleResult = (at: number): DailyTrendingResult => ({
      ...(snapshots.get(category) || emptyGroups()),
      trending: {
        date: snapshots.get(category)?.trending.date || day,
        updatedAt: snapshots.get(category)?.trending.updatedAt || '',
        nextRefreshAt: new Date(at).toISOString(),
        stale: true,
      },
    })
    if (retry?.day === day && retry.at > now) return staleResult(retry.at)
    const key = `${category}:${day}`
    const pending = inFlight.get(key)
    if (pending) return pending

    const request = (async (): Promise<DailyTrendingResult> => {
      const safe = async (fetchTracks: () => Promise<Track[]>) => {
        try { return cleanTracks(await fetchTracks()) } catch { return [] }
      }
      const [spotify, nhaccuatui] = await Promise.all([
        safe(() => ports.spotify(category)),
        category === 'all' || category === 'vietnamese' ? safe(ports.nct) : Promise.resolve([]),
      ])
      // Deezer exposes a global chart, which cannot substitute for an Asian regional chart.
      const deezer = !spotify.length && (category === 'all' || category === 'usuk') ? await safe(ports.deezer) : []
      const completedAt = ports.now()
      // A request begun yesterday must never replace today's snapshot or retry state.
      if (getTrendingDay(completedAt) !== day) return get(category)
      if (spotify.length || nhaccuatui.length || deezer.length) {
        const degraded = !spotify.length
        const nextRefreshAt = degraded ? Math.min(completedAt + RETRY_MS, getNextTrendingRefreshAt(completedAt)) : getNextTrendingRefreshAt(completedAt)
        const data: DailyTrendingResult = {
          ...emptyGroups(), spotify, nhaccuatui, deezer,
          trending: { date: day, updatedAt: new Date(completedAt).toISOString(), nextRefreshAt: new Date(nextRefreshAt).toISOString(), stale: degraded },
        }
        snapshots.set(category, data)
        if (degraded) retries.set(category, { day, at: nextRefreshAt })
        else retries.delete(category)
        return data
      }
      const retryAt = Math.min(completedAt + RETRY_MS, getNextTrendingRefreshAt(completedAt))
      retries.set(category, { day, at: retryAt })
      return staleResult(retryAt)
    })()
    inFlight.set(key, request)
    try { return await request } finally { inFlight.delete(key) }
  }
  return get
}

async function fetchNhacCuaTuiChart(): Promise<Track[]> {
  const url = new URL(process.env.NCT_API_BASE_URL || 'https://music-api.vanhuy2004h.io.vn')
  url.pathname = '/api/chart'
  url.search = ''
  const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2500) })
  if (!response.ok) return []
  return normalizeNhacCuaTuiChartResponse(await response.json()).slice(0, 24).map(nhacCuaTuiSearchItemToTrack)
}

export const getDailyTrending = createDailyTrendingService({
  spotify: fetchDailySpotifyChartTracks,
  nct: fetchNhacCuaTuiChart,
  deezer: () => getTrendingDeezerTracks(24),
  now: () => Date.now(),
})

export function getDailyTrendingCacheControl(data: DailyTrendingResult, now = Date.now()): string {
  if (data.trending.stale || data.trending.date !== getTrendingDay(now)) return 'no-store'
  const seconds = getTrendingCacheSeconds(now)
  if (!seconds) return 'no-store'
  return `public, max-age=${Math.min(60, seconds)}, s-maxage=${seconds}, must-revalidate`
}
