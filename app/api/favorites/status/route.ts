// app/api/favorites/status/route.ts
import { requireUser, adminClient } from '@/lib/serverUser'

export async function GET(req: Request) {
  const auth = await requireUser()
  if (auth instanceof Response) return auth
  const userId = auth

  const { data, error } = await adminClient
    .from('favorite_tracks')
    .select('track_id')
    .eq('user_id', userId)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ trackIds: (data ?? []).map((r: any) => r.track_id) })
}
