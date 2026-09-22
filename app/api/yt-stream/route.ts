import { NextRequest, NextResponse } from 'next/server'
import { GET as ytStreamGet, HEAD as ytStreamHead, OPTIONS as ytStreamOptions } from '@/app/api/youtube/stream/route'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function getWorkerTarget(req: NextRequest): string | null {
  const workerBase = process.env.NEXT_PUBLIC_YT_STREAM_WORKER_URL?.trim()
  if (!workerBase) return null
  const { search } = new URL(req.url)
  return `${workerBase.replace(/\/+$/, '')}/api/yt-stream${search}`
}

export async function GET(req: NextRequest) {
  const workerTarget = getWorkerTarget(req)
  if (workerTarget) {
    return NextResponse.redirect(workerTarget, 307)
  }
  return ytStreamGet(req)
}

export async function HEAD(req: NextRequest) {
  const workerTarget = getWorkerTarget(req)
  if (workerTarget) {
    return NextResponse.redirect(workerTarget, 307)
  }
  return ytStreamHead(req)
}

export async function OPTIONS() {
  return ytStreamOptions()
}
