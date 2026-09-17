import { describe, expect, it } from 'vitest'

import {
  shouldCommitGlobalSearch,
  shouldRedirectToHomeOnSearch,
  shouldKeepSearchOpenOnScroll,
  shouldCloseSearchOnOutsideClick,
} from '../searchInteraction'

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

describe('shouldKeepSearchOpenOnScroll', () => {
  it('keeps search open if explicitly opened by user regardless of scroll', () => {
    expect(shouldKeepSearchOpenOnScroll(true, 0)).toBe(true)
    expect(shouldKeepSearchOpenOnScroll(true, 0.05)).toBe(true)
    expect(shouldKeepSearchOpenOnScroll(true, 0.5)).toBe(true)
  })

  it('keeps search open if scroll is past threshold even if not explicitly opened', () => {
    expect(shouldKeepSearchOpenOnScroll(false, 0.15)).toBe(true)
    expect(shouldKeepSearchOpenOnScroll(false, 0.8)).toBe(true)
  })

  it('does not keep search open at top of page if not explicitly opened', () => {
    expect(shouldKeepSearchOpenOnScroll(false, 0)).toBe(false)
    expect(shouldKeepSearchOpenOnScroll(false, 0.08)).toBe(false)
  })
})

describe('shouldCloseSearchOnOutsideClick', () => {
  it('closes search when explicitly opened, without query, and near top of page', () => {
    expect(shouldCloseSearchOnOutsideClick(true, false, 0)).toBe(true)
    expect(shouldCloseSearchOnOutsideClick(true, false, 0.1)).toBe(true)
  })

  it('does not close search if user has typed a query', () => {
    expect(shouldCloseSearchOnOutsideClick(true, true, 0)).toBe(false)
    expect(shouldCloseSearchOnOutsideClick(true, true, 0.1)).toBe(false)
  })

  it('does not close search if user is scrolled down beyond threshold', () => {
    expect(shouldCloseSearchOnOutsideClick(true, false, 0.3)).toBe(false)
    expect(shouldCloseSearchOnOutsideClick(true, false, 0.8)).toBe(false)
  })

  it('does not close search if search was not explicitly opened', () => {
    expect(shouldCloseSearchOnOutsideClick(false, false, 0)).toBe(false)
  })
})

