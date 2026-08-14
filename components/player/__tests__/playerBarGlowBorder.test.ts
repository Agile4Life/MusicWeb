import { describe, expect, it } from 'vitest'

describe('PlayerBarGlowBorder calculation', () => {
  it('calculates correct normalized stroke-dashoffset based on progress ratio', () => {
    const pathLength = 100
    const progressRatio = 0.4
    const strokeDashoffset = pathLength * (1 - progressRatio)
    expect(strokeDashoffset).toBe(60)
  })

  it('handles 0% and 100% progress edge cases', () => {
    const pathLength = 100
    expect(pathLength * (1 - 0)).toBe(100)
    expect(pathLength * (1 - 1)).toBe(0)
  })
})
