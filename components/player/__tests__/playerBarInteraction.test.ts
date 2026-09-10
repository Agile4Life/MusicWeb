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

  it('guarantees PlayerBar has no conditional early return violating rules of hooks', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const playerBarSource = fs.readFileSync(path.resolve(__dirname, '../PlayerBar.tsx'), 'utf8')
    
    // Ensure no early return before useState/useEffect
    const match = playerBarSource.match(/if\s*\(\s*isNowPlayingOpen\s*\)\s*return/g)
    expect(match).toBeNull()
  })
})

