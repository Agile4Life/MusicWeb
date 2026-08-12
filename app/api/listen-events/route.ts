import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getServerSession } from 'next-auth'
import { getValidUserId } from '@/lib/accessControl'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { track_id, artist, completed, skip_at_seconds } = body

    if (!track_id) {
      return NextResponse.json({ error: 'track_id is required' }, { status: 400 })
    }

    let userId = '00000000-0000-4000-a000-000000000001'
    try {
      const session = await getServerSession()
      if (session?.user) {
        userId = getValidUserId(session.user)
      }
    } catch {}

    const supabase = await createClient()

    const { error } = await supabase.from('listen_events').insert({
      user_id: userId,
      track_id: String(track_id),
      artist: artist || null,
      completed: Boolean(completed),
      skip_at_seconds: typeof skip_at_seconds === 'number' ? Math.round(skip_at_seconds) : null,
      played_at: new Date().toISOString(),
    })

    if (error) {
      console.warn('Listen event insert info:', error.message)
      return NextResponse.json({ success: false, message: error.message }, { status: 200 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.warn('POST /api/listen-events warning:', err)
    return NextResponse.json({ success: false, error: 'Internal server warning' }, { status: 200 })
  }
}
