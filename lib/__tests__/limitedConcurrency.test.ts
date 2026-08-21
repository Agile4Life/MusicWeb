import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '../limitedConcurrency'

describe('mapWithConcurrency', () => {
  it('never runs more tasks than the requested limit', async () => {
    let active = 0
    let peak = 0

    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
    })

    expect(peak).toBe(2)
  })
})
