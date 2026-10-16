import { NextRequest, NextResponse } from 'next/server'
import {
  resolveSoundCloudStreamUrl,
  parseSoundCloudHlsManifest,
  patchInitMp4Duration,
  stripFmp4SegmentIndexBoxes,
  type SoundCloudHlsManifestInfo,
} from '@/lib/soundcloudClient'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
}

function createStitchedHlsResponse(
  hlsInfo: SoundCloudHlsManifestInfo,
  signal?: AbortSignal,
): NextResponse {
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  ;(async () => {
    try {
      const isFmp4 =
        Boolean(hlsInfo.hasInitMap) || hlsInfo.contentType === 'audio/mp4'
      for (let i = 0; i < hlsInfo.urls.length; i++) {
        const segUrl = hlsInfo.urls[i]
        if (signal?.aborted) break
        const segRes = await fetch(segUrl, { signal })
        if (!segRes.ok || !segRes.body) break

        if (isFmp4 && i === 0) {
          const initBytes = new Uint8Array(await segRes.arrayBuffer())
          const patched = patchInitMp4Duration(
            initBytes,
            hlsInfo.durationSeconds || 0,
          )
          if (patched.byteLength > 0) {
            await writer.write(patched)
          }
          continue
        }

        const reader = segRes.body.getReader()
        let stripLeadingBoxes = isFmp4 && i > 0
        let pendingHeader: Uint8Array | null = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            if (pendingHeader && pendingHeader.byteLength > 0) {
              const stripped = stripFmp4SegmentIndexBoxes(pendingHeader)
              if (stripped.byteLength > 0) {
                await writer.write(stripped)
              }
              pendingHeader = null
            }
            break
          }
          if (!value || value.byteLength === 0) continue

          if (!stripLeadingBoxes) {
            await writer.write(value)
            continue
          }

          let headerBuf: Uint8Array
          if (!pendingHeader) {
            headerBuf = value
          } else {
            const combined = new Uint8Array(
              pendingHeader.byteLength + value.byteLength,
            )
            combined.set(pendingHeader, 0)
            combined.set(value, pendingHeader.byteLength)
            headerBuf = combined
          }
          pendingHeader = headerBuf

          const view = new DataView(
            headerBuf.buffer,
            headerBuf.byteOffset,
            headerBuf.byteLength,
          )
          let offset = 0
          let needMore = false
          while (offset + 8 <= headerBuf.byteLength) {
            const size = view.getUint32(offset, false)
            const type = String.fromCharCode(
              headerBuf[offset + 4],
              headerBuf[offset + 5],
              headerBuf[offset + 6],
              headerBuf[offset + 7],
            )
            if (type === 'styp' || type === 'sidx') {
              if (size < 8) break
              if (offset + size > headerBuf.byteLength) {
                needMore = true
                break
              }
              offset += size
              continue
            }
            break
          }

          if (offset + 8 > headerBuf.byteLength || needMore) {
            continue
          }

          const remainder =
            offset > 0 ? headerBuf.subarray(offset) : headerBuf
          pendingHeader = null
          stripLeadingBoxes = false
          if (remainder.byteLength > 0) {
            await writer.write(remainder)
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
