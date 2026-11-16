import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/middleware', () => ({ updateSession: vi.fn() }))

import { config } from '../../proxy'

// Next.js wraps each matcher source as a full-path regex.
const matches = (path: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(path))

describe('proxy matcher', () => {
  it('lets public worker scripts load without an auth redirect', () => {
    expect(matches('/sw.js')).toBe(false)
    expect(matches('/backgroundCompletionWorker.js')).toBe(false)
    expect(matches('/manifest.json')).toBe(false)
  })

  it('still guards app pages and API routes', () => {
    expect(matches('/history')).toBe(true)
    expect(matches('/api/history/list')).toBe(true)
  })
})
