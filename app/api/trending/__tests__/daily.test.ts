import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@/types'

const providers = vi.hoisted(() => ({ chart: vi.fn(), fixedArtists: vi.fn(), deezer: vi.fn() }))
vi.mock('@/lib/trendingSources', () => ({ fetchDailySpotifyChartTracks: providers.chart }))
vi.mock('@/lib/spotify', async (original) => ({
  ...await original<typeof import('@/lib/spotify')>(), getTrendingSpotifyTracks: providers.fixedArtists,
}))
vi.mock('@/lib/deezer', () => ({ getTrendingDeezerTracks: providers.deezer }))

describe('legacy trending daily charts', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T16:59:30Z'))
    providers.chart.mockResolvedValue([{ id: 'chart-one', title: 'Current Song', artist: 'Chart Artist', source: 'spotify' } as Track])
    providers.fixedArtists.mockResolvedValue([])
    providers.deezer.mockResolvedValue([])
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [] })))
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('uses the shared live chart snapshot and bounds freshness to midnight', async () => {
    const { GET } = await import('../route')
    const response = await GET(new Request('https://music.test/api/trending?category=usuk&limit=1&date=1999-01-01'))
    const data = await response.json()
    expect(data.tracks.map((track: Track) => track.id)).toEqual(['chart-one'])
    expect(data.trending.date).toBe('2026-10-25')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=30, s-maxage=30, must-revalidate')
    expect(providers.fixedArtists).not.toHaveBeenCalled()
    await GET(new Request('https://music.test/api/trending?category=usuk&limit=20'))
    expect(providers.chart).toHaveBeenCalledOnce()
    vi.setSystemTime(new Date('2026-10-25T17:00:00Z'))
    providers.chart.mockResolvedValue([{ id: 'tomorrow', title: 'New Song', artist: 'Chart Artist', source: 'spotify' } as Track])
    const next = await GET(new Request('https://music.test/api/trending?category=usuk'))
    expect((await next.json()).tracks[0].id).toBe('tomorrow')
    expect(providers.chart).toHaveBeenCalledTimes(2)
  })
})
