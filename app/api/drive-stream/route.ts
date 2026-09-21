import { NextRequest, NextResponse } from 'next/server'
import { resolveDriveStreamUrl, clearAllCachesForFile, getServiceClient } from '@/lib/drive-stream-resolver'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const fileId = (searchParams.get('id') || searchParams.get('fileId') || '').trim()
    const titleParam = (searchParams.get('filename') || searchParams.get('title') || '').trim()
    const isProxy = searchParams.get('proxy') === 'true'

    if (!fileId) {
      return NextResponse.json({ error: 'Missing fileId parameter' }, { status: 400 })
    }

    // ⚡ Get Supabase service client for DB caching
    const supabase = getServiceClient()
    const resolved = await resolveDriveStreamUrl(fileId, supabase, titleParam)

    if (!resolved || !resolved.url) {
      return NextResponse.json(
        { error: 'Google Drive: could not resolve a playable stream URL' },
        { status: 502 }
      )
    }

    // 🚀 Proxy mode: stream audio body directly when requested (for strict CORS / Safari clients)
    if (isProxy) {
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
      const proxyHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      }
      if (range) proxyHeaders['Range'] = range

      let streamRes = await fetch(resolved.url, {
        headers: proxyHeaders,
        cache: 'no-store',
      })

      // Cached CDN URL may have died upstream — invalidate caches and re-resolve once
      if (!streamRes.ok) {
        clearAllCachesForFile(fileId, supabase)
        const reResolved = await resolveDriveStreamUrl(fileId, supabase, titleParam)
        if (reResolved && reResolved.url) {
          streamRes = await fetch(reResolved.url, {
            headers: proxyHeaders,
            cache: 'no-store',
          })
        }
      }

      const resHeaders = new Headers()
      resHeaders.set('Content-Type', resolved.contentType || streamRes.headers.get('content-type') || 'audio/mpeg')
      resHeaders.set('Access-Control-Allow-Origin', '*')
      resHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      resHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type')
      resHeaders.set('Accept-Ranges', 'bytes')
    resHeaders.set('Cache-Control', 'public, max-age=2700, s-maxage=2700, stale-while-revalidate=600')

      const cl = streamRes.headers.get('content-length')
      if (cl) resHeaders.set('Content-Length', cl)

      const cr = streamRes.headers.get('content-range')
      if (cr) resHeaders.set('Content-Range', cr)

      return new Response(streamRes.body, {
        status: streamRes.status,
        headers: resHeaders,
      })
    }

    // ⚡ Redirect mode (default): 302 Redirect to high-speed CDN URL
    const redirectHeaders = new Headers()
    redirectHeaders.set('Location', resolved.url)
    redirectHeaders.set('Access-Control-Allow-Origin', '*')
    redirectHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    redirectHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type')
    redirectHeaders.set('Accept-Ranges', 'bytes')
    redirectHeaders.set('Cache-Control', 'public, max-age=2700, s-maxage=2700, stale-while-revalidate=600')

    return new Response(null, { status: 302, headers: redirectHeaders })
  } catch (err: any) {
    console.error('Drive stream GET error:', err)
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
    const fileId = (searchParams.get('id') || searchParams.get('fileId') || '').trim()
    const titleParam = (searchParams.get('filename') || searchParams.get('title') || '').trim()

    if (!fileId) {
      return new NextResponse(null, { status: 400 })
    }

    const supabase = getServiceClient()
    const resolved = await resolveDriveStreamUrl(fileId, supabase, titleParam)
    if (!resolved || !resolved.url) {
      return new NextResponse(null, { status: 502 })
    }

    const res = await fetch(resolved.url, {
      method: 'HEAD',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    })

    const headers = new Headers()
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Range, Content-Type')
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Cache-Control', 'public, max-age=2700, s-maxage=2700, stale-while-revalidate=600')
    headers.set('Location', resolved.url)
    headers.set('Content-Type', resolved.contentType || 'audio/mpeg')

    const cl = res.headers.get('content-length')
    if (cl) headers.set('Content-Length', cl)

    return new NextResponse(null, { status: 200, headers })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
