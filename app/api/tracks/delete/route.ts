// app/api/tracks/delete/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

export async function POST(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const body = await req.json().catch(() => null)
  const trackId = body?.trackId
  const trackIds: string[] = Array.isArray(body?.trackIds)
    ? body.trackIds.filter(Boolean)
    : trackId
      ? [trackId]
      : []

  if (trackIds.length === 0) {
    return Response.json({ error: 'Thiếu trackIds' }, { status: 400 })
  }

  try {
    // 1. Lấy thông tin track để kiểm tra quyền sở hữu & file_path xóa storage
    const { data: targetTracks, error: fetchErr } = await adminClient
      .from('tracks')
      .select('id, user_id, file_path')
      .in('id', trackIds)

    if (fetchErr) throw fetchErr

    const targetList = targetTracks ?? []
    const allowedTracks = targetList.filter((t: any) => t.user_id === userId)
    const allowedIds = allowedTracks.map((t: any) => t.id)
    const deniedIds = targetList
      .filter((t: any) => t.user_id !== userId)
      .map((t: any) => t.id)

    if (allowedIds.length === 0) {
      return Response.json(
        {
          error: 'Bạn không có quyền xóa bài hát này',
          deniedIds,
          deletedIds: [],
        },
        { status: 403 }
      )
    }

    // 2. Cascade delete dependent tables
    await adminClient.from('playlist_tracks').delete().in('track_id', allowedIds)
    await adminClient.from('favorite_tracks').delete().in('track_id', allowedIds)
    await adminClient.from('listening_history').delete().in('track_id', allowedIds)

    // 3. Delete from tracks table
    const { error: delErr } = await adminClient.from('tracks').delete().in('id', allowedIds)
    if (delErr) throw delErr

    // 4. Xóa files trong Supabase storage (nếu là local upload, không phải link Google Drive/http)
    const storagePaths = allowedTracks
      .map((t: any) => t.file_path)
      .filter((p: string) => p && !p.startsWith('http'))

    if (storagePaths.length > 0) {
      try {
        await adminClient.storage.from('music-files').remove(storagePaths)
      } catch (stErr) {
        console.warn('[tracks/delete] Storage delete warning:', stErr)
      }
    }

    return Response.json({
      success: true,
      deletedIds: allowedIds,
      deniedIds,
    })
  } catch (err: any) {
    console.error('[tracks/delete] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
