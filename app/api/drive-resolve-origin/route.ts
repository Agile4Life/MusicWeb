import { NextRequest, NextResponse } from 'next/server'
import { resolveDriveStreamUrl } from '@/lib/drive-stream-resolver'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  // Internal-only guard — reject any call without the shared secret.
  const secret = searchParams.get('secret')
  const internalSecret = process.env.INTERNAL_RESOLVE_SECRET || 'musicweb_internal_drive_stream_secret_2026'
  if (!secret || secret !== internalSecret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const fileId = searchParams.get('id')
  const filenameHint = searchParams.get('filename') || undefined

  if (!fileId) {
    return NextResponse.json({ error: 'Missing fileId' }, { status: 400 })
  }

  const resolved = await resolveDriveStreamUrl(fileId, undefined, filenameHint)
  if (!resolved || !resolved.url) {
    return NextResponse.json({ error: 'Could not resolve Drive stream URL' }, { status: 502 })
  }

  return NextResponse.json(
    { url: resolved.url, contentType: resolved.contentType },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
