import { NextRequest, NextResponse } from 'next/server'
import { resolveSoundCloudStreamUrl, parseSoundCloudHlsManifest } from '@/lib/soundcloudClient'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
}

function createStitchedHlsResponse(
  hlsInfo: { contentType: string; urls: string[] },
  signal?: AbortSignal,
): NextResponse {
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  ;(async () => {
    try {
      for (const segUrl of hlsInfo.urls) {
        if (signal?.aborted) break
        const segRes = await fetch(segUrl, { signal })
        if (!segRes.ok || !segRes.body) break
        const reader = segRes.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value && value.byteLength > 0) {
            await writer.write(value)
          }
        }
      }
    } catch {
      // Client disconnected
    } finally {
      try {
        await writer.close()
      } catch {}
    }
  })()

  return new NextResponse(readable, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': hlsInfo.contentType || 'audio/mp4',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      'Accept-Ranges': 'none',
    },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS })
}

export async function HEAD(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = (searchParams.get('id') || searchParams.get('url') || '').trim()
  const refresh = searchParams.get('refresh') === '1'

  if (!id) {
    return new NextResponse(null, { status: 400, headers: CORS_HEADERS })
  }

  const workerUrl = process.env.NEXT_PUBLIC_SOUNDCLOUD_WORKER_URL?.trim()
  const isNumericId = /^\d+$/.test(id.replace(/^sc-/, ''))
  if (workerUrl && isNumericId) {
    const refreshQuery = refresh ? '&refresh=1' : ''
    const target = `${workerUrl.replace(/\/+$/, '')}/stream?id=${encodeURIComponent(id)}${refreshQuery}`
    return NextResponse.redirect(target, 307)
  }

  try {
    const streamUrl = await resolveSoundCloudStreamUrl(id, refresh)
    if (!streamUrl) {
      return new NextResponse(null, { status: 404, headers: CORS_HEADERS })
    }

    if (streamUrl.includes('.m3u8')) {
      const hlsInfo = await parseSoundCloudHlsManifest(streamUrl)
      if (!hlsInfo) {
        return new NextResponse(null, { status: 404, headers: CORS_HEADERS })
      }
      return new NextResponse(null, {
        status: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': hlsInfo.contentType || 'audio/mp4',
          'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        },
      })
    }

    const res = NextResponse.redirect(streamUrl, 307)
    for (const [k, v] of Object.entries(CORS_HEADERS)) {
      res.headers.set(k, v)
    }
    res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0')
    return res
  } catch {
    return new NextResponse(null, { status: 500, headers: CORS_HEADERS })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = (searchParams.get('id') || searchParams.get('url') || '').trim()
  const format = searchParams.get('format') // 'json' or redirect/stream
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
    const isHls = streamUrl.includes('.m3u8')

    if (format === 'json') {
      const publicUrl = isHls
        ? workerUrl && isNumericId
          ? `${workerUrl.replace(/\/+$/, '')}/stream?id=${encodeURIComponent(id.replace(/^sc-/, ''))}`
          : `/api/soundcloud/stream?id=${encodeURIComponent(id)}`
        : streamUrl
      const res = NextResponse.json({ url: publicUrl }, { headers: CORS_HEADERS })
      res.headers.set('Cache-Control', refresh ? cacheControl : 'public, max-age=300, s-maxage=300, stale-while-revalidate=60')
      return res
    }

    if (isHls) {
      const hlsInfo = await parseSoundCloudHlsManifest(streamUrl)
      if (!hlsInfo) {
        return NextResponse.json(
          { error: 'Encrypted or unplayable HLS stream' },
          { status: 404, headers: CORS_HEADERS }
        )
      }
      return createStitchedHlsResponse(hlsInfo, req.signal)
    }

    // Default: Redirect browser/audio element directly to the resolved progressive stream CDN
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
