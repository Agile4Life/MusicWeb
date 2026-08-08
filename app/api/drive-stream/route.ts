import { NextRequest, NextResponse } from 'next/server'
import { resolveDriveStreamUrl } from '@/lib/drive-stream-resolver'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('id') || searchParams.get('fileId')
    const titleParam = searchParams.get('filename') || searchParams.get('title') || ''

    if (!fileId) {
      return NextResponse.json({ error: 'Missing fileId parameter' }, { status: 400 })
    }

    const resolved = await resolveDriveStreamUrl(fileId, undefined, titleParam)

    if (!resolved || !resolved.url) {
      return NextResponse.json(
        { error: 'Google Drive: could not resolve a playable stream URL' },
        { status: 502 }
      )
    }

    const redirectHeaders = new Headers()
    redirectHeaders.set('Location', resolved.url)
    redirectHeaders.set('Access-Control-Allow-Origin', '*')
    redirectHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    redirectHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type')
    redirectHeaders.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

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
    const fileId = searchParams.get('id') || searchParams.get('fileId')

    if (!fileId) {
      return new NextResponse(null, { status: 400 })
    }

    const cdnUrl = `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`
    const res = await fetch(cdnUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      return new NextResponse(null, { status: res.status })
    }

    const headers = new Headers()
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('ETag', `W/"drive-${fileId}"`)
    const cl = res.headers.get('content-length')
    if (cl) headers.set('Content-Length', cl)

    return new NextResponse(null, { status: 200, headers })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
