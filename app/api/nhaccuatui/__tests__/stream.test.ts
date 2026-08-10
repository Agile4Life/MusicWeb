import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, HEAD, OPTIONS } from '../stream/route'

describe('NhacCuaTui audio stream route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.NCT_API_BASE_URL
  })

  it('handles OPTIONS CORS preflight requests', async () => {
    const response = await OPTIONS()
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, HEAD, OPTIONS')
  })

  it('handles HEAD requests for song metadata inspection', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'nct-1',
        title: 'Xương Rồng',
        artist: 'Dangrangto',
        audioUrl: 'https://stream.nct.vn/song.mp3?expires=secret',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Content-Length': '1024',
        },
      }))

    const response = await HEAD(new Request('https://music.test/api/nhaccuatui/stream?id=nct-1'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(response.headers.get('Content-Length')).toBe('1024')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('returns 400 for a missing song id', async () => {
    const response = await GET(new Request('https://music.test/api/nhaccuatui/stream'))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Missing song id' })
  })

  it('resolves and streams a valid NCT audio response', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'
    const upstreamAudio = new Response(new Uint8Array([1, 2, 3]), {
      status: 206,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': '3',
        'Content-Range': 'bytes 0-2/10',
        'Accept-Ranges': 'bytes',
      },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'nct-1',
        title: 'Xương Rồng',
        artist: 'Dangrangto',
        audioUrl: 'https://stream.nct.vn/song.mp3?expires=secret',
      }), { status: 200 }))
      .mockResolvedValueOnce(upstreamAudio)

    const response = await GET(new Request(
      'https://music.test/api/nhaccuatui/stream?id=nct-1',
      { headers: { Range: 'bytes=0-2' } },
    ))

    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(response.headers.get('Content-Range')).toBe('bytes 0-2/10')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    const streamInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(new Headers(streamInit?.headers).get('Range')).toBe('bytes=0-2')
  })

  it('rejects a resolved URL outside stream.nct.vn', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'nct-1',
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      audioUrl: 'https://evil.example/audio.mp3?token=secret',
    }), { status: 200 }))

    const response = await GET(new Request('https://music.test/api/nhaccuatui/stream?id=nct-1'))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Song stream unavailable' })
  })
})
