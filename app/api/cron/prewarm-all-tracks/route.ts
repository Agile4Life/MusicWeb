import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, resolveDriveStreamUrl } from '@/lib/drive-stream-resolver'
import { extractDriveFileId } from '@/lib/googleDriveUpload'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    // 🔒 1. Auth check using CRON_SECRET
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const authHeader = req.headers.get('authorization')
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    let supabase: ReturnType<typeof getServiceClient>
    try {
      supabase = getServiceClient()
    } catch (err: any) {
      return NextResponse.json({ error: 'Supabase init error: ' + err?.message }, { status: 500 })
    }

    // ⚡ 2. Query tracks needing prewarm (cached_at IS NULL or older than 5 hours)
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()

    const { data: rawTracks, error: dbError } = await supabase
      .from('tracks')
      .select('id, title, file_path, drive_file_id, drive_stream_cached_at')
      .or(`drive_stream_cached_at.is.null,drive_stream_cached_at.lt.${fiveHoursAgo}`)
      .limit(50)

    if (dbError) {
      console.error('Cron prewarm DB query error:', dbError)
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    if (!rawTracks || rawTracks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All tracks are freshly prewarmed!',
        total: 0,
        resolvedCount: 0,
        failedCount: 0,
      })
    }

    // ⚡ 3. Extract Drive File IDs
    const fileIds: { fileId: string; title?: string }[] = []
    const seen = new Set<string>()

    for (const tr of rawTracks) {
      const id = tr.drive_file_id || extractDriveFileId(tr.file_path || '')
      if (id && !seen.has(id)) {
        seen.add(id)
        fileIds.push({ fileId: id, title: tr.title })
      }
    }

    if (fileIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No Drive tracks found in current batch',
        total: 0,
        resolvedCount: 0,
        failedCount: 0,
      })
    }

    const resolved: string[] = []
    const failed: string[] = []

    // ⚡ 4. Process batch with concurrency ~5
    const batchSize = 5
    for (let i = 0; i < fileIds.length; i += batchSize) {
      const batch = fileIds.slice(i, i + batchSize)
      const batchResults = await Promise.allSettled(
        batch.map((item) => resolveDriveStreamUrl(item.fileId, supabase, item.title))
      )

      batchResults.forEach((res, idx) => {
        const item = batch[idx]
        if (res.status === 'fulfilled' && res.value && res.value.url) {
          resolved.push(item.fileId)
        } else {
          failed.push(item.fileId)
        }
      })
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      totalTracksChecked: rawTracks.length,
      driveFilesProcessed: fileIds.length,
      resolvedCount: resolved.length,
      failedCount: failed.length,
      resolved,
      failed,
    })
  } catch (err: any) {
    console.error('Cron prewarm-all-tracks error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
