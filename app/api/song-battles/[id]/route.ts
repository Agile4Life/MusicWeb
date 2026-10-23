import { adminClient, getAuthenticatedUserId, requireUser } from '@/lib/serverUser'
import { isDeckId } from '@/lib/songBattleCommunity'
import { databaseError, deckColumns, DeckHttpError, handled, json, ownerDeck, publicDeck, readDeckBody } from '@/lib/songBattleCommunityServer'

type Context = { params: Promise<{ id: string }> }
async function deckId(context: Context) {
  const { id } = await context.params
  if (!isDeckId(id)) throw new DeckHttpError(400, 'Mã bộ bài không hợp lệ.')
  return id
}
export async function GET(_request: Request, context: Context) {
  return handled(async () => {
    const id = await deckId(context)
    const userId = await getAuthenticatedUserId()
    const { data, error } = await adminClient.from('song_battle_decks').select(`${deckColumns},tracks`).eq('id', id).maybeSingle()
    databaseError(error)
    if (!data) throw new DeckHttpError(404, 'Không tìm thấy bộ bài.')
    return json({ deck: publicDeck(data, userId, true) })
  })
}
export async function PATCH(request: Request, context: Context) {
  return handled(async () => {
    const auth = await requireUser()
    if (auth instanceof Response) return auth
    const id = await deckId(context)
    const { input, raw } = await readDeckBody(request)
    if (typeof raw.expectedUpdatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.expectedUpdatedAt) || !Number.isFinite(Date.parse(raw.expectedUpdatedAt))) throw new DeckHttpError(400, 'Thiếu phiên bản bộ bài. Vui lòng tải lại.')
    await ownerDeck(id, auth)
    const { data, error } = await adminClient.from('song_battle_decks').update({ ...input, cover_url: input.tracks.find(t => t.cover_url)?.cover_url || null }).eq('id', id).eq('user_id', auth).eq('updated_at', raw.expectedUpdatedAt).select(`${deckColumns},tracks`).maybeSingle()
    databaseError(error)
    if (!data) throw new DeckHttpError(409, 'Bộ bài đã thay đổi. Vui lòng tải lại trước khi sửa.')
    return json({ deck: publicDeck(data, auth, true) })
  })
}
export async function DELETE(_request: Request, context: Context) {
  return handled(async () => {
    const auth = await requireUser()
    if (auth instanceof Response) return auth
    const id = await deckId(context)
    const { data, error } = await adminClient.from('song_battle_decks').delete().eq('id', id).eq('user_id', auth).select('id').maybeSingle()
    databaseError(error)
    if (!data) throw new DeckHttpError(404, 'Không tìm thấy bộ bài của bạn.')
    return json({ success: true })
  })
}
