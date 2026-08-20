import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/youtube/resolve?id=<videoId>&secret=<INTERNAL_YT_RESOLVE_SECRET>
 *
 * Resolves a YouTube video's audio-only stream URL using non-IP-bound methods.
 * This endpoint is called exclusively by the YouTube Stream Cache Cloudflare Worker
 * as a last-resort fallback when InnerTube ANDROID/iOS resolution fails directly
 * from the Worker's IP.
 *
 * IMPORTANT: Only ANDROID InnerTube + Piped are used here — NOT yt-dlp or ytdl-core.
 * yt-dlp/ytdl-core resolve via the web client which produces IP-bound URLs.
 * IP-bound URLs cannot be reused by the CF Worker (different IP from Vercel).
 *
 * Protected by INTERNAL_YT_RESOLVE_SECRET to prevent public abuse.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip'
const IOS_UA = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_4 like Mac OS X)'

// ── InnerTube ANDROID ────────────────────────────────────────────────────────

async function resolveViaAndroid(videoId: string): Promise<{ url: string; mimeType: string } | null> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': ANDROID_UA,
        'X-Goog-Api-Format-Version': '2',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            androidSdkVersion: 34,
            hl: 'en',
            gl: 'US',
            userAgent: ANDROID_UA,
          },
        },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data: unknown = await res.json()
    return extractBestAudio(data)
  } catch {
    return null
  }
}

// ── InnerTube iOS ────────────────────────────────────────────────────────────

async function resolveViaIos(videoId: string): Promise<{ url: string; mimeType: string } | null> {
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': IOS_UA,
        'X-Youtube-Client-Name': '5',
        'X-Youtube-Client-Version': '20.10.4',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'IOS',
            clientVersion: '20.10.4',
            deviceModel: 'iPhone16,2',
            hl: 'en',
            gl: 'US',
            userAgent: IOS_UA,
          },
        },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data: unknown = await res.json()
    return extractBestAudio(data)
  } catch {
    return null
  }
}

// ── Piped API (public, no IP restriction, last resort) ───────────────────────

async function resolveViaPiped(videoId: string): Promise<{ url: string; mimeType: string } | null> {
  const instances = [
    'https://pipedapi.mha.fi/streams/',
    'https://pipedapi.adminforge.de/streams/',
    'https://pipedapi.kavin.rocks/streams/',
    'https://api.piped.video/streams/',
  ]

  const results = await Promise.allSettled(
    instances.map(async (base) => {
      const res = await fetch(`${base}${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(4000),
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json() as { audioStreams?: Array<{ url?: string; mimeType?: string; bitrate?: number }> }
      const streams = data.audioStreams || []
      if (!streams.length) throw new Error('no streams')
      // Prefer m4a/mp4 for iOS compatibility
      const best =
        streams.find((s) => s.url && s.mimeType?.includes('audio/mp4')) ||
        streams.find((s) => s.url)
      if (!best?.url) throw new Error('no url')
      return { url: best.url, mimeType: best.mimeType?.split(';')[0]?.trim() || 'audio/mp4' }
    })
  )

  for (const r of results) {
    if (r.status === 'fulfilled') return r.value
  }
  return null
}

// ── Format extractor ─────────────────────────────────────────────────────────

function extractBestAudio(data: unknown): { url: string; mimeType: string } | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const streamingData = (d.streamingData as Record<string, unknown> | undefined) || {}
  const formats: unknown[] = [
    ...((streamingData.adaptiveFormats as unknown[]) || []),
    ...((streamingData.formats as unknown[]) || []),
  ]

  // Only accept formats with a direct URL (no signatureCipher)
  const audio = formats.filter((f): f is Record<string, unknown> =>
    typeof f === 'object' &&
    f !== null &&
    typeof (f as Record<string, unknown>).url === 'string' &&
    typeof (f as Record<string, unknown>).mimeType === 'string' &&
    ((f as Record<string, unknown>).mimeType as string).startsWith('audio/')
  )

  if (!audio.length) {
    const status = (d.playabilityStatus as Record<string, unknown> | undefined)?.status
    if (status) console.warn('[YT resolve] Playability status:', status)
    return null
  }

  // Sort: m4a/mp4 first, then by bitrate desc
  audio.sort((a, b) => {
    const aMp4 = (a.mimeType as string).includes('audio/mp4') ? 1 : 0
    const bMp4 = (b.mimeType as string).includes('audio/mp4') ? 1 : 0
    if (aMp4 !== bMp4) return bMp4 - aMp4
    return ((b.bitrate as number) || 0) - ((a.bitrate as number) || 0)
  })

  const best = audio[0]
  return {
    url: best.url as string,
    mimeType: (best.mimeType as string).split(';')[0].trim(),
  }
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const videoId = req.nextUrl.searchParams.get('id')?.trim()
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return NextResponse.json({ error: 'Invalid or missing videoId' }, { status: 400 })
  }

  // Authenticate the Worker — reject public callers
  const secret = req.nextUrl.searchParams.get('secret')
  const expectedSecret = process.env.INTERNAL_YT_RESOLVE_SECRET?.trim()
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Try resolvers in order: ANDROID → iOS → Piped
  // Deliberately NO yt-dlp / ytdl-core — those produce IP-bound web-client URLs
  // that CF Worker cannot reuse (different egress IP from Vercel)
  const resolved =
    (await resolveViaAndroid(videoId)) ??
    (await resolveViaIos(videoId)) ??
    (await resolveViaPiped(videoId))

  if (!resolved) {
    return NextResponse.json({ error: 'Could not resolve audio URL' }, { status: 502 })
  }

  return NextResponse.json({
    url: resolved.url,
    mimeType: resolved.mimeType,
  })
}
