// app/api/playlists/route.ts
import { requireUser, adminClient, getAuthenticatedUserId } from '@/lib/serverUser'

export async function GET(req: Request) {
  const userId = await getAuthenticatedUserId()

  try {
    let query = adminClient.from('playlists').select('*').order('created_at', { ascending: false })

    if (userId) {
      // User's own playlists + public playlists
      query = query.or(`user_id.eq.${userId},is_public.eq.true`)
    } else {
      // Public playlists only for non-logged in users
      query = query.eq('is_public', true)
    }

    const { data, error } = await query
    if (error) throw error

    return Response.json({ playlists: data || [] })
  } catch (err: any) {
    console.error('[playlists/GET] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

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
      description: body?.description || 'Playlist cá nhân',
      cover_url: body?.coverUrl || null,
      is_public: Boolean(body?.isPublic) || false,
    })
    .select()
    .single()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ playlist: data })
}
