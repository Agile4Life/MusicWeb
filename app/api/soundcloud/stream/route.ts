import { NextRequest, NextResponse } from 'next/server'
import { resolveSoundCloudStreamUrl } from '@/lib/soundcloudClient'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const format = searchParams.get('format') // 'json' or redirect

  if (!id) {
    return NextResponse.json({ error: 'Missing track id' }, { status: 400 })
  }

  // Check if Cloudflare Worker URL is configured
  const workerUrl = process.env.NEXT_PUBLIC_SOUNDCLOUD_WORKER_URL?.trim()
  if (workerUrl && !format) {
    const target = `${workerUrl.replace(/\/+$/, '')}/stream?id=${encodeURIComponent(id)}`
    return NextResponse.redirect(target, 307)
  }

  try {
    const streamUrl = await resolveSoundCloudStreamUrl(id)
    if (!streamUrl) {
      return NextResponse.json(
        { error: 'Stream not found or track is not full audio' },
        { status: 404 }
      )
    }

    if (format === 'json') {
      const res = NextResponse.json({ url: streamUrl })
      res.headers.set(
        'Cache-Control',
        'public, max-age=7200, s-maxage=7200, stale-while-revalidate=3600'
      )
      return res
    }

    // Default: Redirect browser/audio element directly to the resolved stream CDN
    const res = NextResponse.redirect(streamUrl, 307)
    res.headers.set(
      'Cache-Control',
      'public, max-age=7200, s-maxage=7200, stale-while-revalidate=3600'
    )
    return res
  } catch (err) {
    console.error('[API /api/soundcloud/stream] Error:', err)
    return NextResponse.json({ error: 'Failed to resolve stream' }, { status: 500 })
  }
}
