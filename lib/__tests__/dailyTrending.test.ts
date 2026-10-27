import { describe, expect, it, vi } from 'vitest'
import type { Track } from '@/types'
import { createDailyTrendingService, getDailyTrendingCacheControl } from '@/lib/dailyTrending'

vi.mock('@/lib/trendingSources', () => ({ fetchDailySpotifyChartTracks: vi.fn() }))

const track = (id: string) => ({ id, title: `Song ${id}`, artist: 'Artist', source: 'spotify' }) as Track
function setup(start = '2026-10-25T16:59:00Z') {
  let time = Date.parse(start)
  const spotify = vi.fn(async () => [track('first'), track('second')])
  const nct = vi.fn(async () => [] as Track[])
  const deezer = vi.fn(async () => [] as Track[])
  const get = createDailyTrendingService({ spotify, nct, deezer, now: () => time })
  return { get, spotify, nct, deezer, setTime: (value: string) => { time = Date.parse(value) } }
}

describe('daily trending snapshots', () => {
  it('deduplicates simultaneous visitors and reuses ranked results for the Vietnam day', async () => {
    const s = setup()
    const [a, b] = await Promise.all([s.get('all'), s.get('all')])
    expect(a).toEqual(b)
    expect(a.spotify.map(t => t.id)).toEqual(['first', 'second'])
    expect(a.trending).toEqual({ date: '2026-10-25', updatedAt: '2026-10-25T16:59:00.000Z', nextRefreshAt: '2026-10-25T17:00:00.000Z', stale: false })
    await s.get('all')
    expect(s.spotify).toHaveBeenCalledTimes(1)
    expect(s.deezer).not.toHaveBeenCalled()
  })

  it('fetches changed chart contents at Vietnam midnight even less than three minutes later', async () => {
    const s = setup()
    await s.get('korean')
    s.setTime('2026-10-25T17:00:00Z')
    s.spotify.mockResolvedValue([track('new-number-one')])
    const next = await s.get('korean')
    expect(next.spotify.map(t => t.id)).toEqual(['new-number-one'])
    expect(next.trending.date).toBe('2026-10-26')
    expect(s.spotify).toHaveBeenCalledTimes(2)
    expect(s.nct).not.toHaveBeenCalled()
  })

  it('keeps the true old update timestamp during failure and recovers after short backoff', async () => {
    const s = setup()
    const first = await s.get('japanese')
    s.setTime('2026-10-25T17:00:00Z')
    s.spotify.mockRejectedValue(new Error('offline'))
    const stale = await s.get('japanese')
    expect(stale.spotify).toEqual(first.spotify)
    expect(stale.trending).toEqual({ ...first.trending, stale: true, nextRefreshAt: '2026-10-25T17:05:00.000Z' })
    expect(getDailyTrendingCacheControl(stale, Date.parse('2026-10-25T17:00:00Z'))).toBe('no-store')
    await s.get('japanese')
    expect(s.spotify).toHaveBeenCalledTimes(2)
    s.setTime('2026-10-25T17:05:01Z')
    s.spotify.mockResolvedValue([track('recovered')])
    expect((await s.get('japanese')).trending.stale).toBe(false)
    expect(s.spotify).toHaveBeenCalledTimes(3)
  })

  it('does not cache empty results all day or invent a successful update timestamp', async () => {
    const s = setup()
    s.spotify.mockResolvedValue([])
    const empty = await s.get('usuk')
    expect(empty.trending).toMatchObject({ stale: true, updatedAt: '' })
    expect(s.deezer).toHaveBeenCalledOnce()
    s.setTime('2026-10-25T17:00:00Z')
    s.spotify.mockResolvedValue([track('available')])
    expect((await s.get('usuk')).spotify[0].id).toBe('available')
  })

  it('normalizes unknown categories so request values cannot grow the cache', async () => {
    const s = setup()
    await s.get('invented-one')
    await s.get('invented-two')
    expect(s.spotify).toHaveBeenCalledOnce()
    expect(s.spotify).toHaveBeenCalledWith('all')
  })

  it('retains live partial charts and filters retired tracks and duplicates without changing ranks', async () => {
    const s = setup()
    s.spotify.mockResolvedValue([track('first'), track('first'), { ...track('itunes-legacy') }, track('second')])
    const result = await s.get('all')
    expect(result.spotify.map(t => t.id)).toEqual(['first', 'second'])
    expect(result.trending.stale).toBe(false)
    expect(s.nct).toHaveBeenCalledOnce()
  })

  it('uses one live fallback chart when Spotify is unavailable', async () => {
    const s = setup()
    s.spotify.mockRejectedValue(new Error('unavailable'))
    s.deezer.mockResolvedValue([track('fallback')])
    const result = await s.get('usuk')
    expect(result.deezer.map(t => t.id)).toEqual(['fallback'])
    expect(result.trending.stale).toBe(true)
    await s.get('usuk')
    expect(s.deezer).toHaveBeenCalledOnce()
  })

  it.each(['vietnamese', 'korean', 'chinese', 'japanese'])('does not label the global Deezer chart as a %s chart', async category => {
    const s = setup()
    s.spotify.mockResolvedValue([])
    s.deezer.mockResolvedValue([track('global')])
    const result = await s.get(category)
    expect(result.deezer).toEqual([])
    expect(s.deezer).not.toHaveBeenCalled()
  })

  it('retries a degraded NCT snapshot instead of freezing missing Spotify results all day', async () => {
    const s = setup('2026-10-25T05:00:00Z')
    s.spotify.mockResolvedValue([])
    s.nct.mockResolvedValue([track('vietnam-chart')])
    const partial = await s.get('vietnamese')
    expect(partial.nhaccuatui[0].id).toBe('vietnam-chart')
    expect(partial.trending).toEqual({ date: '2026-10-25', updatedAt: '2026-10-25T05:00:00.000Z', nextRefreshAt: '2026-10-25T05:05:00.000Z', stale: true })
    await s.get('vietnamese')
    expect(s.spotify).toHaveBeenCalledOnce()
    s.setTime('2026-10-25T05:05:01Z')
    s.spotify.mockResolvedValue([track('regional-chart')])
    const recovered = await s.get('vietnamese')
    expect(recovered.spotify[0].id).toBe('regional-chart')
    expect(recovered.trending.stale).toBe(false)
  })

  it('retries an empty first load within the same day after five minutes', async () => {
    const s = setup('2026-10-25T05:00:00Z')
    s.spotify.mockResolvedValue([])
    expect((await s.get('chinese')).trending.updatedAt).toBe('')
    s.setTime('2026-10-25T05:05:01Z')
    s.spotify.mockResolvedValue([track('later')])
    const recovered = await s.get('chinese')
    expect(recovered.spotify[0].id).toBe('later')
    expect(recovered.trending.updatedAt).toBe('2026-10-25T05:05:01.000Z')
  })

  it('does not let a slow previous-day request replace the new-day snapshot', async () => {
    const s = setup()
    let resolveOld!: (tracks: Track[]) => void
    s.spotify.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    const oldRequest = s.get('usuk')
    s.setTime('2026-10-25T17:00:00Z')
    s.spotify.mockResolvedValue([track('today')])
    const today = await s.get('usuk')
    resolveOld([track('yesterday')])
    await oldRequest
    expect(await s.get('usuk')).toEqual(today)
  })

  it('bounds HTTP cache freshness by midnight with no stale revalidation window', async () => {
    const s = setup()
    const data = await s.get('all')
    expect(getDailyTrendingCacheControl(data, Date.parse('2026-10-25T16:59:00Z'))).toBe('public, max-age=60, s-maxage=60, must-revalidate')
    expect(getDailyTrendingCacheControl(data, Date.parse('2026-10-25T17:00:00Z'))).toBe('no-store')
  })
})
