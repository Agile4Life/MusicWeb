import { describe, expect, it } from 'vitest'
import { firstValidResult } from '../firstValidResult'

describe('firstValidResult', () => {
  it('returns the first non-null result without waiting for slower tasks', async () => {
    const startedAt = Date.now()
    const result = await firstValidResult([
      async () => null,
      async () => ({ url: 'https://fast.example/audio', mimeType: 'audio/mp4' }),
      async () => new Promise<null>((resolve) => setTimeout(() => resolve(null), 100)),
    ])

    expect(result).toEqual({ url: 'https://fast.example/audio', mimeType: 'audio/mp4' })
    expect(Date.now() - startedAt).toBeLessThan(75)
  })

  it('returns null when every candidate is unavailable', async () => {
    await expect(firstValidResult([
      async () => null,
      async () => { throw new Error('unavailable') },
    ])).resolves.toBeNull()
  })
})
