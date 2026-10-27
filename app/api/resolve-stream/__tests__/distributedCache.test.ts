import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ race: vi.fn(), client: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.client }))
vi.mock('@/lib/catalogResolutionRace', () => ({ resolveCatalogCandidates: mocks.race }))
vi.mock('@/lib/driveTracksMap', () => ({ findMemoryDriveTrack: () => null }))
vi.mock('@/lib/soundcloudClient', () => ({ searchSoundCloudTracks: vi.fn(), verifySoundCloudTrackPlayable: vi.fn(async () => true) }))
vi.mock('@/lib/nctCacheStore', () => ({
  searchNctCached: vi.fn(async () => []),
  resolveNctSongDetailCached: vi.fn(async () => ({ audioUrl: 'https://audio.test/nct.mp3' })),
}))

type Entry = { source: string; resolvedId: string; isMiss: boolean; expiresAt: number }
const entry = (id: string, source = 'youtube'): Entry => ({
  source, resolvedId: id, isMiss: false, expiresAt: Date.now() + 600000,
})
const request = (invalidate = false) => new NextRequest(
  'https://music.test/api/resolve-stream?title=Shared&artist=Artist' + (invalidate ? '&invalidate=1' : ''),
)
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

describe('production resolver modules sharing a database', () => {
  let generation: bigint
  let sharedEntry: Entry | null
  let legacyRow: Record<string, unknown> | null
  let rpcAvailable: boolean
  let writes: string[]
  let legacyWrites: number

  beforeEach(() => {
    vi.resetModules()
    mocks.race.mockReset()
    mocks.client.mockReset()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://database.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'server-only-test-key')
    generation = BigInt(0); sharedEntry = null; legacyRow = null
    rpcAvailable = true; writes = []; legacyWrites = 0
    mocks.client.mockReturnValue({
      async rpc(name: string, params: Record<string, unknown>) {
        if (!rpcAvailable) return { data: null, error: { code: 'PGRST202', message: 'RPC not installed' } }
        if (name === 'read_stream_resolution_cache') {
          if (params.p_invalidate) { generation++; sharedEntry = null }
          return { data: { generation: String(generation), entry: sharedEntry, expiresAt: Date.now() + 600000 }, error: null }
        }
        if (name === 'write_stream_resolution_cache') {
          const accepted = String(params.p_generation) === String(generation)
          if (accepted) {
            sharedEntry = params.p_entry as Entry
            writes.push(sharedEntry.resolvedId)
          }
          return { data: { generation: String(generation), accepted }, error: null }
        }
        throw new Error('Unexpected RPC ' + name)
      },
      // Legacy storage exists so the baseline can reproduce its real unsafe writes.
      from(table: string) {
        let operation = 'read'
        let payload: Record<string, unknown>
        const builder = {
          select: () => builder, or: () => builder, limit: () => builder, eq: () => builder,
          single: async () => ({ data: legacyRow }),
          delete: () => { operation = 'delete'; return builder },
          upsert: (value: Record<string, unknown>) => { operation = 'write'; payload = value; return builder },
          then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
            return Promise.resolve().then(() => {
              if (table === 'tracks') return { data: [] }
              if (operation === 'delete') legacyRow = null
              if (operation === 'write') {
                legacyWrites++; legacyRow = payload
                sharedEntry = entry(String(payload.resolved_id), String(payload.source))
              }
              return { data: null }
            }).then(resolve, reject)
          },
        }
        return builder
      },
    })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  async function instances() {
    const a = await import('../route')
    vi.resetModules()
    const b = await import('../route')
    expect(a.GET).not.toBe(b.GET)
    return { a, b }
  }

  it('invalidates the other instance cached L1 before reusing it', async () => {
    mocks.race.mockResolvedValueOnce(entry('old')).mockResolvedValueOnce(entry('fresh'))
    const { a, b } = await instances()
    await b.GET(request()); await flush()
    await a.GET(request(true)); await flush()
    expect((await (await b.GET(request())).json()).id).toBe('fresh')
    expect(mocks.race).toHaveBeenCalledTimes(2)
    expect(legacyWrites).toBe(0)
  })

  it('rejects an old in-flight result from another instance after invalidation', async () => {
    const old = deferred<Entry>()
    mocks.race.mockReturnValueOnce(old.promise).mockResolvedValueOnce(entry('fresh'))
    const { a, b } = await instances()
    const pending = a.GET(request()); await flush()
    await b.GET(request(true)); await flush()
    old.resolve(entry('stale')); await pending; await flush()
    expect(sharedEntry?.resolvedId).toBe('fresh')
    expect(writes).not.toContain('stale')
    expect((await (await a.GET(request())).json()).id).toBe('fresh')
  })

  it('rejects late preferred publication owned by a revoked shared version', async () => {
    let promote!: (value: Entry) => void
    mocks.race.mockImplementationOnce(async (_p, _f, _t, callback) => {
      promote = callback
      return entry('fallback')
    }).mockResolvedValueOnce(entry('fresh'))
    const { a, b } = await instances()
    await a.GET(request()); await flush()
    await b.GET(request(true)); await flush()
    promote(entry('stale-nct', 'nhaccuatui')); await flush()
    expect(sharedEntry?.resolvedId).toBe('fresh')
    expect(writes).not.toContain('stale-nct')
  })

  it('observes a preferred upgrade on another instance within the same version', async () => {
    let promote!: (value: Entry) => void
    mocks.race.mockImplementationOnce(async (_p, _f, _t, callback) => {
      promote = callback
      return entry('fallback', 'soundcloud')
    })
    const { a, b } = await instances()
    await a.GET(request()); await flush()
    expect((await (await b.GET(request())).json()).id).toBe('fallback')
    promote(entry('preferred', 'nhaccuatui')); await flush()
    expect((await (await b.GET(request())).json()).id).toBe('preferred')
  })

  it('bypasses shared and legacy caches when RPC is missing', async () => {
    rpcAvailable = false
    legacyRow = {
      source: 'youtube', resolved_id: 'legacy-broken',
      expires_at: new Date(Date.now() + 600000).toISOString(),
    }
    mocks.race.mockResolvedValue(entry('fresh'))
    const { a } = await instances()
    expect((await (await a.GET(request())).json()).id).toBe('fresh')
    await flush()
    expect(legacyWrites).toBe(0)
  })

  it('does not serve coordinated L1 without a fresh shared version during DB outage', async () => {
    mocks.race.mockResolvedValueOnce(entry('old')).mockResolvedValueOnce(entry('fresh'))
    const { a } = await instances()
    await a.GET(request()); await flush()
    rpcAvailable = false
    expect((await (await a.GET(request())).json()).id).toBe('fresh')
    expect(mocks.race).toHaveBeenCalledTimes(2)
  })

  it('does not reuse revoked in-flight work while the shared version is unavailable', async () => {
    const old = deferred<Entry>()
    mocks.race.mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(entry('other-instance-fresh'))
      .mockResolvedValueOnce(entry('outage-fresh'))
    const { a, b } = await instances()
    const pending = a.GET(request()); await flush()
    await b.GET(request(true))
    rpcAvailable = false
    const duringOutage = a.GET(request()); await flush()
    expect(mocks.race).toHaveBeenCalledTimes(3)
    expect((await (await duringOutage).json()).id).toBe('outage-fresh')
    old.resolve(entry('stale')); await pending
  })

  it('compares a delayed retry against the latest observed generation', async () => {
    const { a } = await instances()
    mocks.race.mockResolvedValue(entry('fresh'))
    generation = BigInt(2)
    await a.GET(request())
    const retry = deferred<{ data: unknown; error: null }>()
    const client = mocks.client.mock.results[0].value
    const originalRpc = client.rpc.bind(client)
    const rpc = vi.spyOn(client, 'rpc')
    rpc.mockResolvedValueOnce({ data: { generation: '1', entry: null }, error: null })
      .mockReturnValueOnce(retry.promise)
    const delayed = a.GET(request()); await flush()
    generation = BigInt(3); sharedEntry = null
    await a.GET(request())
    retry.resolve({ data: { generation: '2', entry: entry('stale-retry'), expiresAt: Date.now() + 600000 }, error: null })
    expect((await (await delayed).json()).id).toBe('fresh')
    rpc.mockImplementation(originalRpc)
  })

  it.each(['read', 'write'])('resolves fresh audio despite a stalled cache %s', async operation => {
    const { a } = await instances()
    const client = mocks.client() as {
      rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
    }
    const originalRpc = client.rpc.bind(client)
    vi.spyOn(client, 'rpc').mockImplementation((name: string, args: Record<string, unknown>) =>
      name === `${operation}_stream_resolution_cache` ? new Promise(() => {}) : originalRpc(name, args))
    mocks.race.mockResolvedValue(entry('fresh'))
    vi.useFakeTimers()
    try {
      const pending = a.GET(request())
      await vi.advanceTimersByTimeAsync(1500)
      expect((await (await pending).json()).id).toBe('fresh')
      expect(mocks.race).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })
})
