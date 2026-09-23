import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/nhaccuatui/stream/route'

describe('NCT Stream Proxy Abort & Signal Handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.NCT_API_BASE_URL
  })

  it('aborts upstream fetch immediately when client request is aborted', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'nct-abort-1',
        title: 'Song',
        artist: 'Artist',
        audioUrl: 'https://stream.nct.vn/song.mp3',
      }), { status: 200 }))
      .mockImplementationOnce((_url, init) => {
        return new Promise((_, reject) => {
          const signal = init?.signal
          if (signal?.aborted) {
            const err = new Error('This operation was aborted')
            err.name = 'AbortError'
            reject(err)
            return
          }
          signal?.addEventListener('abort', () => {
            const err = new Error('This operation was aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
      })

    const controller = new AbortController()
    const request = new Request('https://music.test/api/nhaccuatui/stream?id=nct-abort-1', {
      signal: controller.signal,
    })

    // Trigger abort right away
    controller.abort()

    const response = await GET(request)
    // Should return 499 (Client Closed Request) or cleanly abort without unhandled crash
    expect([499, 400, 502]).toContain(response.status)
  })

  it('cancels upstream body when client aborts during active streaming', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'

    let cancelCalled = false
    const mockBody = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(new Uint8Array([1, 2, 3]))
      },
      cancel() {
        cancelCalled = true
      },
    })

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'nct-stream-cancel',
        title: 'Song',
        artist: 'Artist',
        audioUrl: 'https://stream.nct.vn/song.mp3',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(mockBody, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      }))

    const controller = new AbortController()
    const request = new Request('https://music.test/api/nhaccuatui/stream?id=nct-stream-cancel', {
      signal: controller.signal,
    })

    const response = await GET(request)
    expect(response.status).toBe(200)

    // Simulate client aborting during playback
    controller.abort()

    // Wait a tick for event listener
    await new Promise((r) => setTimeout(r, 10))
    expect(cancelCalled).toBe(true)
  })
})
