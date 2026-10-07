import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  race: vi.fn(),
  createClient: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/catalogResolutionRace', () => ({ resolveCatalogCandidates: mocks.race }))
vi.mock('@/lib/driveTracksMap', () => ({ findMemoryDriveTrack: () => null }))
vi.mock('@/lib/soundcloudClient', () => ({ searchSoundCloudTracks: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const entry = (id: string, source = 'youtube') => ({
  source, resolvedId: id, isMiss: false, expiresAt: Date.now() + 600000,
})
const request = (invalidate = false) => new NextRequest(
  `https://music.test/api/resolve-stream?title=Ownership&artist=Artist${invalidate ? '&invalidate=1' : ''}`,
)
async function flush() {
  for (let count = 0; count < 30; count++) await Promise.resolve()
}

describe('resolve-stream server cache ownership', () => {
  let dbRow: Record<string, unknown> | null
  let writeIds: string[]
  let pendingWrite: Promise<void> | undefined
  let pendingRead: Promise<Record<string, unknown> | null> | undefined

  beforeEach(() => {
    vi.resetModules()
    mocks.race.mockReset()
    mocks.createClient.mockReset()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key')
    dbRow = null
    writeIds = []
    pendingWrite = undefined
    pendingRead = undefined
    // Supabase builders implement PromiseLike, without a .catch() method.
    mocks.createClient.mockReturnValue({
      from(table: string) {
        let operation = 'select'
        let payload: Record<string, unknown>
        const builder = {
          select: () => builder,
          or: () => builder,
          limit: () => builder,
          eq: () => builder,
          delete: () => { operation = 'delete'; return builder },
          upsert: (data: Record<string, unknown>) => { operation = 'upsert'; payload = data; return builder },
          single: async () => ({ data: pendingRead ? await pendingRead : dbRow }),
          then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
            const execute = async () => {
              if (table === 'tracks') return { data: [] }
              if (operation === 'delete') dbRow = null
              if (operation === 'upsert') {
                writeIds.push(String(payload.resolved_id))
                const barrier = pendingWrite
                pendingWrite = undefined
                if (barrier) await barrier
                dbRow = payload
              }
              return { data: null }
            }
            return execute().then(onFulfilled, onRejected)
          },
        }
        return builder
      },
    })
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it.each([false, true])('prevents HTTP caching of successful resolutions with invalidate=%s', async (invalidate) => {
    mocks.race.mockResolvedValue(entry('fresh', 'soundcloud'))
    const { GET } = await import('../route')
    const response = await GET(request(invalidate))
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toMatchObject({
      source: 'soundcloud', id: 'fresh', resolvedId: 'fresh', streamUrl: '/api/soundcloud/stream?id=fresh',
    })
  })

  it('keeps L1 hits fast while preventing browser and CDN response caching', async () => {
    mocks.race.mockResolvedValue(entry('fresh'))
    const { GET } = await import('../route')
    await GET(request())
    const cached = await GET(request())
    expect((await cached.json()).id).toBe('fresh')
    expect(mocks.race).toHaveBeenCalledOnce()
    expect(cached.headers.get('Cache-Control')).toBe('no-store')
  })

  it('keeps newer pending resolution deduplicated after an invalidated request completes', async () => {
    const old = deferred<ReturnType<typeof entry>>()
    const fresh = deferred<ReturnType<typeof entry>>()
    mocks.race.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise).mockResolvedValue(entry('unwanted-third-request'))
    const { GET } = await import('../route')
    const oldRequest = GET(request())
    await flush()
    const freshRequest = GET(request(true))
    await flush()
    old.resolve(entry('stale'))
    await oldRequest
    const coalesced = GET(request())
    await flush()
    expect(mocks.race).toHaveBeenCalledTimes(2)
    fresh.resolve(entry('fresh'))
    expect((await (await freshRequest).json()).id).toBe('fresh')
    expect((await (await coalesced).json()).id).toBe('fresh')
    await flush()
    expect((await (await GET(request())).json()).id).toBe('fresh')
    expect(dbRow?.resolved_id).toBe('fresh')
    expect(writeIds).toEqual(['fresh'])
  })

  it('does not promote an L2 read that crossed invalidation', async () => {
    const oldRead = deferred<Record<string, unknown> | null>()
    pendingRead = oldRead.promise
    mocks.race.mockResolvedValue(entry('fresh'))
    const { GET } = await import('../route')
    const oldRequest = GET(request())
    await flush()
    await GET(request(true))
    oldRead.resolve({ source: 'youtube', resolved_id: 'stale-l2', expires_at: new Date(Date.now() + 600000).toISOString() })
    await oldRequest
    pendingRead = undefined
    expect((await (await GET(request())).json()).id).toBe('fresh')
  })

  it('applies late NCT promotion after the initial fallback and awaits thenable writes', async () => {
    mocks.race.mockImplementationOnce(async (_preferred, _fallbacks, _window, onLate) => {
      onLate(entry('preferred', 'nhaccuatui'))
      return entry('fallback', 'soundcloud')
    })
    const { GET } = await import('../route')
    expect((await (await GET(request())).json()).id).toBe('fallback')
    await flush()
    expect((await (await GET(request())).json()).id).toBe('preferred')
    expect(dbRow?.resolved_id).toBe('preferred')
    expect(writeIds).toEqual(['fallback', 'preferred'])
  })

  it('ignores late promotion from an invalidated generation', async () => {
    let promote!: (value: ReturnType<typeof entry>) => void
    mocks.race.mockImplementationOnce(async (_preferred, _fallbacks, _window, onLate) => {
      promote = onLate
      return entry('fallback')
    }).mockResolvedValueOnce(entry('fresh'))
    const { GET } = await import('../route')
    await GET(request())
    await GET(request(true))
    promote(entry('stale-preferred', 'nhaccuatui'))
    await flush()
    expect((await (await GET(request())).json()).id).toBe('fresh')
    expect(dbRow?.resolved_id).toBe('fresh')
    expect(writeIds).not.toContain('stale-preferred')
  })

  it('serializes an already-started old write before invalidation and fresh persistence', async () => {
    const writeBarrier = deferred<void>()
    pendingWrite = writeBarrier.promise
    mocks.race.mockResolvedValueOnce(entry('old')).mockResolvedValueOnce(entry('fresh'))
    const { GET } = await import('../route')
    await GET(request())
    await flush()
    expect(writeIds).toEqual(['old'])
    const refreshed = GET(request(true))
    await flush()
    writeBarrier.resolve()
    await refreshed
    await flush()
    expect(dbRow?.resolved_id).toBe('fresh')
    expect(writeIds).toEqual(['old', 'fresh'])
  })

  it('invalidates L1 even when Supabase is unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    const fresh = deferred<ReturnType<typeof entry>>()
    mocks.race.mockResolvedValueOnce(entry('old')).mockReturnValueOnce(fresh.promise)
    const { GET } = await import('../route')
    await GET(request())
    const refreshed = GET(request(true))
    await flush()
    const coalesced = GET(request())
    await flush()
    fresh.resolve(entry('fresh'))
    await refreshed
    expect((await (await coalesced).json()).id).toBe('fresh')
    expect((await (await GET(request())).json()).id).toBe('fresh')
  })
})
