import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const resolve = vi.hoisted(() => vi.fn())
vi.mock('@/lib/stream-resolution/server/composition', () => ({ getServerResolutionService: () => ({ resolve }) }))
vi.mock('@/lib/nhaccuatuiClient', () => ({ getNhacCuaTuiStreamUrl: () => null }))
import { GET } from '../route'
beforeEach(() => resolve.mockReset())
it('keeps the missing-title 400 contract', async () => {
  const response = await GET(new NextRequest('https://music.test/api/resolve-stream?artist=A'))
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: 'Missing title parameter' })
  expect(resolve).not.toHaveBeenCalled()
})
it('parses query metadata and invalidation and serializes a miss', async () => {
  resolve.mockResolvedValue({ isMiss: true })
  const response = await GET(new NextRequest('https://music.test/api/resolve-stream?title=%20Song%20&artist=A&album=Album&duration=123x&invalidate=1'))
  expect(resolve).toHaveBeenCalledWith({ title: 'Song', artist: 'A', album: 'Album', duration: 123 }, { invalidate: true })
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ miss: true })
})
it.each([
  ['youtube', 'yt-id', null],
  ['soundcloud', 'sc id', '/api/soundcloud/stream?id=sc%20id'],
  ['nhaccuatui', 'nct id', '/api/nhaccuatui/stream?id=nct%20id'],
  ['drive', 'drive-id', '/api/drive-stream?fileId=drive-id'],
  ['drive', 'https://audio.test/song.mp3', 'https://audio.test/song.mp3'],
])('preserves the %s response and stream URL', async (source, id, streamUrl) => {
  const metadata = { title: 'Song', artist: 'A', duration: 123, coverUrl: null }
  resolve.mockResolvedValue({ source, resolvedId: id, ...metadata, isMiss: false, expiresAt: 1234 })
  const response = await GET(new NextRequest('https://music.test/api/resolve-stream?title=Song'))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ source, id, resolvedId: id, ...metadata, streamUrl })
})
