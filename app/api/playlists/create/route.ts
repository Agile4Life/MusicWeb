// app/api/playlists/create/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

export async function POST(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const body = await req.json().catch(() => null)
  const name = body?.name?.trim()
  if (!name) {
    return Response.json({ error: 'Thiếu tên playlist' }, { status: 400 })
  }

  try {
    const { data: newPl, error } = await adminClient
      .from('playlists')
      .insert({
        user_id: userId,
        name,
        description: body?.description || null,
        cover_url: body?.coverUrl || null,
        is_public: Boolean(body?.isPublic) || false,
      })
      .select()
      .single()

    if (error) throw error
    return Response.json({ playlist: newPl })
  } catch (err: any) {
    console.error('[playlists/create] Failed:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
