import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), clear: vi.fn() }))
vi.mock('@/lib/drive-stream-resolver', () => ({
  resolveDriveStreamUrl: mocks.resolve,
  clearAllCachesForFile: mocks.clear,
  getServiceClient: () => null,
}))

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

const req = (qs: string) => new NextRequest(`http://localhost/api/drive-stream?${qs}`)

describe('drive-stream cache headers', () => {
  it('never publicly caches an upstream error in proxy mode', async () => {
    mocks.resolve.mockResolvedValue({ url: 'https://cdn.example/a', contentType: 'audio/mpeg' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota', { status: 403 })))
    const { GET } = await import('../route')
    const res = await GET(req('fileId=abc&proxy=true'))
    expect(res.status).toBe(502)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('keeps the redirect short-lived so it cannot outlive its signed target', async () => {
    mocks.resolve.mockResolvedValue({ url: 'https://cdn.example/a', contentType: 'audio/mpeg' })
    const { GET } = await import('../route')
    const res = await GET(req('fileId=abc'))
    expect(res.status).toBe(302)
    const cc = res.headers.get('cache-control') || ''
    expect(cc).toContain('private')
    expect(cc).not.toContain('s-maxage')
  })
})
