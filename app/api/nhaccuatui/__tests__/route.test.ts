import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET as searchGET } from '../search/route'
import { GET as songGET } from '../song/[id]/route'

describe('NhacCuaTui proxy routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.NCT_API_BASE_URL
  })

  it('normalizes search metadata and does not expose upstream details', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([
        { id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto' },
      ]), { status: 200 }),
    )

    const response = await searchGET(new Request('https://music.test/api/nhaccuatui/search?q=x%C6%B0%C6%A1ng%20r%E1%BB%93ng'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      items: [{ id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto' }],
    })
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://nct-api.test/api/search?q=x%C6%B0%C6%A1ng+r%E1%BB%93ng')
  })

  it('returns only an allowlisted fresh song stream', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        id: 'nct-1',
        title: 'Xương Rồng',
        artist: 'Dangrangto',
        audioUrl: 'https://stream.nct.vn/song.mp3?expires=123',
      }), { status: 200 }),
    )

    const response = await songGET(new Request('https://music.test/api/nhaccuatui/song/nct-1'), {
      params: Promise.resolve({ id: 'nct-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      song: {
        id: 'nct-1',
        title: 'Xương Rồng',
        artist: 'Dangrangto',
        coverUrl: null,
        duration: null,
        lyric: null,
        audioUrl: 'https://stream.nct.vn/song.mp3?expires=123',
      },
    })
  })
})
