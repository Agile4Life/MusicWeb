import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '../stream/route'
import { setNctAudioCache } from '@/lib/nctCacheStore'

describe('NCT audio transport lifecycle', () => {
  let server: Server | undefined
  afterEach(async () => {
    vi.restoreAllMocks()
    if (server) {
      server.closeAllConnections()
      await new Promise<void>((done) => server!.close(() => done()))
      server = undefined
    }
  })

  async function listen(id: string, handler: RequestListener) {
    server = createServer(handler)
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
    const { port } = server.address() as AddressInfo
    // Cache seeding isolates CDN transport from provider URL validation/search.
    setNctAudioCache(id, { audioUrl: `http://127.0.0.1:${port}/audio` })
  }

  it('streams a slow loopback body after its connection timeout has been cleared', async () => {
    const originalTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
      originalTimeout(callback, ms === 10000 ? 40 : ms, ...args)) as typeof setTimeout)
    await listen('nct-slow-loopback', (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '8' })
      response.flushHeaders()
      let count = 0
      const interval = setInterval(() => {
        response.write(Buffer.from([++count]))
        if (count === 8) { clearInterval(interval); response.end() }
      }, 15)
      response.on('close', () => clearInterval(interval))
    })
    const response = await GET(new Request('https://music.test/api/nhaccuatui/stream?id=nct-slow-loopback'))
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  })

  it('rejects a truncated real HTTP body instead of returning partial successful audio', async () => {
    await listen('nct-reset-loopback', (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': '8' })
      response.write(Buffer.from([1, 2]))
      setTimeout(() => response.destroy(), 20)
    })
    const response = await GET(new Request('https://music.test/api/nhaccuatui/stream?id=nct-reset-loopback'))
    expect(response.status).toBe(200)
    await expect(response.arrayBuffer()).rejects.toThrow()
  })

  it('cancels the upstream reader and releases abort listeners when the consumer cancels', async () => {
    const cancelled = vi.fn()
    const upstreamBody = new ReadableStream<Uint8Array>({ cancel: cancelled })
    setNctAudioCache('nct-consumer-cancel', { audioUrl: 'https://stream.nct.vn/cancel.mp3' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(upstreamBody))
    const request = new Request('https://music.test/api/nhaccuatui/stream?id=nct-consumer-cancel')
    const addListener = vi.spyOn(request.signal, 'addEventListener')
    const removeListener = vi.spyOn(request.signal, 'removeEventListener')
    const response = await GET(request)
    await response.body!.cancel()
    for (let count = 0; count < 10; count++) await Promise.resolve()
    expect(cancelled).toHaveBeenCalledOnce()
    expect(upstreamBody.locked).toBe(false)
    for (const [event, listener] of addListener.mock.calls) {
      expect(removeListener).toHaveBeenCalledWith(event, listener)
    }
  })

  it('errors downstream when the client disconnects during a pending body read', async () => {
    const cancelled = vi.fn()
    const upstreamBody = new ReadableStream<Uint8Array>({ cancel: cancelled })
    setNctAudioCache('nct-client-abort', { audioUrl: 'https://stream.nct.vn/abort.mp3' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(upstreamBody))
    const abort = new AbortController()
    const request = new Request('https://music.test/api/nhaccuatui/stream?id=nct-client-abort', { signal: abort.signal })
    const response = await GET(request)
    const reading = response.arrayBuffer()
    abort.abort(new Error('client disconnected'))
    await expect(reading).rejects.toThrow('client disconnected')
    for (let count = 0; count < 10; count++) await Promise.resolve()
    expect(cancelled).toHaveBeenCalledOnce()
    expect(upstreamBody.locked).toBe(false)
  })

  it('removes the connection abort listener if fetching headers fails', async () => {
    setNctAudioCache('nct-headers-error', { audioUrl: 'https://stream.nct.vn/error.mp3' })
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connection refused'))
    const request = new Request('https://music.test/api/nhaccuatui/stream?id=nct-headers-error')
    const addListener = vi.spyOn(request.signal, 'addEventListener')
    const removeListener = vi.spyOn(request.signal, 'removeEventListener')
    expect((await GET(request)).status).toBe(502)
    for (const [event, listener] of addListener.mock.calls) {
      expect(removeListener).toHaveBeenCalledWith(event, listener)
    }
  })
})
