import { describe, expect, test, vi } from 'vitest'

import { scheduleAuthRedirect } from '../authNavigation'

describe('auth navigation', () => {
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
