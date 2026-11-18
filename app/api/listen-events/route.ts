// app/api/listen-events/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import { getValidUserId } from '@/lib/accessControl'
import { adminClient } from '@/lib/serverUser'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { track_id, artist, completed, skip_at_seconds } = body
    if (!track_id) {
      return NextResponse.json({ error: 'track_id is required' }, { status: 400 })
    }

    // Chỉ ghi cho người đã đăng nhập: gợi ý bài chỉ đọc theo user_id thật, nên lượt nghe
    // ẩn danh không ai dùng, còn endpoint mở thì ai cũng spam được vào bảng.
    let userId: string | null = null
    try {
      const session = await getServerSession(authOptions)
      if (session?.user) {
        userId = getValidUserId(session.user)
      }
    } catch {}
    if (!userId) {
      return NextResponse.json({ success: true, skipped: true })
    }

    // ĐỔI: dùng service_role thay vì client SSR (anon) — vì RLS giờ chặn hẳn
    // anon/authenticated ghi trực tiếp vào listen_events.
    const { error } = await adminClient.from('listen_events').insert({
      user_id: userId,
      track_id: String(track_id),
      artist: artist || null,
      completed: Boolean(completed),
      skip_at_seconds: typeof skip_at_seconds === 'number' ? Math.round(skip_at_seconds) : null,
      played_at: new Date().toISOString(),
    })

    if (error) {
      return NextResponse.json({ success: false, message: error.message }, { status: 200 })
    }
    return NextResponse.json({ success: true })
  } catch {
    return NextResponse.json({ success: false, error: 'Internal server warning' }, { status: 200 })
  }
}
