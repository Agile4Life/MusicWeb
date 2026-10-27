import { adminClient } from '@/lib/serverUser'
import { COMMUNITY_DECK_MAX_BYTES, CommunityDeckValidationError, validateCommunityDeckInput, type CommunityDeck, type CommunityDeckSummary } from '@/lib/songBattleCommunity'
import type { BattleTrack } from '@/lib/songBattleSources'

export const deckColumns = 'id,user_id,name,description,creator_name,cover_url,track_count,created_at,updated_at'
export class DeckHttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } })
}
export function databaseError(error: { code?: string; message?: string; details?: string } | null): void {
  if (!error) return
  console.error('[songBattle databaseError]', error)
  if (['42P01', 'PGRST205'].includes(error.code || '')) throw new DeckHttpError(503, 'Thư viện cộng đồng chưa được thiết lập. Bạn vẫn có thể tạo cuộc đấu và chơi ngay.')
  throw new DeckHttpError(500, 'Không thể tải hoặc lưu bộ bài. Vui lòng thử lại.')
}
export async function handled(action: () => Promise<Response>): Promise<Response> {
  try { return await action() } catch (error) {
    if (error instanceof DeckHttpError) return json({ error: error.message }, error.status)
    if (error instanceof CommunityDeckValidationError) return json({ error: error.message }, 400)
    return json({ error: 'Không thể kết nối dữ liệu bộ bài. Vui lòng thử lại.' }, 500)
  }
}
export async function readDeckBody(request: Request) {
  if (Number(request.headers.get('content-length')) > COMMUNITY_DECK_MAX_BYTES) throw new DeckHttpError(413, 'Dữ liệu bộ bài quá lớn.')
  const reader = request.body?.getReader()
  let length = 0
  const chunks: Uint8Array[] = []
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > COMMUNITY_DECK_MAX_BYTES) {
          await reader.cancel()
          throw new DeckHttpError(413, 'Dữ liệu bộ bài quá lớn.')
        }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let raw: unknown
  try { raw = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new DeckHttpError(400, 'Dữ liệu JSON không hợp lệ.') }
  return { input: validateCommunityDeckInput(raw), raw: raw as Record<string, unknown> }
}
type Row = Omit<CommunityDeckSummary, 'is_owner'> & { user_id: string; tracks?: BattleTrack[] }
export function publicDeck(row: Row & { tracks: BattleTrack[] }, userId: string | null, includeTracks: true): CommunityDeck
export function publicDeck(row: Row, userId: string | null, includeTracks?: false): CommunityDeckSummary
export function publicDeck(row: Row, userId: string | null, includeTracks = false): CommunityDeckSummary | CommunityDeck {
  const { id, name, description, creator_name, cover_url, track_count, created_at, updated_at } = row
  const summary = { id, name, description, creator_name, cover_url, track_count, created_at, updated_at, is_owner: row.user_id === userId }
  return includeTracks ? { ...summary, tracks: row.tracks as BattleTrack[] } : summary
}
export async function ownerDeck(id: string, userId: string) {
  const { data, error } = await adminClient.from('song_battle_decks').select('id,updated_at').eq('id', id).eq('user_id', userId).maybeSingle()
  databaseError(error)
  if (!data) throw new DeckHttpError(404, 'Không tìm thấy bộ bài của bạn.')
  return data
}
