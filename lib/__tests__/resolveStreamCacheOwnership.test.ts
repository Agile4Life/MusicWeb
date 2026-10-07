import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../driveTracksMap', () => ({ findMemoryDriveTrack: () => null }))

describe('client resolution persistence ownership', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    const storage = new Map<string, string>()
    vi.stubGlobal('window', {})
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('bypasses an older HTTP response on a normal network resolution', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) =>
      Response.json({ source: 'youtube', id: options?.cache === 'no-store' ? 'live-server-result' : 'old-http-cache' })))
    const { resolveStreamCached } = await import('../resolveStreamClient')
    const track = { title: 'HTTP Cache Song', artist: 'Artist' }
    expect((await resolveStreamCached(track))?.id).toBe('live-server-result')
    expect((await resolveStreamCached(track))?.id).toBe('live-server-result')
    // Explicit client persistence still prevents repeated network requests.
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reaches the server for eager invalidation and the subsequent forced refresh', async () => {
    let serverId = 'old'
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      // An existing browser response for invalidate=1 would skip the server.
      if (options?.cache !== 'no-store') return Response.json({ source: 'youtube', id: 'old-http-cache' })
      if (url.includes('invalidate=1')) serverId = 'fresh'
      return Response.json({ source: 'youtube', id: serverId })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { resolveStreamCached, invalidateStreamResolution } = await import('../resolveStreamClient')
    const track = { title: 'HTTP Invalidation Song', artist: 'Artist' }
    await resolveStreamCached(track)
    await invalidateStreamResolution(track)
    expect(serverId).toBe('fresh')
    expect((await resolveStreamCached(track))?.id).toBe('fresh')
    expect(fetchMock.mock.calls[1][1]?.cache).toBe('no-store')
    expect(fetchMock.mock.calls[2][1]?.cache).toBe('no-store')
  })

  it.each([{ source: 'soundcloud', id: 'stale' }, { miss: true }])(
    'does not persist stale response %j over a refreshed resolution', async (stale) => {
      let completeOld!: (response: Response) => void
      const oldResponse = new Promise<Response>((done) => { completeOld = done })
      const fetchMock = vi.fn()
        .mockReturnValueOnce(oldResponse)
        .mockResolvedValueOnce(Response.json({ miss: true })) // eager invalidation
        .mockResolvedValueOnce(Response.json({ source: 'nhaccuatui', id: 'fresh' }))
      vi.stubGlobal('fetch', fetchMock)
      const { resolveStreamCached, invalidateStreamResolution } = await import('../resolveStreamClient')
      const track = { title: 'Ownership Song', artist: 'Artist', duration: 123 }
      const old = resolveStreamCached(track)
      await invalidateStreamResolution(track)
      expect((await resolveStreamCached(track))?.id).toBe('fresh')
      completeOld(Response.json(stale))
      await old
      expect((await resolveStreamCached(track))?.id).toBe('fresh')
      const state = JSON.parse(localStorage.getItem('musicweb_playback_v2')!)
      expect(state.resolutions['ownership song___artist___123___'].resolvedId).toBe('fresh')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    },
  )
})
