import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, resolveDriveStreamUrl } from '@/lib/drive-stream-resolver'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawFileIds: string[] = Array.isArray(body.fileIds) ? body.fileIds : []

    // Deduplicate and limit to 20 fileIds per prewarm request
    const fileIds = Array.from(
      new Set(rawFileIds.filter((id) => typeof id === 'string' && id.trim().length > 0))
    ).slice(0, 20)

    if (fileIds.length === 0) {
      return NextResponse.json({ success: true, count: 0, resolved: [], failed: [] })
    }

    let supabase: ReturnType<typeof getServiceClient> | undefined
    try {
      supabase = getServiceClient()
    } catch (err) {
      console.warn('Prewarm Supabase client error:', err)
    }

    const resolved: string[] = []
    const failed: string[] = []
    const resolvedUrls: Record<string, string> = {}

    // Batch process with concurrency limit ~5
    const batchSize = 5
    for (let i = 0; i < fileIds.length; i += batchSize) {
      const batch = fileIds.slice(i, i + batchSize)
      const batchResults = await Promise.allSettled(
        batch.map((id) => resolveDriveStreamUrl(id, supabase))
      )

      batchResults.forEach((res, idx) => {
        const fileId = batch[idx]
        if (res.status === 'fulfilled' && res.value && res.value.url) {
          resolved.push(fileId)
          resolvedUrls[fileId] = res.value.url
        } else {
          failed.push(fileId)
        }
      })
    }

    return NextResponse.json({
      success: true,
      count: fileIds.length,
      resolvedCount: resolved.length,
      failedCount: failed.length,
      resolved,
      resolvedUrls,
      failed,
    })
  } catch (err: any) {
    console.error('Prewarm endpoint error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
