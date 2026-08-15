// app/api/tracks/bulk-update/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

export async function POST(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const body = await req.json().catch(() => null)
  const targetIds: string[] = Array.isArray(body?.targetIds) ? body.targetIds : []
  const rawUpdates = body?.updates || {}

  if (targetIds.length === 0) {
    return Response.json({ error: 'Thiếu targetIds' }, { status: 400 })
  }

  try {
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }
    if (rawUpdates.artist !== undefined) {
      updates.artist = typeof rawUpdates.artist === 'string' ? rawUpdates.artist.trim() || null : null
    }
    if (rawUpdates.album !== undefined) {
      updates.album = typeof rawUpdates.album === 'string' ? rawUpdates.album.trim() || null : null
    }

    const { data, error } = await adminClient
      .from('tracks')
      .update(updates)
      .in('id', targetIds)
      .eq('user_id', userId) // chỉ cập nhật các track mình sở hữu trong danh sách
      .select('id')

    if (error) throw error
    const updatedIds = (data ?? []).map((t: { id: string }) => t.id)
    const deniedIds = targetIds.filter((id) => !updatedIds.includes(id))

    return Response.json({
      success: true,
      updatedIds,
      deniedIds: deniedIds.length ? deniedIds : undefined,
    })
  } catch (err: any) {
    console.error('[tracks/bulk-update] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
