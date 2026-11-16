import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const insert = vi.fn().mockResolvedValue({ error: null })
const getServerSession = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/authOptions', () => ({ authOptions: {} }))
vi.mock('@/lib/accessControl', () => ({ getValidUserId: (u: { id: string }) => u.id }))
vi.mock('@/lib/serverUser', () => ({ adminClient: { from: () => ({ insert }) } }))

import { POST } from '../route'

const req = (body: unknown) =>
  new Request('https://music.test/api/listen-events', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest

describe('listen-events route', () => {
  beforeEach(() => {
    insert.mockClear()
    getServerSession.mockReset()
  })

  it('does not write anything for anonymous callers', async () => {
    getServerSession.mockResolvedValue(null)
    const res = await POST(req({ track_id: 't1', completed: true }))
    expect(res.status).toBe(200)
    expect(insert).not.toHaveBeenCalled()
  })

  it('writes the event under the signed-in user', async () => {
    getServerSession.mockResolvedValue({ user: { id: 'user-1' } })
    await POST(req({ track_id: 't1', completed: true, skip_at_seconds: 12.4 }))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'user-1', track_id: 't1', skip_at_seconds: 12 }))
  })
})
