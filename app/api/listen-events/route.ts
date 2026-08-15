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

    // Giữ nguyên hành vi cũ: cho phép ghi nhận cả lượt nghe ẩn danh (chưa đăng nhập)
    // bằng 1 UUID cố định dùng chung, không map về user thật nào.
    let userId = '00000000-0000-4000-a000-000000000001'
    try {
      const session = await getServerSession(authOptions)
      if (session?.user) {
        userId = getValidUserId(session.user)
      }
    } catch {}

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
  } catch (err: any) {
    return NextResponse.json({ success: false, error: 'Internal server warning' }, { status: 200 })
  }
}
