import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../src/index.js'

function createMockEnv() {
  const kvStore = new Map<string, string>()
  const r2Store = new Map<string, { bytes: Uint8Array; httpMetadata?: { contentType?: string } }>()

  return {
    kvStore,
    r2Store,
    STREAM_URL_KV: {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kvStore.set(key, value)
      }),
      delete: vi.fn(async (key: string) => {
        kvStore.delete(key)
      }),
    },
    AUDIO_BUCKET: {
      head: vi.fn(async (key: string) => {
        const entry = r2Store.get(key)
        if (!entry) return null
        return {
          size: entry.bytes.byteLength,
          httpMetadata: entry.httpMetadata,
          httpEtag: '"mock-etag"',
        }
      }),
      get: vi.fn(async (key: string, opts?: { range?: { offset: number; length: number } }) => {
        const entry = r2Store.get(key)
        if (!entry) return null
        const total = entry.bytes.byteLength
        const slice = opts?.range
          ? entry.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length)
          : entry.bytes
        return {
          size: total,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(slice)
              controller.close()
            },
          }),
          httpMetadata: entry.httpMetadata,
          httpEtag: '"mock-etag"',
        }
      }),
      put: vi.fn(
        async (
          key: string,
          body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array,
          opts?: { httpMetadata?: { contentType?: string } },
        ) => {
          let bytes: Uint8Array
          if (body instanceof Uint8Array) {
            bytes = body
          } else if (body instanceof ArrayBuffer) {
            bytes = new Uint8Array(body)
          } else {
            const buf = await new Response(body).arrayBuffer()
            bytes = new Uint8Array(buf)
          }
          r2Store.set(key, { bytes, httpMetadata: opts?.httpMetadata })
        },
      ),
      delete: vi.fn(async (key: string) => {
        r2Store.delete(key)
      }),
    },
  }
}

describe('NCT Cloudflare Worker streaming & caching pipeline', () => {
  beforeEach(() => {
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('streams 206 Range request directly from origin without waiting for full download and populates R2 in background', async () => {
    const env = createMockEnv()
    const waitUntilPromises: Promise<unknown>[] = []
    const ctx = {
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromises.push(p)
      },
    }

    const fullAudio = new Uint8Array(4096)
    for (let i = 0; i < fullAudio.length; i++) fullAudio[i] = i % 256

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/song/xxkiVtQf4MX9')) {
        return Response.json({
          audioUrl: 'https://cdn.nct.vn/timeless.mp3',
        })
      }
      if (url === 'https://cdn.nct.vn/timeless.mp3') {
        const rangeHeader = new Headers(init?.headers).get('Range')
        if (rangeHeader === 'bytes=0-1023') {
          const chunk = fullAudio.slice(0, 1024)
          return new Response(chunk, {
            status: 206,
            headers: {
              'Content-Type': 'audio/mpeg',
              'Content-Length': '1024',
              'Content-Range': 'bytes 0-1023/4096',
              'Accept-Ranges': 'bytes',
            },
          })
        }
        return new Response(fullAudio, {
          status: 200,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(fullAudio.byteLength),
          },
        })
      }
      return new Response('Not found', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    // 1. Cold Range request (e.g. browser prewarm 0-1023)
    const req1 = new Request('https://worker.test/api/stream?id=xxkiVtQf4MX9', {
      headers: { Range: 'bytes=0-1023' },
    })
    const res1 = await worker.fetch(req1, env, ctx)

    expect(res1.status).toBe(206)
    expect(res1.headers.get('X-Cache')).toBe('MISS (Streaming)')
    expect(res1.headers.get('Content-Range')).toBe('bytes 0-1023/4096')
    const buf1 = await res1.arrayBuffer()
    expect(buf1.byteLength).toBe(1024)

    // Wait for background R2 population to finish
    await Promise.all(waitUntilPromises)
    expect(env.r2Store.has('songs/xxkiVtQf4MX9.mp3')).toBe(true)
    expect(env.r2Store.get('songs/xxkiVtQf4MX9.mp3')?.bytes.byteLength).toBe(4096)

    // 2. Subsequent Range request hits R2 directly without calling origin
    const fetchCountAfterWarm = fetchMock.mock.calls.length
    const req2 = new Request('https://worker.test/api/stream?id=xxkiVtQf4MX9', {
      headers: { Range: 'bytes=1024-2047' },
    })
    const res2 = await worker.fetch(req2, env, ctx)
    expect(res2.status).toBe(206)
    expect(res2.headers.get('X-Cache')).toBe('HIT (R2)')
    expect(res2.headers.get('Content-Range')).toBe('bytes 1024-2047/4096')
    const buf2 = await res2.arrayBuffer()
    expect(buf2.byteLength).toBe(1024)
    expect(fetchMock.mock.calls.length).toBe(fetchCountAfterWarm)
  })

  it('coalesces concurrent cold stream resolutions and R2 writes for the same song ID', async () => {
    const env = createMockEnv()
    const waitUntilPromises: Promise<unknown>[] = []
    const ctx = {
      waitUntil: (p: Promise<unknown>) => {
        waitUntilPromises.push(p)
      },
    }

    const fullAudio = new Uint8Array(2048)
    let songApiCalls = 0

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/api/song/coalesce-id')) {
          songApiCalls++
          await new Promise((r) => setTimeout(r, 20))
          return Response.json({
            audioUrl: 'https://cdn.nct.vn/coalesce.mp3',
          })
        }
        return new Response(fullAudio, {
          status: 200,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(fullAudio.byteLength),
          },
        })
      }),
    )

    const [resA, resB] = await Promise.all([
      worker.fetch(new Request('https://worker.test/api/stream?id=coalesce-id'), env, ctx),
      worker.fetch(new Request('https://worker.test/api/stream?id=coalesce-id'), env, ctx),
    ])

    expect(resA.status).toBe(200)
    expect(resB.status).toBe(200)
    expect(songApiCalls).toBe(1)

    await Promise.all(waitUntilPromises)
    expect(env.AUDIO_BUCKET.put).toHaveBeenCalledTimes(1)
  })
})

