import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals() })

describe('SoundCloud stream resolution in-flight ownership', () => {
  it('does not remember a transient upstream failure forever', async () => {
    let fetches = 0
    vi.stubGlobal('fetch', async () => { fetches++; return new Response('rate limited', { status: 429 }) })
    const sc = await import('@/lib/soundcloudClient')
    expect(await sc.resolveSoundCloudStreamUrl('998877')).toBeNull()
    const afterFirst = fetches
    expect(afterFirst).toBeGreaterThan(0)
    // The second call must hit upstream again instead of replaying a stale null.
    expect(await sc.resolveSoundCloudStreamUrl('998877')).toBeNull()
    expect(fetches).toBeGreaterThan(afterFirst)
  })
})
