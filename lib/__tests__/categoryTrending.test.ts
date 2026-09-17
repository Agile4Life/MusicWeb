import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { fetchUnifiedSearch } from '../searchApi'

describe('category trending search API', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('sends the category parameter in the trending request URL', async () => {
    const mockData = {
      nhaccuatui: [],
      spotify: [
        { id: 'sp-kpop-1', title: 'Whiplash', artist: 'aespa', source: 'spotify' },
      ],
      youtube: [
        { id: 'yt-kpop-1', title: 'Supernova', artist: 'aespa', source: 'youtube' },
      ],
    }

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    })
    global.fetch = fetchMock

    const result = await fetchUnifiedSearch('', 'all', true, 'korean')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = fetchMock.mock.calls[0][0] as string
    expect(calledUrl).toContain('trending=true')
    expect(calledUrl).toContain('category=korean')
    expect(result.spotify).toHaveLength(1)
    expect(result.spotify[0].title).toBe('Whiplash')
    expect(result.youtube).toHaveLength(1)
  })

  it('separates cache keys by category so different categories do not collide', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('category=chinese')) {
        return {
          ok: true,
          json: async () => ({
            spotify: [{ id: 'sp-cpop-1', title: 'Dao Ma Dan', artist: 'Coco Lee', source: 'spotify' }],
          }),
        }
      }
      if (url.includes('category=japanese')) {
        return {
          ok: true,
          json: async () => ({
            spotify: [{ id: 'sp-jpop-1', title: 'Idol', artist: 'YOASOBI', source: 'spotify' }],
          }),
        }
      }
      return {
        ok: true,
        json: async () => ({ spotify: [] }),
      }
    })
    global.fetch = fetchMock

    // First call for chinese
    const cpopRes = await fetchUnifiedSearch('', 'all', true, 'chinese')
    expect(cpopRes.spotify[0].title).toBe('Dao Ma Dan')

    // Second call for japanese
    const jpopRes = await fetchUnifiedSearch('', 'all', true, 'japanese')
    expect(jpopRes.spotify[0].title).toBe('Idol')

    // Third call for chinese should use cache and not fetch again
    const cpopCached = await fetchUnifiedSearch('', 'all', true, 'chinese')
    expect(cpopCached.spotify[0].title).toBe('Dao Ma Dan')

    // Total fetch count should be 2 (one for chinese, one for japanese)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back gracefully to empty lists if the category fetch fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })
    global.fetch = fetchMock

    const result = await fetchUnifiedSearch('', 'all', true, 'invalid-cat')
    expect(result.spotify).toEqual([])
    expect(result.nhaccuatui).toEqual([])
    expect(result.youtube).toEqual([])
  })
})
