// app/api/favorites/list/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'
import { fetchFavoriteTracks } from '@/lib/favoriteTracks'

export async function GET(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const { searchParams } = new URL(req.url)
  const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 200)

  try {
    const tracks = await fetchFavoriteTracks(adminClient, userId, limit)
    return Response.json({ tracks })
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
