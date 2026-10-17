import { NextRequest, NextResponse } from 'next/server'
import {
  resolveSoundCloudStreamUrl,
  resolveSoundCloudHlsBuffer,
} from '@/lib/soundcloudClient'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
}

function parseByteRange(
  rangeHeader: string | null,
  totalSize: number,
): { start: number; end: number } | { unsatisfiable: true } | null {
  if (!rangeHeader || totalSize <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match || (match[1] === '' && match[2] === '')) return null

  let start: number
  let end: number
  if (match[1] === '') {
    const suffixLength = Number.parseInt(match[2], 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    start = Math.max(0, totalSize - suffixLength)
    end = totalSize - 1
  } else {
    start = Number.parseInt(match[1], 10)
    if (!Number.isFinite(start) || start < 0) return null
    end =
      match[2] === ''
        ? totalSize - 1
        : Math.min(Number.parseInt(match[2], 10), totalSize - 1)
  }

  if (!Number.isFinite(end) || start >= totalSize || start > end) {
    return { unsatisfiable: true }
  }
  return { start, end }
}

function createSeekableHlsResponse(
  media: { buffer: Uint8Array; contentType: string },
  cleanId: string,
  rangeHeader: string | null,
  isHead = false,
): NextResponse {
  const total = media.buffer.byteLength
  const etag = `"sc-hls-${cleanId}-${total}"`
  const baseHeaders: Record<string, string> = {
    ...CORS_HEADERS,
    'Content-Type': media.contentType || 'audio/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120',
    ETag: etag,
  }

  const parsedRange = parseByteRange(rangeHeader, total)
  if (parsedRange && 'unsatisfiable' in parsedRange) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        'Content-Range': `bytes */${total}`,
      },
    })
  }

  if (parsedRange) {
    const { start, end } = parsedRange
    const chunkLength = end - start + 1
    const headers: Record<string, string> = {
      ...baseHeaders,
      'Content-Length': String(chunkLength),
      'Content-Range': `bytes ${start}-${end}/${total}`,
    }
    if (isHead) {
      return new NextResponse(null, { status: 206, headers })
    }
    const slice = media.buffer.subarray(start, end + 1)
    const body = new Uint8Array(slice.byteLength)
    body.set(slice)
    return new NextResponse(body, { status: 206, headers })
  }

  const headers: Record<string, string> = {
    ...baseHeaders,
    'Content-Length': String(total),
  }
  if (isHead) {
    return new NextResponse(null, { status: 200, headers })
  }
  const body = new Uint8Array(media.buffer.byteLength)
  body.set(media.buffer)
  return new NextResponse(body, { status: 200, headers })
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

  const cleanId = id.replace(/^sc-/, '')

  try {
    const streamUrl = await resolveSoundCloudStreamUrl(id, refresh)
    if (!streamUrl) {
      return new NextResponse(null, { status: 404, headers: CORS_HEADERS })
    }

    if (streamUrl.includes('.m3u8')) {
      const media = await resolveSoundCloudHlsBuffer(cleanId, streamUrl, refresh)
      if (!media) {
        return new NextResponse(null, { status: 404, headers: CORS_HEADERS })
      }
      return createSeekableHlsResponse(
        media,
        cleanId,
        req.headers.get('range'),
        true,
      )
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

  const cleanId = id.replace(/^sc-/, '')

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
        ? `/api/soundcloud/stream?id=${encodeURIComponent(id)}`
        : streamUrl
      const res = NextResponse.json({ url: publicUrl }, { headers: CORS_HEADERS })
      res.headers.set('Cache-Control', refresh ? cacheControl : 'public, max-age=300, s-maxage=300, stale-while-revalidate=60')
      return res
    }

    if (isHls) {
      const media = await resolveSoundCloudHlsBuffer(cleanId, streamUrl, refresh)
      if (!media) {
        return NextResponse.json(
          { error: 'Encrypted or unplayable HLS stream' },
          { status: 404, headers: CORS_HEADERS }
        )
      }
      return createSeekableHlsResponse(
        media,
        cleanId,
        req.headers.get('range'),
        false,
      )
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
