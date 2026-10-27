import type { CommunityDeck, CommunityDeckInput, CommunityDeckSummary } from '@/lib/songBattleCommunity'

export class CommunityRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = 'CommunityRequestError' }
}

export async function communityRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const deadline = AbortSignal.timeout(25000)
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
  try {
    const response = await fetch(path, { ...options, signal, cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new CommunityRequestError(data.error || 'Không tải được bộ bài. Vui lòng thử lại.', response.status)
    return data as T
  } catch (error) {
    if (deadline.aborted && !options.signal?.aborted) throw new Error('Kết nối phản hồi quá lâu. Vui lòng thử lại.')
    if (error instanceof SyntaxError) throw new Error('Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.')
    throw error
  }
}

export function getCommunityDeck(id: string, signal?: AbortSignal) {
  return communityRequest<{ deck: CommunityDeck }>(`/api/song-battles/${encodeURIComponent(id)}`, { signal })
}

export function listCommunityDecks(query: string, page: number, mine: boolean, signal: AbortSignal) {
  const params = new URLSearchParams({ q: query, page: String(page) })
  if (mine) params.set('mine', '1')
  return communityRequest<{ decks: CommunityDeckSummary[]; page: number; pageSize: number; total: number }>(`/api/song-battles?${params}`, { signal })
}

export function saveCommunityDeck(input: CommunityDeckInput, editing?: CommunityDeck | null) {
  return communityRequest<{ deck: CommunityDeck }>(editing ? `/api/song-battles/${editing.id}` : '/api/song-battles', {
    method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, ...(editing ? { expectedUpdatedAt: editing.updated_at } : {}) }),
  })
}
