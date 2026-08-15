// app/api/playlists/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

export async function POST(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const body = await req.json().catch(() => ({}))
  const name = body?.name || null // fallback "Playlist #N" tính ở dưới nếu không có tên

  // Đếm số playlist hiện có để đặt tên mặc định, giữ đúng hành vi cũ
  let finalName = name
  if (!finalName) {
    const { count } = await adminClient
      .from('playlists')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
    finalName = `Playlist #${(count ?? 0) + 1}`
  }

  const { data, error } = await adminClient
    .from('playlists')
    .insert({
      user_id: userId,
      name: finalName,
      description: 'Playlist cá nhân',
      is_public: false,
    })
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ playlist: data })
}
