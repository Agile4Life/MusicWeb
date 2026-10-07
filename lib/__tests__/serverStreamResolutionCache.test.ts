import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { createStreamResolutionDatabase, streamResolutionMigration } from './fixtures/streamResolutionDatabase'

const routeMocks = vi.hoisted(() => ({ client: vi.fn(), race: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: routeMocks.client }))
vi.mock('@/lib/catalogResolutionRace', () => ({ resolveCatalogCandidates: routeMocks.race }))
vi.mock('@/lib/driveTracksMap', () => ({ findMemoryDriveTrack: () => null }))
vi.mock('@/lib/soundcloudClient', () => ({ searchSoundCloudTracks: vi.fn() }))

const identity = { p_title_key: 'song', p_artist_key: 'artist', p_duration_bucket: 180 }
const hit = (source = 'youtube', resolvedId = 'first') => ({
  source, resolvedId, title: 'Song', artist: 'Artist', duration: 180,
  coverUrl: null, isMiss: false,
})
const miss = { source: null, resolvedId: null, isMiss: true }
type Snapshot = { generation: string; entry: ReturnType<typeof hit> | typeof miss | null; expiresAt?: number }
type Publication = { accepted: boolean; generation: string }
let database: Awaited<ReturnType<typeof createStreamResolutionDatabase>>
beforeAll(async () => { database = await createStreamResolutionDatabase() }, 30_000)
afterAll(async () => { await database?.db.close() })
beforeEach(async () => { await database.db.exec('TRUNCATE public.stream_resolution_cache') })

describe('shared stream resolution client validation', () => {
  const cacheIdentity = { titleKey: 'song', artistKey: 'artist', durBucket: 180 }

  async function helpers() {
    return import('../serverStreamResolutionCache')
  }
  const entry = { ...hit(), expiresAt: 123 }
  function responseClient(data: unknown, error: unknown = null): SupabaseClient {
    return { rpc: () => Promise.resolve({ data, error }) } as unknown as SupabaseClient
  }

  it('reads and publishes using the real SQL protocol with database expiry', async () => {
    const { readSharedResolution, writeSharedResolution } = await helpers()
    expect(await readSharedResolution(database.client, cacheIdentity, false))
      .toEqual({ generation: '0', entry: null })
    expect(await writeSharedResolution(database.client, cacheIdentity, '0', entry))
      .toEqual({ accepted: true, generation: '0' })
    const snapshot = await readSharedResolution(database.client, cacheIdentity, false)
    expect(snapshot).toMatchObject({ generation: '0', entry: hit() })
    expect(snapshot?.entry?.expiresAt).toBeGreaterThan(Date.now())
    expect(await readSharedResolution(database.client, cacheIdentity, true))
      .toEqual({ generation: '1', entry: null })
    expect(await writeSharedResolution(database.client, cacheIdentity, '0', entry))
      .toEqual({ accepted: false, generation: '1' })
  })

  it('preserves bigint generation text for both RPC responses', async () => {
    const { readSharedResolution, writeSharedResolution } = await helpers()
    await database.rpc('read_stream_resolution_cache', { ...identity, p_invalidate: false })
    await database.db.exec('UPDATE public.stream_resolution_cache SET generation = 9007199254740993')
    expect(await readSharedResolution(database.client, cacheIdentity, false))
      .toEqual({ generation: '9007199254740993', entry: null })
    expect(await writeSharedResolution(database.client, cacheIdentity, '9007199254740993', entry))
      .toEqual({ accepted: true, generation: '9007199254740993' })
  })

  it('awaits an RPC PromiseLike with no catch method', async () => {
    const { readSharedResolution, writeSharedResolution } = await helpers()
    const client = {
      rpc: (name: string, args: Record<string, unknown>) => ({
        then: (fulfilled: (result: Awaited<ReturnType<typeof database.rpc>>) => unknown) => database.rpc(name, args).then(fulfilled),
      }),
    } as unknown as SupabaseClient
    expect(await readSharedResolution(client, cacheIdentity, false)).toEqual({ generation: '0', entry: null })
    expect(await writeSharedResolution(client, cacheIdentity, '0', entry)).toEqual({ accepted: true, generation: '0' })
  })

  it('returns unavailable when either RPC reports missing migration or transport failure', async () => {
    const { readSharedResolution, writeSharedResolution } = await helpers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const missing = responseClient(null, { code: 'PGRST202', message: 'RPC not found' })
      const rejected = { rpc: () => Promise.reject(new Error('Connection unavailable')) } as unknown as SupabaseClient
      const synchronous = { rpc: () => { throw new Error('Client unavailable') } } as unknown as SupabaseClient
      for (const client of [missing, rejected, synchronous]) {
        expect(await readSharedResolution(client, cacheIdentity, false)).toBeNull()
        expect(await writeSharedResolution(client, cacheIdentity, '0', entry)).toBeNull()
      }
      expect(warn).toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })

  it.each([
    null,
    { generation: 0, entry: null },
    { generation: '-1', entry: null },
    { generation: '1e3', entry: null },
    { generation: '01', entry: null },
    { generation: '0' },
    { generation: '0', entry: hit() },
    { generation: '0', entry: hit(), expiresAt: NaN },
    { generation: '0', entry: hit(), expiresAt: Infinity },
    { generation: '0', entry: hit(), expiresAt: -1 },
    { generation: '0', entry: { ...hit(), isMiss: 'false' }, expiresAt: 2000 },
    { generation: '0', entry: { ...hit(), resolvedId: null }, expiresAt: 2000 },
    { generation: '0', entry: { ...hit(), source: 'unexpected' }, expiresAt: 2000 },
    { generation: '0', entry: { ...miss, resolvedId: 'unexpected-hit' }, expiresAt: 2000 },
    { generation: '0', entry: { ...hit(), duration: NaN }, expiresAt: 2000 },
    { generation: '0', entry: { ...hit(), coverUrl: 123 }, expiresAt: 2000 },
  ])('treats a malformed read response as unavailable (%j)', async data => {
    const { readSharedResolution } = await helpers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try { expect(await readSharedResolution(responseClient(data), cacheIdentity, false)).toBeNull() }
    finally { warn.mockRestore() }
  })

  it('accepts a well-formed shared miss with its database expiry', async () => {
    const { readSharedResolution, writeSharedResolution } = await helpers()
    await database.rpc('read_stream_resolution_cache', identity)
    expect(await writeSharedResolution(database.client, cacheIdentity, '0', { ...miss, expiresAt: 1 }))
      .toEqual({ accepted: true, generation: '0' })
    const result = await readSharedResolution(database.client, cacheIdentity, false)
    expect(result).toMatchObject({ generation: '0', entry: miss })
    expect(result?.entry?.expiresAt).toBeGreaterThan(Date.now())
  })

  it.each([
    null, { accepted: 'true', generation: '0' }, { accepted: true, generation: 0 },
    { accepted: false, generation: '-1' }, { generation: '0' },
  ])('treats a malformed write response as unavailable (%j)', async data => {
    const { writeSharedResolution } = await helpers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try { expect(await writeSharedResolution(responseClient(data), cacheIdentity, '0', entry)).toBeNull() }
    finally { warn.mockRestore() }
  })

  it('does not publish malformed entries or generation tokens', async () => {
    const { readSharedResolution, writeSharedResolution } = await helpers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await writeSharedResolution(database.client, cacheIdentity, '0', { ...entry, source: null })).toBeNull()
      expect(await writeSharedResolution(database.client, cacheIdentity, 'not-a-generation', entry)).toBeNull()
      expect(await readSharedResolution(database.client, cacheIdentity, false)).toEqual({ generation: '0', entry: null })
    } finally { warn.mockRestore() }
  })

  it.each(['read', 'write'])('bounds a stalled %s RPC and aborts its transport', async operation => {
    const { readSharedResolution, writeSharedResolution } = await helpers()
    vi.useFakeTimers()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let signal: AbortSignal | undefined
    const stalled = new Promise(() => {})
    const client = { rpc: () => Object.assign(stalled, {
      abortSignal: (value: AbortSignal) => { signal = value; return stalled },
    }) } as unknown as SupabaseClient
    try {
      const pending = operation === 'read'
        ? readSharedResolution(client, cacheIdentity, false)
        : writeSharedResolution(client, cacheIdentity, '0', entry)
      await vi.advanceTimersByTimeAsync(1500)
      expect(signal?.aborted).toBe(true)
      expect(await pending).toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers(); warn.mockRestore() }
  })
})
describe('shared stream resolution SQL protocol', () => {

  async function read(invalidate = false, key = identity): Promise<Snapshot | null> {
    return (await database.rpc('read_stream_resolution_cache', { ...key, p_invalidate: invalidate })).data as Snapshot | null
  }
  async function write(generation: string, entry: unknown, key = identity): Promise<Publication | null> {
    return (await database.rpc('write_stream_resolution_cache', { ...key, p_generation: generation, p_entry: entry })).data as Publication | null
  }

  it('creates a persistent generation on the first read', async () => {
    expect(await read()).toEqual({ generation: '0', entry: null })
  })

  it('rejects an old instance publication after another instance invalidates', async () => {
    expect(await read()).toMatchObject({ generation: '0' })
    expect(await read(true)).toEqual({ generation: '1', entry: null })
    expect(await write('0', hit())).toEqual({ accepted: false, generation: '1' })
    expect(await read()).toEqual({ generation: '1', entry: null })
  })

  it('rejects stale late preferred NCT even after a fresh fallback is published', async () => {
    await read()
    await read(true)
    expect(await write('1', hit('youtube', 'fresh'))).toEqual({ accepted: true, generation: '1' })
    expect(await write('0', hit('nhaccuatui', 'stale-nct'))).toEqual({ accepted: false, generation: '1' })
    expect(await read()).toMatchObject({ generation: '1', entry: { source: 'youtube', resolvedId: 'fresh' } })
  })

  it('keeps a valid hit when another resolver publishes a miss', async () => {
    await read()
    await write('0', hit())
    expect(await write('0', miss)).toEqual({ accepted: false, generation: '0' })
    expect(await read()).toMatchObject({ entry: { source: 'youtube', resolvedId: 'first', isMiss: false } })
  })

  it.each([
    ['drive', 'nhaccuatui'], ['nhaccuatui', 'soundcloud'], ['soundcloud', 'youtube'],
  ])('does not downgrade %s to %s in the same generation', async (preferred, fallback) => {
    await read()
    await write('0', hit(preferred))
    expect(await write('0', hit(fallback, 'fallback'))).toEqual({ accepted: false, generation: '0' })
    expect(await read()).toMatchObject({ entry: { source: preferred, resolvedId: 'first' } })
  })

  it('allows a late preferred result to replace a fallback or miss', async () => {
    await read()
    await write('0', miss)
    expect(await write('0', hit('youtube'))).toEqual({ accepted: true, generation: '0' })
    expect(await write('0', hit('nhaccuatui', 'late'))).toEqual({ accepted: true, generation: '0' })
    expect(await write('0', hit('drive', 'upload'))).toEqual({ accepted: true, generation: '0' })
    expect(await read()).toMatchObject({ entry: { source: 'drive', resolvedId: 'upload' } })
  })

  it('ignores caller expiry and gives hits 30 days and misses one hour', async () => {
    await read()
    await write('0', { ...hit(), expiresAt: 1 })
    const result = await read()
    expect(result?.expiresAt).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000)
    expect(result?.expiresAt).toBeLessThan(Date.now() + 31 * 24 * 60 * 60 * 1000)
    expect(result?.entry).not.toHaveProperty('expiresAt')
    await read(true)
    await write('1', { ...miss, expiresAt: Number.MAX_SAFE_INTEGER })
    const missed = await read()
    expect(missed?.expiresAt).toBeGreaterThan(Date.now() + 59 * 60 * 1000)
    expect(missed?.expiresAt).toBeLessThan(Date.now() + 61 * 60 * 1000)
  })

  it('hides expired payloads while retaining generation and allows replacement', async () => {
    await read(true)
    await write('1', hit('nhaccuatui'))
    await database.db.exec("UPDATE public.stream_resolution_cache SET expires_at = clock_timestamp() - interval '1 second'")
    expect(await read()).toEqual({ generation: '1', entry: null })
    expect(await write('0', hit('drive'))).toEqual({ accepted: false, generation: '1' })
    expect(await write('1', miss)).toEqual({ accepted: true, generation: '1' })
    expect(await read()).toMatchObject({ generation: '1', entry: miss })
  })

  it('increments on every invalidation including a key with no cached payload', async () => {
    expect(await read(true)).toEqual({ generation: '1', entry: null })
    expect(await read(true)).toEqual({ generation: '2', entry: null })
    expect(await write('1', hit())).toEqual({ accepted: false, generation: '2' })
    expect(await read()).toEqual({ generation: '2', entry: null })
  })

  it('does not round bigint generations through a JavaScript number', async () => {
    await read()
    await database.db.exec("UPDATE public.stream_resolution_cache SET generation = 9007199254740993")
    expect(await read()).toEqual({ generation: '9007199254740993', entry: null })
    expect(await read(true)).toEqual({ generation: '9007199254740994', entry: null })
    expect(await write('9007199254740993', hit())).toEqual({ accepted: false, generation: '9007199254740994' })
    expect(await write('9007199254740994', hit())).toEqual({ accepted: true, generation: '9007199254740994' })
  })

  it('isolates all three identity fields', async () => {
    await read()
    await write('0', hit())
    for (const key of [
      { ...identity, p_title_key: 'other' },
      { ...identity, p_artist_key: 'other' },
      { ...identity, p_duration_bucket: 190 },
    ]) expect(await read(true, key)).toEqual({ generation: '1', entry: null })
    expect(await read()).toMatchObject({ generation: '0', entry: hit() })
  })

  it('is rerunnable without resetting generations or touching legacy cache', async () => {
    await read(true)
    await write('1', hit())
    await database.db.exec(streamResolutionMigration())
    expect(await read()).toMatchObject({ generation: '1', entry: hit() })
    expect((await database.db.query('SELECT * FROM public.stream_resolutions')).rows)
      .toEqual([{ legacy_marker: 'preserve legacy cache' }])
  })

  it.each(['anon', 'authenticated'])('denies %s execution of either RPC and direct table access', async role => {
    await database.db.exec(`SET ROLE ${role}`)
    try {
      await expect(database.db.query("SELECT public.read_stream_resolution_cache('song', 'artist', 180, false)"))
        .rejects.toMatchObject({ code: '42501' })
      await expect(database.db.query("SELECT public.write_stream_resolution_cache('song', 'artist', 180, '0', '{}'::jsonb)"))
        .rejects.toMatchObject({ code: '42501' })
      await expect(database.db.query('SELECT * FROM public.stream_resolution_cache'))
        .rejects.toMatchObject({ code: '42501' })
    } finally { await database.db.exec('RESET ROLE') }
  })

  it('enables RLS and allows the service role only through the privileged RPCs', async () => {
    const result = await database.db.query<{ rls: boolean; read_owner: string; write_owner: string }>(`
      SELECT c.relrowsecurity AS rls,
        pg_get_userbyid(r.proowner) AS read_owner, pg_get_userbyid(w.proowner) AS write_owner
      FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      CROSS JOIN pg_proc r CROSS JOIN pg_proc w
      WHERE n.nspname = 'public' AND c.relname = 'stream_resolution_cache'
        AND r.oid = 'public.read_stream_resolution_cache(text,text,integer,boolean)'::regprocedure
        AND w.oid = 'public.write_stream_resolution_cache(text,text,integer,text,jsonb)'::regprocedure
    `)
    expect(result.rows).toEqual([{ rls: true, read_owner: 'postgres', write_owner: 'postgres' }])
    expect(await read()).toEqual({ generation: '0', entry: null })
    expect(await write('0', hit())).toEqual({ accepted: true, generation: '0' })
    await database.db.exec('SET ROLE service_role')
    try {
      await expect(database.db.query('DELETE FROM public.stream_resolution_cache')).rejects.toMatchObject({ code: '42501' })
    } finally { await database.db.exec('RESET ROLE') }
  })
})

describe('isolated production resolvers using the real SQL protocol', () => {
  const request = (invalidate = false) => new NextRequest(
    'https://music.test/api/resolve-stream?title=Song&artist=Artist&duration=180' + (invalidate ? '&invalidate=1' : ''),
  )
  const result = (id: string, source = 'youtube') => ({ ...hit(source, id), expiresAt: Date.now() + 600000 })
  beforeEach(() => {
    vi.resetModules()
    routeMocks.race.mockReset()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://database.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-test-key')
    routeMocks.client.mockReturnValue({
      rpc: database.rpc,
      from: () => {
        const builder = { select: () => builder, or: () => builder, limit: async () => ({ data: [] }) }
        return builder
      },
    })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
  async function instances() {
    const a = await import('../../app/api/resolve-stream/route')
    vi.resetModules()
    const b = await import('../../app/api/resolve-stream/route')
    expect(a.GET).not.toBe(b.GET)
    return { a, b }
  }

  it('refreshes another instance L1 after a real SQL invalidation', async () => {
    routeMocks.race.mockResolvedValueOnce(result('old')).mockResolvedValueOnce(result('fresh'))
    const { a, b } = await instances()
    await b.GET(request())
    await a.GET(request(true))
    expect((await (await b.GET(request())).json()).id).toBe('fresh')
    expect(routeMocks.race).toHaveBeenCalledTimes(2)
  })

  it('rejects old in-flight and late preferred writes through actual SQL', async () => {
    let finish!: (entry: ReturnType<typeof result>) => void
    let promote!: (entry: ReturnType<typeof result>) => void
    routeMocks.race.mockImplementationOnce((_p, _f, _t, callback) => {
      promote = callback
      return new Promise<ReturnType<typeof result>>(resolve => { finish = resolve })
    }).mockResolvedValueOnce(result('fresh'))
    const { a, b } = await instances()
    const old = a.GET(request())
    await vi.waitFor(() => expect(routeMocks.race).toHaveBeenCalledTimes(1))
    await b.GET(request(true))
    finish(result('stale')); await old
    promote(result('stale-nct', 'nhaccuatui'))
    // Drains queued RPC transactions, then observes persisted SQL state.
    const { readSharedResolution } = await import('../serverStreamResolutionCache')
    const snapshot = await readSharedResolution(database.client, { titleKey: 'song', artistKey: 'artist', durBucket: 180 }, false)
    expect(snapshot).toMatchObject({ generation: '1', entry: { resolvedId: 'fresh' } })
    expect((await (await a.GET(request())).json()).id).toBe('fresh')
  })
})
