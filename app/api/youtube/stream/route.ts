import { NextRequest, NextResponse } from 'next/server'
import dns from 'dns'
import ytdl from '@distube/ytdl-core'

try {
  dns.setDefaultResultOrder('ipv4first')
} catch {}

export const dynamic = 'force-dynamic'

interface ResolvedYouTubeStream {
  url: string
  mimeType: string
}

async function resolveYouTubeAudioStream(videoId: string): Promise<ResolvedYouTubeStream | null> {
  if (!videoId) return null

  // Stage 1: Try @distube/ytdl-core (Direct YouTube InnerTube Decipher)
  try {
    const info = await ytdl.getInfo(`https://www.youtube.com/watch?v=${videoId}`, {
      requestOptions: {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      },
    })
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly')
    if (audioFormats && audioFormats.length > 0) {
      const m4aFormat = audioFormats.find((f) => f.mimeType && f.mimeType.includes('audio/mp4')) || audioFormats[0]
      if (m4aFormat && m4aFormat.url) {
        return {
          url: m4aFormat.url,
          mimeType: m4aFormat.mimeType || 'audio/mp4',
        }
      }
    }
  } catch (err: any) {
    console.warn('ytdl-core stream resolution warning:', err?.message || err)
  }

  // Stage 2: Fallback to Piped API instances
  const pipedInstances = [
    'https://pipedapi.kavin.rocks/streams/',
    'https://api.piped.video/streams/',
    'https://pipedapi.palvelintalo.fi/streams/',
    'https://pipedapi.mha.fi/streams/',
    'https://pipedapi.adminforge.de/streams/',
    'https://pipedapi.aston.cx/streams/',
  ]

  for (const base of pipedInstances) {
    try {
      const res = await fetch(`${base}${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(3500),
      })
      if (res.ok) {
        const data = await res.json()
        const audioStreams = data.audioStreams || []
        if (audioStreams.length > 0) {
          const best = audioStreams.find((s: any) => s.mimeType && s.mimeType.includes('audio/mp4')) || audioStreams[0]
          if (best && best.url) {
            return {
              url: best.url,
              mimeType: best.mimeType || 'audio/mp4',
            }
          }
        }
      }
    } catch {}
  }

  // Stage 3: Fallback to Invidious API instances
  const invidiousInstances = [
    'https://inv.tux.pizza/api/v1/videos/',
    'https://invidious.nerdvpn.de/api/v1/videos/',
    'https://invidious.flokinet.to/api/v1/videos/',
  ]

  for (const base of invidiousInstances) {
    try {
      const res = await fetch(`${base}${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
        signal: AbortSignal.timeout(3500),
      })
      if (res.ok) {
        const data = await res.json()
        const adaptiveFormats = data.adaptiveFormats || []
        const audio = adaptiveFormats.filter((f: any) => f.type && f.type.includes('audio'))
        if (audio.length > 0 && audio[0].url) {
          return {
            url: audio[0].url,
            mimeType: audio[0].type || 'audio/mp4',
          }
        }
      }
    } catch {}
  }

  return null
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const videoId = searchParams.get('id') || searchParams.get('videoId')

    if (!videoId) {
      return NextResponse.json({ error: 'Missing YouTube video ID parameter' }, { status: 400 })
    }

    const resolved = await resolveYouTubeAudioStream(videoId)
    if (!resolved || !resolved.url) {
      return NextResponse.json(
        { error: 'YouTube: could not extract playable audio stream' },
        { status: 502 }
      )
    }

    const range = req.headers.get('range')
    const proxyHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
    if (range) proxyHeaders['Range'] = range

    const streamRes = await fetch(resolved.url, {
      headers: proxyHeaders,
      cache: 'no-store',
    })

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
    const videoId = searchParams.get('id') || searchParams.get('videoId')

    if (!videoId) {
      return new NextResponse(null, { status: 400 })
    }

    const resolved = await resolveYouTubeAudioStream(videoId)
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
