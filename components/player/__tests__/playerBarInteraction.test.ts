import { describe, expect, it } from 'vitest'

import { isPlayerBarFeatureTarget } from '../playerBarInteraction'

describe('isPlayerBarFeatureTarget', () => {
  it('excludes buttons and explicitly protected metadata regions', () => {
    const target = { closest: (selector: string) => selector.includes('button') ? {} : null }
    expect(isPlayerBarFeatureTarget(target)).toBe(true)
  })

  it('allows ordinary player bar surface clicks', () => {
    expect(isPlayerBarFeatureTarget({ closest: () => null })).toBe(false)
  })
})
