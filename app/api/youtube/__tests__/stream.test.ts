import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

// Stage 1 shells out to bin/yt-dlp.exe which exists in this repo — stub it out
// so tests never spawn a real process or hit the network.
vi.mock('child_process', async (importOriginal) => {
  const mod = await importOriginal<typeof import('child_process')>()
  return {
    ...mod,
    execFile: vi.fn((...args: unknown[]) => {
      const callback = args[args.length - 1] as (err: Error) => void
      callback(new Error('yt-dlp unavailable in tests'))
    }),
  }
})

import { GET } from '../stream/route'

function innerTubePlayerResponse(videoUrl: string): Response {
  return new Response(JSON.stringify({
    streamingData: {
      adaptiveFormats: [
        { mimeType: 'audio/mp4; codecs="mp4a.40.2"', url: videoUrl },
      ],
    },
  }), { status: 200 })
}

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

describe('YouTube audio stream route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('re-resolves once when the cached googlevideo URL fails upstream', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      // Stage 2 InnerTube player -> stale (IP-bound / expired) direct URL
      .mockResolvedValueOnce(innerTubePlayerResponse('https://googlevideo.test/stale'))
      // Proxy GET of the stale URL -> rejected upstream
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      // Re-resolution: InnerTube player again -> fresh URL
      .mockResolvedValueOnce(innerTubePlayerResponse('https://googlevideo.test/fresh'))
      // Proxy GET of the fresh URL -> audio bytes
      .mockResolvedValueOnce(new Response(new Uint8Array([9, 9, 9]), {
        status: 206,
        headers: {
          'Content-Type': 'audio/mp4',
          'Content-Length': '3',
          'Content-Range': 'bytes 0-2/100',
        },
      }))

    const response = await GET(asNextRequest(new Request(
      'https://music.test/api/youtube/stream?id=retryVid123',
      { headers: { Range: 'bytes=0-2' } },
    )))

    expect(response.status).toBe(206)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 9, 9]))
    expect(response.headers.get('Content-Range')).toBe('bytes 0-2/100')
    // InnerTube x2 + upstream proxy fetch x2
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(String(fetchMock.mock.calls[3]?.[0])).toBe('https://googlevideo.test/fresh')
  })

  it('returns 502 when the upstream retry also fails', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(innerTubePlayerResponse('https://googlevideo.test/stale-a'))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      .mockResolvedValueOnce(innerTubePlayerResponse('https://googlevideo.test/stale-b'))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))

    const response = await GET(asNextRequest(new Request(
      'https://music.test/api/youtube/stream?id=retryVid456',
    )))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      error: 'YouTube: could not extract playable audio stream',
    })
  })
})
