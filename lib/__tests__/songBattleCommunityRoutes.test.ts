import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ user: null as string | null, rows: [] as Record<string, unknown>[], error: null as unknown }))
vi.mock('@/lib/serverUser', () => ({
  getAuthenticatedUserId: async () => state.user,
  requireUser: async () => state.user || Response.json({ error: 'Đăng nhập' }, { status: 401 }),
  adminClient: { from: () => {
    const filters: ((r: Record<string, unknown>) => boolean)[] = []
    let action = 'read', values: Record<string, unknown> = {}, start = 0, end = 99999, single = false
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(r => r[key] === value); return query },
      ilike: (key: string, value: string) => { filters.push(r => String(r[key]).toLowerCase().includes(value.replace(/^%|%$/g, '').toLowerCase())); return query },
      order: () => query,
      range: (a: number, b: number) => { start = a; end = b; return query },
      insert: (v: Record<string, unknown>) => { action = 'insert'; values = v; return query },
      update: (v: Record<string, unknown>) => { action = 'update'; values = v; return query },
      delete: () => { action = 'delete'; return query },
      maybeSingle: () => { single = true; return query },
      single: () => { single = true; return query },
      then: (resolve: (v: unknown) => unknown) => {
        if (state.error) return Promise.resolve({ data: null, error: state.error }).then(resolve)
        let matched = state.rows.filter(r => filters.every(f => f(r)))
        if (action === 'insert') {
          const row = { id: crypto.randomUUID(), created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', ...values, track_count: (values.tracks as unknown[]).length }
          state.rows.push(row); matched = [row]
        } else if (action === 'update') matched.forEach(r => Object.assign(r, values, { updated_at: '2026-02-01T00:00:00Z' }))
        else if (action === 'delete') state.rows = state.rows.filter(r => !matched.includes(r))
        return Promise.resolve({ data: single ? matched[0] || null : matched.slice(start, end + 1), count: matched.length, error: null }).then(resolve)
      },
    }
    return query
  } },
}))
import { GET, POST } from '../../app/api/song-battles/route'
import { GET as detail, PATCH, DELETE } from '../../app/api/song-battles/[id]/route'
const payload = { name: 'My deck', description: '', creator_name: 'Alias', tracks: [{ spotify_id: 'a', title: 'A' }, { spotify_id: 'b', title: 'B' }] }
const request = (method: string, body?: unknown, search = '') => new Request(`https://test/api/song-battles${search}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const context = (id: string) => ({ params: Promise.resolve({ id }) })
beforeEach(() => { state.user = null; state.rows = []; state.error = null })
async function publish(user = 'owner', extra = {}) { state.user = user; const res = await POST(request('POST', { ...payload, ...extra })); expect(res.status).toBe(201); return (await res.json()).deck }

describe('community deck HTTP contract', () => {
  it('publishes album audio that guests can reopen and the owner can update', async () => {
    const deck = await publish('owner', { tracks: [
      { id: 'deezer-123', source: 'deezer', title: 'Album one', file_path: 'https://audio.example/one.m4a' },
      { id: 'deezer-456', source: 'deezer', title: 'Album two', file_path: 'https://audio.example/two.m4a' },
    ] })
    state.user = null
    const reopened = await (await detail(request('GET'), context(deck.id))).json()
    expect(reopened.deck.tracks[0]).toMatchObject({ source: 'musicweb', stream_url: 'https://audio.example/one.m4a' })
    state.user = 'owner'
    expect((await PATCH(request('PATCH', { ...payload, tracks: reopened.deck.tracks, expectedUpdatedAt: deck.updated_at }), context(deck.id))).status).toBe(200)
  })
  it('requires authentication to publish and ignores forged owner fields', async () => {
    expect((await POST(request('POST', payload))).status).toBe(401)
    expect((await PATCH(request('PATCH', payload), context(crypto.randomUUID()))).status).toBe(401)
    expect((await DELETE(request('DELETE'), context(crypto.randomUUID()))).status).toBe(401)
    const deck = await publish('owner', { user_id: 'victim' })
    expect(state.rows[0].user_id).toBe('owner')
    expect(deck.is_owner).toBe(true)
    expect(deck).not.toHaveProperty('user_id')
  })
  it('lets guests list and read public snapshots without leaking ownership', async () => {
    const deck = await publish()
    state.user = null
    const list = await (await GET(request('GET'))).json()
    expect(list).toMatchObject({ total: 1, page: 1, pageSize: 12, decks: [{ id: deck.id, is_owner: false }] })
    expect(list.decks[0]).not.toHaveProperty('tracks')
    expect(list.decks[0]).not.toHaveProperty('user_id')
    const result = await (await detail(request('GET'), context(deck.id))).json()
    expect(result.deck.tracks).toHaveLength(2)
    expect(result.deck.is_owner).toBe(false)
  })
  it('denies foreign edits and deletion, preserves independent owners, and rejects stale edits', async () => {
    const first = await publish('one')
    const second = await publish('two')
    expect((await PATCH(request('PATCH', { ...payload, expectedUpdatedAt: first.updated_at }), context(first.id))).status).toBe(404)
    expect((await DELETE(request('DELETE'), context(first.id))).status).toBe(404)
    expect((await PATCH(request('PATCH', { ...payload, expectedUpdatedAt: '2025-01-01T00:00:00Z' }), context(second.id))).status).toBe(409)
    expect((await PATCH(request('PATCH', payload), context(second.id))).status).toBe(400)
    expect((await PATCH(request('PATCH', { ...payload, expectedUpdatedAt: '0' }), context(second.id))).status).toBe(400)
    const changed = await PATCH(request('PATCH', { ...payload, name: 'Changed', expectedUpdatedAt: second.updated_at }), context(second.id))
    expect(changed.status).toBe(200)
    expect(state.rows.find(r => r.id === first.id)?.name).toBe('My deck')
    expect((await DELETE(request('DELETE'), context(second.id))).status).toBe(200)
    expect(state.rows).toHaveLength(1)
  })
  it('filters search, mine and pagination and rejects malformed pagination', async () => {
    for (let i = 0; i < 14; i++) await publish(i === 13 ? 'other' : 'one', { name: `Deck ${i}` })
    state.user = 'one'
    expect(await (await GET(request('GET', undefined, '?page=2&mine=1'))).json()).toMatchObject({ total: 13, page: 2, decks: [{ name: 'Deck 12' }] })
    expect(await (await GET(request('GET', undefined, '?q=Deck%2013'))).json()).toMatchObject({ total: 1 })
    expect((await GET(request('GET', undefined, '?page=no'))).status).toBe(400)
    state.user = null
    expect((await GET(request('GET', undefined, '?mine=1'))).status).toBe(401)
  })
  it('returns clear setup, validation, missing-row and transport errors', async () => {
    expect((await detail(request('GET'), context('bad'))).status).toBe(400)
    expect((await detail(request('GET'), context(crypto.randomUUID()))).status).toBe(404)
    state.user = 'owner'
    expect((await POST(request('POST', {}))).status).toBe(400)
    expect((await POST(request('POST', { ...payload, extra: 'x'.repeat(1048576) }))).status).toBe(413)
    state.error = { code: '42P01' }
    const setup = await GET(request('GET'))
    expect(setup.status).toBe(503)
    expect((await setup.json()).error).toContain('chưa được thiết lập')
    state.error = { code: 'unknown' }
    expect((await GET(request('GET'))).status).toBe(500)
  })
})
