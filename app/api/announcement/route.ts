// app/api/announcement/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_ANNOUNCEMENT, validateAnnouncementPayload, AnnouncementData } from '@/lib/announcement'
import { isAdmin } from '@/lib/accessControl'

let cachedAnnouncement: AnnouncementData = DEFAULT_ANNOUNCEMENT

function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  if (!url || !key) return null
  return createClient(url, key)
}

export async function GET(_req: NextRequest) {
  try {
    const supabase = getSupabaseServerClient()
    if (supabase) {
      const { data, error } = await supabase
        .from('system_announcements')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!error && data) {
        cachedAnnouncement = {
          badge: data.badge || DEFAULT_ANNOUNCEMENT.badge,
          title: data.title || DEFAULT_ANNOUNCEMENT.title,
          content: data.content || DEFAULT_ANNOUNCEMENT.content,
          facebook_url: data.facebook_url,
          instagram_url: data.instagram_url,
          contact_email: data.contact_email,
          cta_text: data.cta_text || DEFAULT_ANNOUNCEMENT.cta_text,
          is_enabled: data.is_enabled !== false,
          version: typeof data.version === 'number' ? data.version : 1,
          updated_at: data.updated_at,
        }
        return NextResponse.json({ success: true, data: cachedAnnouncement }, { status: 200 })
      }
    }
    return NextResponse.json({ success: true, data: cachedAnnouncement }, { status: 200 })
  } catch {
    return NextResponse.json({ success: true, data: cachedAnnouncement }, { status: 200 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const email = body.senderEmail || req.headers.get('x-user-email') || ''

    if (!isAdmin(email)) {
      return NextResponse.json(
        { success: false, error: 'Chỉ tài khoản Admin mới có quyền chỉnh sửa thông báo.' },
        { status: 403 }
      )
    }

    const { valid, error, data } = validateAnnouncementPayload(body)
    if (!valid || !data) {
      return NextResponse.json({ success: false, error }, { status: 400 })
    }

    const nextVersion = (cachedAnnouncement.version || 1) + 1
    const updatedAnnouncement: AnnouncementData = {
      ...data,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    }

    cachedAnnouncement = updatedAnnouncement

    const supabase = getSupabaseServerClient()
    if (supabase) {
      try {
        await supabase
          .from('system_announcements')
          .upsert({
            id: 'welcome_announcement',
            badge: updatedAnnouncement.badge,
            title: updatedAnnouncement.title,
            content: updatedAnnouncement.content,
            facebook_url: updatedAnnouncement.facebook_url,
            instagram_url: updatedAnnouncement.instagram_url,
            contact_email: updatedAnnouncement.contact_email,
            cta_text: updatedAnnouncement.cta_text,
            is_enabled: updatedAnnouncement.is_enabled,
            version: updatedAnnouncement.version,
            updated_at: updatedAnnouncement.updated_at,
          })
      } catch (dbErr) {
        console.warn('Could not persist announcement to Supabase, cached in memory:', dbErr)
      }
    }

    return NextResponse.json({ success: true, data: updatedAnnouncement }, { status: 200 })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err?.message || 'Lỗi xử lý server' }, { status: 500 })
  }
}
