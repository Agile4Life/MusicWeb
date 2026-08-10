import { NextRequest, NextResponse } from 'next/server'
import dns from 'dns'
import ytdl from '@distube/ytdl-core'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'

try {
  dns.setDefaultResultOrder('ipv4first')
} catch {}

export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)

export interface ResolvedYouTubeStream {
  url: string
  mimeType: string
}

// Direct stream URLs are valid for hours — cache them server-side so repeated
// plays / track switches resolve instantly instead of re-running yt-dlp (~3-5s).
const streamUrlCache = new Map<string, { url: string; mimeType: string; expiresAt: number }>()
const STREAM_CACHE_TTL = 2.5 * 60 * 60 * 1000 // googlevideo URLs expire after ~6h

export async function resolveYouTubeAudioStreamCached(videoId: string): Promise<ResolvedYouTubeStream | null> {
  const cached = streamUrlCache.get(videoId)
  if (cached && Date.now() < cached.expiresAt) {
    return { url: cached.url, mimeType: cached.mimeType }
  }

  const resolved = await resolveYouTubeAudioStream(videoId)
  if (resolved && resolved.url) {
    streamUrlCache.set(videoId, { ...resolved, expiresAt: Date.now() + STREAM_CACHE_TTL })
  }
  return resolved
}

function findYtDlpBinary(): string | null {
  const candidates = [
    process.env.YTDLP_PATH,
    path.join(process.cwd(), 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
    'yt-dlp',
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (candidate === 'yt-dlp' || fs.existsSync(candidate)) return candidate
  }
  return null
}

// Stage 1: yt-dlp binary extraction (handles YouTube PO-token enforcement & cipher challenges)
async function resolveViaYtDlp(videoId: string): Promise<ResolvedYouTubeStream | null> {
  const binary = findYtDlpBinary()
  if (!binary) return null

  try {
    const { stdout } = await execFileAsync(
      binary,
      [
        '--get-url',
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout',
        '15',
        '-f',
        'bestaudio[ext=m4a]/bestaudio[ext=mp4]/bestaudio',
        `https://www.youtube.com/watch?v=${videoId}`,
      ],
      { timeout: 25000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }
    )

    const url = stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('http'))
    if (!url) return null

    let mimeType = ''
    if (/\.(m4a|mp4)(\?|$)/.test(url)) mimeType = 'audio/mp4'
    else if (/\.(webm|opus)(\?|$)/.test(url)) mimeType = 'audio/webm'

    return { url, mimeType }
  } catch (err: any) {
    console.warn('yt-dlp stream resolution warning:', err?.message || err)
    return null
  }
}

// Stage 2 (exported for reuse): Official YouTube InnerTube ANDROID client —
// returns un-ciphered direct audio URLs. The old TVHTML5_SIMPLY_EMBEDDED_PLAYER
// client was deprecated by YouTube ("YouTube is no longer supported in this
// application or device").
// NOTE: googlevideo URLs are IP-bound — they only work when fetched from the
// same server that resolved them (the proxy GET below), not from other clients.
// Exported so the NCT->YouTube matching endpoint can cheaply verify that a
// candidate video is actually extractable from this server before caching it:
// YouTube refuses some videos (LOGIN_REQUIRED) when resolved from datacenter IPs.
export async function resolveYouTubeAudioStreamAndroid(videoId: string): Promise<ResolvedYouTubeStream | null> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            androidSdkVersion: 34,
          },
        },
        videoId: videoId,
      }),
      signal: AbortSignal.timeout(4500),
    })

    if (res.ok) {
      const data = await res.json()
      const streamingData = data.streamingData || {}
      const formats = [...(streamingData.formats || []), ...(streamingData.adaptiveFormats || [])]
      const audioOnly = formats.filter((f: any) => f.mimeType && f.mimeType.includes('audio'))

      if (audioOnly.length > 0) {
        const bestAudio =
          audioOnly.find((f: any) => f.url && f.mimeType.includes('audio/mp4')) ||
          audioOnly.find((f: any) => f.url)

        if (bestAudio && bestAudio.url) {
          return {
            url: bestAudio.url,
            mimeType: bestAudio.mimeType || 'audio/mp4',
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('InnerTube ANDROID stream resolution warning:', err?.message || err)
  }
  return null
}

async function resolveYouTubeAudioStream(videoId: string): Promise<ResolvedYouTubeStream | null> {
  if (!videoId) return null

  // Stage 1: yt-dlp (most reliable; handles PO tokens)
  const ytDlpStream = await resolveViaYtDlp(videoId)
  if (ytDlpStream) return ytDlpStream

  // Stage 2: InnerTube ANDROID client
  const androidStream = await resolveYouTubeAudioStreamAndroid(videoId)
  if (androidStream) return androidStream

  // Stage 3: Fallback to @distube/ytdl-core
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

  // Stage 4: Fallback to Piped API instances
  const pipedInstances = [
    'https://pipedapi.mha.fi/streams/',
    'https://pipedapi.adminforge.de/streams/',
    'https://pipedapi.kavin.rocks/streams/',
    'https://api.piped.video/streams/',
  ]

  for (const base of pipedInstances) {
    try {
      const res = await fetch(`${base}${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
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

  return null
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const videoId = searchParams.get('id') || searchParams.get('videoId')

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
    const fetchUpstream = (url: string) => {
      const proxyHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      }
      if (range) proxyHeaders['Range'] = range
      return fetch(url, { headers: proxyHeaders, cache: 'no-store' })
    }

    let streamRes = await fetchUpstream(resolved.url)

    // The cached googlevideo URL may be stale (expired, or resolved on another
    // serverless instance — googlevideo URLs are IP-bound). Drop it and
    // re-resolve once before giving up.
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
    const videoId = searchParams.get('id') || searchParams.get('videoId')

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
