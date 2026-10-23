import { describe, expect, test, vi } from 'vitest'

import { safeAuthReturnTo, scheduleAuthRedirect } from '../authNavigation'

describe('auth navigation', () => {
  test('returns song battle publishers to the lab after sign-in', () => {
    vi.useFakeTimers()
    const replace = vi.fn()
    scheduleAuthRedirect({ replace, refresh: vi.fn() }, 800, '/spotify-lab')
    vi.advanceTimersByTime(800)
    expect(replace).toHaveBeenCalledWith('/spotify-lab')
    vi.useRealTimers()
  })
  test.each(['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', '/%2f%2fevil.test', '/login', null])('rejects unsafe or unsupported return destination %s', value => {
    expect(safeAuthReturnTo(value)).toBe('/')
  })
  test('accepts the lab return destination only', () => {
    expect(safeAuthReturnTo('/spotify-lab')).toBe('/spotify-lab')
  })
  test('redirects to the app through the Next router so login does not hard reload', () => {
    vi.useFakeTimers()
    const replace = vi.fn()
    const refresh = vi.fn()

    scheduleAuthRedirect({ replace, refresh }, 800)

    expect(replace).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(800)

    expect(replace).toHaveBeenCalledWith('/')
    expect(refresh).toHaveBeenCalledTimes(1)

    vi.useRealTimers()
  })
})
