import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALBUM_RESOLVE_NEGATIVE_TTL_MS,
  resetAlbumResolveClientState,
  resolveAlbumDeduped,
} from '../albumResolveClient'

const params = { title: 't', artist: 'a', album: '', trackId: '1' }
const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response
const notFound = () => ({ ok: false, json: async () => ({}) }) as unknown as Response

describe('resolveAlbumDeduped', () => {
  beforeEach(() => resetAlbumResolveClientState())

  it('dedupes concurrent identical requests', async () => {
    const f = vi.fn().mockResolvedValue(ok({ albumId: 'x', albumName: 'X' }))
    const [a, b] = await Promise.all([
      resolveAlbumDeduped(params, f as unknown as typeof fetch),
      resolveAlbumDeduped(params, f as unknown as typeof fetch),
    ])
    expect(f).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    expect(a?.albumId).toBe('x')
  })

  it('does not dedupe different tracks', async () => {
    const f = vi.fn().mockResolvedValue(ok({ albumId: 'x' }))
    await Promise.all([
      resolveAlbumDeduped(params, f as unknown as typeof fetch),
      resolveAlbumDeduped({ ...params, trackId: '2' }, f as unknown as typeof fetch),
    ])
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('negative-caches 404 until TTL expires', async () => {
    const f = vi.fn().mockResolvedValue(notFound())
    let t = 1000
    const now = () => t
    expect(await resolveAlbumDeduped(params, f as unknown as typeof fetch, now)).toBeNull()
    expect(await resolveAlbumDeduped(params, f as unknown as typeof fetch, now)).toBeNull()
    expect(f).toHaveBeenCalledTimes(1)
    t += ALBUM_RESOLVE_NEGATIVE_TTL_MS + 1
    await resolveAlbumDeduped(params, f as unknown as typeof fetch, now)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('treats network errors as null and does not cache successes negatively', async () => {
    const bad = vi.fn().mockRejectedValue(new Error('x'))
    expect(await resolveAlbumDeduped(params, bad as unknown as typeof fetch)).toBeNull()
    resetAlbumResolveClientState()
    const good = vi.fn().mockResolvedValue(ok({ albumId: 'y' }))
    await resolveAlbumDeduped(params, good as unknown as typeof fetch)
    await resolveAlbumDeduped(params, good as unknown as typeof fetch)
    expect(good).toHaveBeenCalledTimes(2)
  })
})
