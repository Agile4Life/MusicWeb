import { NextRequest, NextResponse } from 'next/server'
import { resolveSoundCloudStreamUrl } from '@/lib/soundcloudClient'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id') || searchParams.get('url')
  const format = searchParams.get('format') // 'json' or redirect
  const refresh = searchParams.get('refresh') === '1'

  if (!id) {
    return NextResponse.json(
      { error: 'Missing track id or url' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  // Check if Cloudflare Worker URL is configured (for clean numeric track IDs only)
  const workerUrl = process.env.NEXT_PUBLIC_SOUNDCLOUD_WORKER_URL?.trim()
  const isNumericId = /^\d+$/.test(id.replace(/^sc-/, ''))
  if (workerUrl && !format && isNumericId) {
    const refreshQuery = refresh ? '&refresh=1' : ''
    const target = `${workerUrl.replace(/\/+$/, '')}/stream?id=${encodeURIComponent(id)}${refreshQuery}`
    return NextResponse.redirect(target, 307)
  }

  try {
    const streamUrl = await resolveSoundCloudStreamUrl(id, refresh)
    if (!streamUrl) {
      return NextResponse.json(
        { error: 'Stream not found or track is not full audio' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const cacheControl = 'no-cache, no-store, must-revalidate, max-age=0'

    if (format === 'json') {
      const res = NextResponse.json({ url: streamUrl }, { headers: CORS_HEADERS })
      res.headers.set('Cache-Control', refresh ? cacheControl : 'public, max-age=300, s-maxage=300, stale-while-revalidate=60')
      return res
    }

    // Default: Redirect browser/audio element directly to the resolved stream CDN with no-cache so reconnection fetches fresh URLs
    const res = NextResponse.redirect(streamUrl, 307)
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      res.headers.set(k, v)
    }
    res.headers.set('Cache-Control', cacheControl)
    return res
  } catch (err) {
    console.error('[API /api/soundcloud/stream] Error:', err)
    return NextResponse.json(
      { error: 'Failed to resolve stream' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}
