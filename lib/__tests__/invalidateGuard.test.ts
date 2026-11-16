import { describe, expect, it } from 'vitest'
import { createInvalidateGuard } from '../invalidateGuard'

describe('invalidate guard', () => {
  it('allows one bust per key per window', () => {
    const guard = createInvalidateGuard()
    expect(guard.allow('k', 'a', 0)).toBe(true)
    expect(guard.allow('k', 'b', 1000)).toBe(false)
    expect(guard.allow('k', 'a', 31_000)).toBe(true)
  })
  it('caps busts per client per minute', () => {
    const guard = createInvalidateGuard()
    for (let i = 0; i < 20; i++) expect(guard.allow(`k${i}`, 'a', i)).toBe(true)
    expect(guard.allow('another', 'a', 100)).toBe(false)
    expect(guard.allow('another', 'b', 100)).toBe(true)
    expect(guard.allow('another2', 'a', 61_000)).toBe(true)
  })
})
