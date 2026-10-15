import { NextRequest, NextResponse } from 'next/server'
import { getNhacCuaTuiStreamUrl } from '@/lib/nhaccuatuiClient'
import { getServerResolutionService } from '@/lib/stream-resolution/server/composition'
import { extractDriveFileId } from '@/lib/stream-resolution/server/providers/driveHelpers'
import type { ResolutionEntry } from '@/lib/stream-resolution/server/contracts'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url)
  const title = (url.searchParams.get('title') || '').trim()
  const artist = (url.searchParams.get('artist') || '').trim()
  const album = (url.searchParams.get('album') || '').trim() || undefined
  const durationStr = url.searchParams.get('duration')
  const duration = durationStr ? parseInt(durationStr, 10) : undefined
  const invalidate = url.searchParams.get('invalidate') === '1'

  if (!title) {
    return NextResponse.json({ error: 'Missing title parameter' }, { status: 400 })
  }

  return respondWith(await getServerResolutionService().resolve({ title, artist, duration, album }, { invalidate }))
}

function respondWith(entry: ResolutionEntry): Response {
  if (entry.isMiss) {
    return NextResponse.json({ miss: true }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const resolvedId = entry.resolvedId || ''
  let streamUrl: string | null = null
  if (entry.source === 'nhaccuatui') {
    streamUrl =
      getNhacCuaTuiStreamUrl(resolvedId) ||
      `/api/nhaccuatui/stream?id=${encodeURIComponent(resolvedId)}`
  } else if (entry.source === 'soundcloud') {
    streamUrl = `/api/soundcloud/stream?id=${encodeURIComponent(resolvedId)}`
  } else if (entry.source === 'drive') {
    const fileId = extractDriveFileId(resolvedId) || resolvedId
    streamUrl = fileId.startsWith('http') || fileId.startsWith('/') ? fileId : `/api/drive-stream?fileId=${encodeURIComponent(fileId)}`
  }

  return NextResponse.json({
    source: entry.source,
    id: entry.resolvedId,
    resolvedId: entry.resolvedId,
    title: entry.title,
    artist: entry.artist,
    duration: entry.duration,
    coverUrl: entry.coverUrl,
    streamUrl,
  }, {
    status: 200,
    // L1/L2 caches own invalidation. HTTP caches cannot coordinate that state.
    headers: { 'Cache-Control': 'no-store' },
  })
}
