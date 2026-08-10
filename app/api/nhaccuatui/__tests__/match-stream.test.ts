import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, OPTIONS } from '../match-stream/route'

interface MockVideo {
  videoId: string
  title: string
  artist: string
  length: string
}

function innerTubeSearchResponse(videos: MockVideo[]): Response {
  return new Response(JSON.stringify({
    contents: {
      twoColumnSearchResultsRenderer: {
        primaryContents: {
          sectionListRenderer: {
            contents: [
              {
                itemSectionRenderer: {
                  contents: videos.map((video) => ({
                    videoRenderer: {
                      videoId: video.videoId,
                      title: { runs: [{ text: video.title }] },
                      ownerText: { runs: [{ text: video.artist }] },
                      lengthText: { simpleText: video.length },
                      viewCountText: { simpleText: '1M views' },
                    },
                  })),
                },
              },
            ],
          },
        },
      },
    },
  }), { status: 200 })
}

describe('NhacCuaTui match-stream route', () => {
  beforeEach(() => {
    // Force the InnerTube search path (no official Data API key in tests)
    delete process.env.NEXT_PUBLIC_YOUTUBE_API_KEY
    delete process.env.YOUTUBE_API_KEY
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.NCT_API_BASE_URL
  })

  it('handles OPTIONS CORS preflight requests', async () => {
    const response = await OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('returns 400 for a missing song id', async () => {
    const response = await GET(new Request('https://music.test/api/nhaccuatui/match-stream'))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Missing song id' })
  })

  it('matches an NCT song to a proxied YouTube stream URL', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        song: { id: 'nct-match-1', title: 'Xương Rồng', artist: 'Dangrangto', duration: 254 },
      }), { status: 200 }))
      .mockResolvedValueOnce(innerTubeSearchResponse([
        { videoId: 'abcDEF12345', title: 'Xương Rồng - Dangrangto (Official Audio)', artist: 'Dangrangto', length: '4:12' },
      ]))

    const response = await GET(new Request('https://music.test/api/nhaccuatui/match-stream?id=nct-match-1'))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.videoId).toBe('abcDEF12345')
    expect(body.url).toBe('https://music.test/api/youtube/stream?id=abcDEF12345')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')

    // NCT metadata fetched from the configured backend
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://nct-api.test/api/song/nct-match-1')
  })

  it('serves repeat lookups from the in-memory match cache', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        song: { id: 'nct-match-cache', title: 'Xương Rồng', artist: 'Dangrangto', duration: 254 },
      }), { status: 200 }))
      .mockResolvedValueOnce(innerTubeSearchResponse([
        { videoId: 'cacheID1234', title: 'Xương Rồng - Dangrangto (Official Audio)', artist: 'Dangrangto', length: '4:12' },
      ]))

    const url = 'https://music.test/api/nhaccuatui/match-stream?id=nct-match-cache'
    const first = await GET(new Request(url))
    const second = await GET(new Request(url))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toMatchObject({ videoId: 'cacheID1234' })
    // 1 NCT metadata fetch + 1 InnerTube search — the second request hit the cache
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns 502 when the NCT song has no usable metadata', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'nct-match-2' }), { status: 200 }))

    const response = await GET(new Request('https://music.test/api/nhaccuatui/match-stream?id=nct-match-2'))
    expect(response.status).toBe(502)
  })

  it('returns 502 when no YouTube candidate matches the song', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        song: { id: 'nct-match-3', title: 'Xương Rồng', artist: 'Dangrangto', duration: 254 },
      }), { status: 200 }))
      .mockResolvedValueOnce(innerTubeSearchResponse([])) // InnerTube empty
      .mockResolvedValueOnce(new Response('not found', { status: 503 })) // HTML scrape fallback fails

    const response = await GET(new Request('https://music.test/api/nhaccuatui/match-stream?id=nct-match-3'))
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'No matching YouTube stream found' })
  })
})
