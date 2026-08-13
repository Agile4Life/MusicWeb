import { describe, expect, it } from 'vitest'

import { calculateTilt } from '../tiltCardMath'

describe('calculateTilt', () => {
  it('returns bounded angles from pointer position', () => {
    expect(calculateTilt({ x: 0, y: 0, width: 100, height: 100 }, 8)).toEqual({
      rotateX: -8,
      rotateY: 8,
    })
  })

  it('does not produce invalid angles for an empty rectangle', () => {
    expect(calculateTilt({ x: 0, y: 0, width: 0, height: 0 }, 8)).toEqual({
      rotateX: 0,
      rotateY: 0,
    })
  })
})
