import { describe, expect, it } from 'vitest'

import { shouldCommitGlobalSearch, shouldRedirectToHomeOnSearch } from '../searchInteraction'

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

describe('shouldRedirectToHomeOnSearch', () => {
  it('redirects to home when search is triggered on any tab other than home and soundcloud', () => {
    expect(shouldRedirectToHomeOnSearch('/albums')).toBe(true)
    expect(shouldRedirectToHomeOnSearch('/favorites')).toBe(true)
    expect(shouldRedirectToHomeOnSearch('/history')).toBe(true)
    expect(shouldRedirectToHomeOnSearch('/receipt')).toBe(true)
    expect(shouldRedirectToHomeOnSearch('/playlist/abc-123')).toBe(true)
    expect(shouldRedirectToHomeOnSearch('/settings')).toBe(true)
    expect(shouldRedirectToHomeOnSearch('/drive')).toBe(true)
    expect(shouldRedirectToHomeOnSearch('/upload')).toBe(true)
  })

  it('does not redirect when already on home page or soundcloud page', () => {
    expect(shouldRedirectToHomeOnSearch('/')).toBe(false)
    expect(shouldRedirectToHomeOnSearch('/soundcloud')).toBe(false)
  })
})
