import { describe, expect, it } from 'vitest'

import { shouldCommitGlobalSearch } from '../searchInteraction'

describe('shouldCommitGlobalSearch', () => {
  it('commits only a non-empty query on Enter', () => {
    expect(shouldCommitGlobalSearch('s', 'Enter')).toBe(true)
    expect(shouldCommitGlobalSearch('  s  ', 'Enter')).toBe(true)
  })

  it('does not commit empty or non-submit keyboard actions', () => {
    expect(shouldCommitGlobalSearch('', 'Enter')).toBe(false)
    expect(shouldCommitGlobalSearch('s', 'Escape')).toBe(false)
  })
})
