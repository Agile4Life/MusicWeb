import { describe, expect, it } from 'vitest'
import { resolveCatalogCandidates } from '../catalogResolutionRace'

describe('resolveCatalogCandidates', () => {
  it('returns a fallback after the preferred source misses its head start', async () => {
    const startedAt = Date.now()
    const result = await resolveCatalogCandidates(
      () => new Promise((resolve) => setTimeout(() => resolve({ source: 'nhaccuatui' }), 200)),
      [async () => ({ source: 'youtube' })],
      20,
    )

    expect(result).toEqual({ source: 'youtube' })
    expect(Date.now() - startedAt).toBeLessThan(100)
  })

  it('keeps the preferred source when it resolves within its head start', async () => {
    const result = await resolveCatalogCandidates(
      () => new Promise((resolve) => setTimeout(() => resolve({ source: 'nhaccuatui' }), 5)),
      [async () => ({ source: 'youtube' })],
      20,
    )

    expect(result).toEqual({ source: 'nhaccuatui' })
  })

  it('returns null when every source is unavailable', async () => {
    await expect(resolveCatalogCandidates(
      async () => null,
      [async () => null, async () => { throw new Error('unavailable') }],
      0,
    )).resolves.toBeNull()
  })
})
