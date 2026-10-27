import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getServerSessionMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: (...args: unknown[]) => getServerSessionMock(...args),
}))

vi.mock('@/lib/authOptions', () => ({
  authOptions: {},
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  }),
}))

vi.mock('@/lib/serverUser', () => ({
  adminClient: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [] }),
      update: vi.fn().mockReturnThis(),
    })),
  },
}))

vi.mock('@/lib/trackPersistence', () => ({
  resolveExternalTrackId: vi.fn().mockResolvedValue('550e8400-e29b-41d4-a716-446655440099'),
}))

import { GET, POST } from '../route'

describe('/api/lyrics/custom route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-admin users with 403 Forbidden on POST', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { email: 'listener@example.com' },
    })

    const req = new NextRequest('http://localhost:3000/api/lyrics/custom', {
      method: 'POST',
      body: JSON.stringify({
        track: { id: 'sc-555', title: 'Test Song', artist: 'Test Artist' },
        lyrics: '[00:01.00] Hello world',
      }),
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.success).toBe(false)
  })

  it('allows Admin to save custom synced lyrics and serves them on GET', async () => {
    getServerSessionMock.mockResolvedValue({
      user: { email: 'admin@musicweb.com' },
    })

    const postReq = new NextRequest('http://localhost:3000/api/lyrics/custom', {
      method: 'POST',
      body: JSON.stringify({
        track: {
          id: 'sc-888',
          source: 'soundcloud',
          soundcloud_id: '888',
          title: 'Bài Hát Không Lời Tự Động',
          artist: 'Indie Artist',
          duration: 195,
        },
        lyrics: '[00:02.10] Câu hát đầu tiên\n[00:06.40] Câu hát thứ hai',
      }),
    })

    const postRes = await POST(postReq)
    expect(postRes.status).toBe(200)
    const postJson = await postRes.json()
    expect(postJson.success).toBe(true)
    expect(postJson.data?.syncedLyrics).toBe(
      '[00:02.10] Câu hát đầu tiên\n[00:06.40] Câu hát thứ hai',
    )

    const getReq = new NextRequest(
      'http://localhost:3000/api/lyrics/custom?id=sc-888&soundcloud_id=888&title=B%C3%A0i%20H%C3%A1t%20Kh%C3%B4ng%20L%E1%BB%9Di%20T%E1%BB%B1%20%C4%90%E1%BB%99ng&artist=Indie%20Artist',
      { method: 'GET' },
    )
    const getRes = await GET(getReq)
    expect(getRes.status).toBe(200)
    const getJson = await getRes.json()
    expect(getJson.found).toBe(true)
    expect(getJson.data?.syncedLyrics).toBe(
      '[00:02.10] Câu hát đầu tiên\n[00:06.40] Câu hát thứ hai',
    )
  })
})
