import { NextRequest, NextResponse } from 'next/server'
import { resolveYouTubeAudioStreamCached, streamUrlCache } from '@/lib/youtubeStream'

export const dynamic = 'force-dynamic'
// Maximum execution time per invocation (Vercel Pro limit = 300s).
// Each browser Range request is a separate invocation — resolution takes ~8-15s
// on cold start; subsequent Range chunks complete in < 1s.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const videoId = (searchParams.get('id') || searchParams.get('videoId') || '').trim()

    if (!videoId) {
      return NextResponse.json({ error: 'Missing YouTube video ID parameter' }, { status: 400 })
    }

    let resolved = await resolveYouTubeAudioStreamCached(videoId)
    if (!resolved || !resolved.url) {
      return NextResponse.json(
        { error: 'YouTube: could not extract playable audio stream' },
        { status: 502 }
      )
    }

    const range = req.headers.get('range')
    if (range) {
      const match = range.match(/^bytes=(\d+)-(\d+)$/)
      if (match && parseInt(match[1], 10) > parseInt(match[2], 10)) {
        return new Response(null, {
          status: 416,
          headers: {
            'Content-Range': 'bytes */*',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }
    }
    const fetchUpstream = (url: string) => {
      const proxyHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      }
      if (range) proxyHeaders['Range'] = range
      return fetch(url, { headers: proxyHeaders, cache: 'no-store' })
    }

    let streamRes = await fetchUpstream(resolved.url)

    if (!streamRes.ok) {
      streamUrlCache.delete(videoId)
      const fresh = await resolveYouTubeAudioStreamCached(videoId)
      if (fresh && fresh.url) {
        resolved = fresh
        streamRes = await fetchUpstream(resolved.url)
      }
    }

    if (!streamRes.ok) {
      return NextResponse.json(
        { error: 'YouTube: could not extract playable audio stream' },
        { status: 502 }
      )
    }

    const resHeaders = new Headers()
    resHeaders.set('Content-Type', resolved.mimeType || streamRes.headers.get('content-type') || 'audio/mp4')
    resHeaders.set('Access-Control-Allow-Origin', '*')
    resHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    resHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type')
    resHeaders.set('Accept-Ranges', 'bytes')
    resHeaders.set('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600')

    const cl = streamRes.headers.get('content-length')
    if (cl) resHeaders.set('Content-Length', cl)

    const cr = streamRes.headers.get('content-range')
    if (cr) resHeaders.set('Content-Range', cr)

    return new Response(streamRes.body, {
      status: streamRes.status,
      headers: resHeaders,
    })
  } catch (err: any) {
    console.error('YouTube audio stream GET error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
    },
  })
}

export async function HEAD(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const videoId = (searchParams.get('id') || searchParams.get('videoId') || '').trim()

    if (!videoId) {
      return new NextResponse(null, { status: 400 })
    }

    const resolved = await resolveYouTubeAudioStreamCached(videoId)
    if (!resolved || !resolved.url) {
      return new NextResponse(null, { status: 502 })
    }

    const res = await fetch(resolved.url, {
      method: 'HEAD',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    })

    const headers = new Headers()
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Range, Content-Type')
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600')
    headers.set('Content-Type', resolved.mimeType || 'audio/mp4')

    const cl = res.headers.get('content-length')
    if (cl) headers.set('Content-Length', cl)

    return new NextResponse(null, { status: 200, headers })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
