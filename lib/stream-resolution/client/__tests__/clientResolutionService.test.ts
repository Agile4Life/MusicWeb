import { expect, it, vi } from 'vitest'
import { createClientResolutionService } from '../clientResolutionService'
import type { ClientResolutionDeps } from '../contracts'

const track = { title: 'Song', artist: 'Artist' }
function setup() {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ source: 'youtube', id: 'video-1' }))
  const deps: ClientResolutionDeps = {
    fetch, now: () => 100, findMemoryDriveTrack: () => null,
    persistence: { get: vi.fn(() => null), save: vi.fn(), delete: vi.fn() },
    buildStreamUrl: (_source, id) => `/proxy?id=${id}`,
  }
  return { deps, fetch }
}
function deferred() {
  let complete!: (response: Response) => void
  const promise = new Promise<Response>(resolve => { complete = resolve })
  return { promise, complete }
}
it('isolates caches while coalescing requests within an instance', async () => {
  const { deps, fetch } = setup()
  const a = createClientResolutionService(deps)
  const b = createClientResolutionService(deps)
  const results = await Promise.all([a.resolve(track), a.resolve(track)])
  expect(results.map(result => result?.id)).toEqual(['video-1', 'video-1'])
  expect(fetch).toHaveBeenCalledTimes(1)
  await a.resolve(track)
  expect(fetch).toHaveBeenCalledTimes(1)
  await b.resolve(track)
  expect(fetch).toHaveBeenCalledTimes(2)
  a.dispose(); b.dispose()
})
it('revokes pending writes and future work on idempotent disposal', async () => {
  const { deps, fetch } = setup()
  const pending = deferred()
  fetch.mockReturnValueOnce(pending.promise)
  const service = createClientResolutionService(deps)
  const result = service.resolve(track)
  service.dispose(); service.dispose()
  pending.complete(Response.json({ source: 'youtube', id: 'late' }))
  expect(await result).toBeNull()
  expect(deps.persistence.save).not.toHaveBeenCalled()
  expect(await service.resolve(track)).toBeNull()
  await service.invalidate(track)
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(deps.persistence.delete).not.toHaveBeenCalled()
})
it.each([{ source: 'youtube', id: 'old' }, { miss: true }])('keeps a new pending owner after stale completion %j', async stale => {
  const { deps, fetch } = setup()
  const a = deferred(), b = deferred()
  fetch.mockReturnValueOnce(a.promise).mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(b.promise)
  const service = createClientResolutionService(deps)
  const old = service.resolve(track)
  await service.invalidate(track)
  const fresh = service.resolve(track)
  a.complete(Response.json(stale))
  expect(await old).toBeNull()
  expect(deps.persistence.save).not.toHaveBeenCalled()
  const duplicate = service.resolve(track)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(String(fetch.mock.calls[2][0])).toContain('invalidate=1')
  b.complete(Response.json({ source: 'soundcloud', id: 'new' }))
  expect((await fresh)?.id).toBe('new')
  expect((await duplicate)?.id).toBe('new')
  expect((await service.resolve(track))?.id).toBe('new')
  expect(deps.persistence.save).toHaveBeenCalledTimes(1)
  service.dispose()
})
it.each([{ source: 'youtube', id: 'video-1' }, { miss: true }])('expires network cache at the correct boundary %j', async payload => {
  const { deps, fetch } = setup()
  let now = 100
  deps.now = () => now
  fetch.mockImplementation(async () => Response.json(payload))
  const service = createClientResolutionService(deps)
  await service.resolve(track)
  now += 'miss' in payload ? 59999 : 299999
  await service.resolve(track)
  expect(fetch).toHaveBeenCalledTimes(1)
  now++
  await service.resolve(track)
  expect(fetch).toHaveBeenCalledTimes(2)
  service.dispose()
})
it('preserves null YouTube fallback while deriving other provider URLs and persistence TTL', async () => {
  const { deps, fetch } = setup()
  const service = createClientResolutionService(deps)
  expect((await service.resolve(track))?.streamUrl).toBeNull()
  expect(deps.persistence.save).toHaveBeenCalledWith('song___artist___0___', { source: 'youtube', resolvedId: 'video-1', ttl: 1800000 })
  fetch.mockResolvedValueOnce(Response.json({ source: 'soundcloud', resolved_id: 'sc' }))
  expect((await service.resolve({ title: 'Other' }))?.streamUrl).toBe('/proxy?id=sc')
  service.dispose()
})
it.each(['http', 'fetch', 'json'])('allows a retry after a %s failure', async failure => {
  const { deps, fetch } = setup()
  if (failure === 'http') fetch.mockResolvedValueOnce(new Response('', { status: 500 }))
  if (failure === 'fetch') fetch.mockRejectedValueOnce(new Error('offline'))
  if (failure === 'json') fetch.mockResolvedValueOnce(new Response('invalid'))
  const service = createClientResolutionService(deps)
  expect(await service.resolve(track)).toBeNull()
  expect((await service.resolve(track))?.id).toBe('video-1')
  expect(fetch).toHaveBeenCalledTimes(2)
  service.dispose()
})
it('keeps static Drive before persistence and bypasses both after invalidation', async () => {
  const { deps, fetch } = setup()
  deps.findMemoryDriveTrack = () => ({ id: 'drive', file_path: '/drive', title: 'Song', artist: 'Artist' })
  deps.persistence.get = vi.fn(() => ({ source: 'soundcloud', resolvedId: 'persisted' }))
  const service = createClientResolutionService(deps)
  expect((await service.resolve(track))?.id).toBe('/drive')
  expect(deps.persistence.get).not.toHaveBeenCalled()
  expect(fetch).not.toHaveBeenCalled()
  await service.invalidate(track)
  expect((await service.resolve(track))?.id).toBe('video-1')
  expect(String(fetch.mock.calls[1][0])).toContain('invalidate=1')
  service.dispose()
})
it('gives persisted hits and misses precedence over an existing memory hit', async () => {
  const { deps, fetch } = setup()
  const get = vi.fn<ClientResolutionDeps['persistence']['get']>(() => null)
  deps.persistence.get = get
  const service = createClientResolutionService(deps)
  await service.resolve(track)
  get.mockReturnValue({ source: 'soundcloud', resolvedId: 'persisted' })
  expect(await service.resolve(track)).toEqual({ source: 'soundcloud', id: 'persisted' })
  get.mockReturnValue({ source: 'none', resolvedId: '' })
  expect(await service.resolve(track)).toBeNull()
  expect(fetch).toHaveBeenCalledTimes(1)
  service.dispose()
})
it('evicts the oldest memory entry after 300 unique resolutions', async () => {
  const { deps, fetch } = setup()
  const service = createClientResolutionService(deps)
  for (let index = 0; index < 301; index++) await service.resolve({ title: `Song ${index}` })
  await service.resolve({ title: 'Song 1' })
  expect(fetch).toHaveBeenCalledTimes(301)
  await service.resolve({ title: 'Song 0' })
  expect(fetch).toHaveBeenCalledTimes(302)
  service.dispose()
})
it('creates no timers, network requests, or storage work and ignores blank titles', async () => {
  const { deps, fetch } = setup()
  const interval = vi.spyOn(globalThis, 'setInterval')
  const timeout = vi.spyOn(globalThis, 'setTimeout')
  try {
    const service = createClientResolutionService(deps)
    expect(await service.resolve({ title: '  ' })).toBeNull()
    await service.invalidate({ title: '' })
    expect(fetch).not.toHaveBeenCalled()
    expect(deps.persistence.get).not.toHaveBeenCalled()
    expect(deps.persistence.save).not.toHaveBeenCalled()
    expect(deps.persistence.delete).not.toHaveBeenCalled()
    expect(interval).not.toHaveBeenCalled()
    expect(timeout).not.toHaveBeenCalled()
    service.dispose()
  } finally { interval.mockRestore(); timeout.mockRestore() }
})
it('retries when fetch throws synchronously before returning a promise', async () => {
  const { deps, fetch } = setup()
  fetch.mockImplementationOnce(() => { throw new Error('synchronous fetch failure') })
  const service = createClientResolutionService(deps)
  expect(await service.resolve(track)).toBeNull()
  expect((await service.resolve(track))?.id).toBe('video-1')
  expect(fetch).toHaveBeenCalledTimes(2)
  service.dispose()
})
it('retains the baseline memory hit when saving persistence throws', async () => {
  const { deps, fetch } = setup()
  deps.persistence.save = () => { throw new Error('storage unavailable') }
  const service = createClientResolutionService(deps)
  expect(await service.resolve(track)).toBeNull()
  expect((await service.resolve(track))?.id).toBe('video-1')
  expect(fetch).toHaveBeenCalledTimes(1)
  service.dispose()
})
it('revokes publication when disposed while response JSON is pending', async () => {
  const { deps, fetch } = setup()
  let complete!: (payload: unknown) => void
  let started!: () => void
  const reading = new Promise<void>(resolve => { started = resolve })
  const payload = new Promise<unknown>(resolve => { complete = resolve })
  fetch.mockResolvedValueOnce({ ok: true, json: () => { started(); return payload } } as Response)
  const service = createClientResolutionService(deps)
  const result = service.resolve(track)
  await reading
  service.dispose()
  complete({ source: 'youtube', id: 'late-json' })
  expect(await result).toBeNull()
  expect(deps.persistence.save).not.toHaveBeenCalled()
})
