import { adminClient, getAuthenticatedUserId, requireUser } from '@/lib/serverUser'
import { databaseError, deckColumns, DeckHttpError, handled, json, publicDeck, readDeckBody } from '@/lib/songBattleCommunityServer'

export async function GET(request: Request) {
  return handled(async () => {
    const params = new URL(request.url).searchParams
    const pageText = params.get('page') || '1'
    if (!/^[1-9][0-9]{0,5}$/.test(pageText)) throw new DeckHttpError(400, 'Trang không hợp lệ.')
    const page = Number(pageText)
    const q = (params.get('q') || '').trim()
    if (q.length > 120) throw new DeckHttpError(400, 'Từ khóa quá dài.')
    const userId = await getAuthenticatedUserId()
    const mine = params.get('mine') === '1'
    if (mine && !userId) throw new DeckHttpError(401, 'Vui lòng đăng nhập.')
    let query = adminClient.from('song_battle_decks').select(deckColumns, { count: 'exact' })
    if (mine) query = query.eq('user_id', userId!)
    if (q) query = query.ilike('name', `%${q.replace(/[\\%_]/g, '\\$&')}%`)
    const { data, error, count } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * 12, page * 12 - 1)
    databaseError(error)
    return json({ decks: (data || []).map(row => publicDeck(row, userId)), total: count || 0, page, pageSize: 12 })
  })
}
export async function POST(request: Request) {
  return handled(async () => {
    const auth = await requireUser()
    if (auth instanceof Response) return auth
    const { input } = await readDeckBody(request)
    const { data, error } = await adminClient.from('song_battle_decks').insert({ ...input, user_id: auth, cover_url: input.tracks.find(t => t.cover_url)?.cover_url || null }).select(`${deckColumns},tracks`).single()
    databaseError(error)
    if (!data) throw new DeckHttpError(500, 'Không thể lưu bộ bài.')
    return json({ deck: publicDeck(data, auth, true) }, 201)
  })
}
