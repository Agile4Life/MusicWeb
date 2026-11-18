import { afterEach, describe, expect, it, vi } from 'vitest'
import { nctApiFetch, nctSearchUrl, nctSongUrl, pickGraphStream } from '@/lib/nctGraph'
import { normalizeNhacCuaTuiChartResponse, normalizeNhacCuaTuiSearchResponse, normalizeNhacCuaTuiSongResponse } from '@/lib/nhaccuatui'

const streams = [
  { type: '128', stream: 'https://stream.nct.vn/a.mp3?e=1', onlyVIP: false, status: 1 },
  { type: '320', stream: 'https://stream.nct.vn/a_hq.mp3?e=1', onlyVIP: false, status: 1 },
  { type: 'lossless', stream: 'https://a01.nct.vn/a.flac?e=1', onlyVIP: true, status: 0 },
]
const graphSong = { key: 'jQjwLvlhKazj', name: 'CHỜ ANH VỀ', artistName: 'B Ray, AMEE', image: 'https://image-cdn.nct.vn/x.jpg', duration: 214, streamURL: streams }
const ok = (data: unknown) => new Response(JSON.stringify({ code: 0, msg: 'success', data }), { status: 200 })

afterEach(() => vi.unstubAllGlobals())

describe('nctGraph adapter', () => {
  it('picks the best free stream and never a VIP-only one', () => {
    expect(pickGraphStream(streams)).toBe('https://stream.nct.vn/a_hq.mp3?e=1')
    expect(pickGraphStream([streams[2]])).toBeNull()
    expect(pickGraphStream(undefined)).toBeNull()
  })

  it('maps song detail to the legacy song shape the normalizer accepts', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => ok(graphSong))
    vi.stubGlobal('fetch', fetchMock)

    const res = await nctApiFetch(nctSongUrl('jQjwLvlhKazj'))
    expect(res.status).toBe(200)
    const song = normalizeNhacCuaTuiSongResponse(await res.json())
    expect(song).toMatchObject({ id: 'jQjwLvlhKazj', title: 'CHỜ ANH VỀ', artist: 'B Ray, AMEE', duration: 214, audioUrl: 'https://stream.nct.vn/a_hq.mp3?e=1' })

    const called = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(called.origin + called.pathname).toBe('https://graph.nhaccuatui.com/api/v1/song/detail/jQjwLvlhKazj')
    expect(called.searchParams.get('timestamp')).toMatch(/^\d+$/)
  })

  it('answers 404 for an unknown song (graph code != 0) so routes keep their not-found path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 404, msg: 'not found' }), { status: 200 })))
    expect((await nctApiFetch(nctSongUrl('missing'))).status).toBe(404)
  })

  it('maps search and chart results to { songs }', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) =>
      String(url).includes('/v3/search/all') ? ok({ songs: [graphSong] }) : ok({ items: [graphSong] })))

    const search = normalizeNhacCuaTuiSearchResponse(await (await nctApiFetch(nctSearchUrl('chờ anh về'))).json())
    expect(search).toEqual([{ id: 'jQjwLvlhKazj', title: 'CHỜ ANH VỀ', artist: 'B Ray, AMEE', thumbnail: 'https://image-cdn.nct.vn/x.jpg', duration: 214 }])

    const chart = normalizeNhacCuaTuiChartResponse(await (await nctApiFetch('/api/chart')).json())
    expect(chart.map((s) => s.id)).toEqual(['jQjwLvlhKazj'])
  })

  it('propagates network errors like fetch so retry logic still applies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(nctApiFetch(nctSongUrl('x'))).rejects.toThrow('fetch failed')
  })
})
