import { describe, it, expect, vi, beforeEach } from 'vitest'
import worker from '../src/index.js'

describe('music-drive-stream-cache Cloudflare Worker', () => {
  let mockR2Store: Map<string, { data: Uint8Array; meta: any }>
  let env: any
  let ctx: any
  let backgroundTasks: Promise<any>[]

  beforeEach(() => {
    mockR2Store = new Map()
    backgroundTasks = []

    ctx = {
      waitUntil: vi.fn((promise: Promise<any>) => {
        backgroundTasks.push(promise)
      }),
    }

    env = {
      APP_RESOLVE_ORIGIN_URL: 'https://test-app.internal/api/drive-resolve-origin',
      INTERNAL_RESOLVE_SECRET: 'test_secret',
      AUDIO_BUCKET: {
        head: vi.fn(async (key: string) => {
          const item = mockR2Store.get(key)
          if (!item) return null
          return {
            size: item.data.byteLength,
            httpMetadata: item.meta?.httpMetadata || { contentType: 'audio/mpeg' },
            httpEtag: '"mock-etag"',
          }
        }),
        get: vi.fn(async (key: string, options?: { range?: { offset?: number; length?: number } }) => {
          const item = mockR2Store.get(key)
          if (!item) return null

          let slice = item.data
          if (options?.range) {
            const offset = options.range.offset || 0
            const length = options.range.length ?? (item.data.byteLength - offset)
            slice = item.data.subarray(offset, offset + length)
          }

          return {
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(slice)
                controller.close()
              },
            }),
            httpEtag: '"mock-etag"',
          }
        }),
        put: vi.fn(async (key: string, streamOrBuffer: any, options?: any) => {
          let uint8: Uint8Array
          if (streamOrBuffer instanceof ReadableStream) {
            const reader = streamOrBuffer.getReader()
            const chunks: Uint8Array[] = []
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) chunks.push(value)
            }
            const totalLen = chunks.reduce((acc, c) => acc + c.byteLength, 0)
            uint8 = new Uint8Array(totalLen)
            let offset = 0
            for (const chunk of chunks) {
              uint8.set(chunk, offset)
              offset += chunk.byteLength
            }
          } else if (streamOrBuffer instanceof Uint8Array) {
            uint8 = streamOrBuffer
          } else {
            uint8 = new Uint8Array(0)
          }

          mockR2Store.set(key, { data: uint8, meta: options })
          return { key, size: uint8.byteLength }
        }),
        delete: vi.fn(async (key: string) => {
          mockR2Store.delete(key)
        }),
      },
    }

    // Mock global caches
    ;(globalThis as any).caches = {
      default: {
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      },
    }
  })

  it('handles OPTIONS CORS preflight', async () => {
    const req = new Request('https://worker.internal/api/drive-stream?id=file123', {
      method: 'OPTIONS',
    })
    const res = await worker.fetch(req, env, ctx)
    expect(res.status).toBe(204)
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('returns 400 when fileId is missing', async () => {
    const req = new Request('https://worker.internal/api/drive-stream', {
      method: 'GET',
    })
    const res = await worker.fetch(req, env, ctx)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Missing fileId')
  })

  it('detects Range: bytes=0- as isFullFile, streams to client and writes to R2 via stream-tee', async () => {
    const testFileBytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80])
    const totalSize = testFileBytes.byteLength

    // Mock origin resolution & origin fetch
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/drive-resolve-origin')) {
        return new Response(JSON.stringify({ url: 'https://drive.google.internal/download/file123', contentType: 'audio/flac' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('drive.google.internal/download')) {
        // Trình duyệt gửi bytes=0- -> Google Drive trả về 206 bytes 0-(total-1)/total
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(testFileBytes)
              controller.close()
            },
          }),
          {
            status: 206,
            headers: {
              'Content-Type': 'audio/flac',
              'Content-Range': `bytes 0-${totalSize - 1}/${totalSize}`,
              'Content-Length': String(totalSize),
            },
          }
        )
      }
      return new Response(null, { status: 404 })
    })

    vi.stubGlobal('fetch', fetchMock)

    const req = new Request('https://worker.internal/api/drive-stream?id=test-file-01&filename=song.flac', {
      method: 'GET',
      headers: {
        Range: 'bytes=0-',
      },
    })

    const res = await worker.fetch(req, env, ctx)

    // Verify response to browser
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe(`bytes 0-${totalSize - 1}/${totalSize}`)
    expect(res.headers.get('Content-Type')).toBe('audio/flac')

    const responseBytes = new Uint8Array(await res.arrayBuffer())
    expect(responseBytes).toEqual(testFileBytes)

    // Wait for ctx.waitUntil background tasks to complete
    await Promise.all(backgroundTasks)

    // Verify that R2 put was CALLED and saved the complete file
    expect(env.AUDIO_BUCKET.put).toHaveBeenCalledWith(
      'drive-songs/test-file-01',
      expect.anything(),
      expect.objectContaining({ httpMetadata: { contentType: 'audio/flac' } })
    )
    expect(mockR2Store.has('drive-songs/test-file-01')).toBe(true)
    expect(mockR2Store.get('drive-songs/test-file-01')?.data).toEqual(testFileBytes)
  })

  it('serves subsequent Range requests directly from R2 without touching origin', async () => {
    // Populate R2 store with cached track
    const fullAudio = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    mockR2Store.set('drive-songs/cached-track', {
      data: fullAudio,
      meta: { httpMetadata: { contentType: 'audio/mpeg' } },
    })

    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    // Browser requests slice 2 to 5
    const req = new Request('https://worker.internal/api/drive-stream?id=cached-track', {
      method: 'GET',
      headers: {
        Range: 'bytes=2-5',
      },
    })

    const res = await worker.fetch(req, env, ctx)

    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 2-5/10')
    expect(res.headers.get('Content-Length')).toBe('4')
    expect(res.headers.get('ETag')).toBe('"mock-etag"')

    const chunk = new Uint8Array(await res.arrayBuffer())
    expect(chunk).toEqual(new Uint8Array([2, 3, 4, 5]))

    // Origin should NEVER be contacted
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('handles HEAD request and returns metadata from R2 when cached', async () => {
    const fullAudio = new Uint8Array(1024)
    mockR2Store.set('drive-songs/cached-head-track', {
      data: fullAudio,
      meta: { httpMetadata: { contentType: 'audio/flac' } },
    })

    const req = new Request('https://worker.internal/api/drive-stream?id=cached-head-track', {
      method: 'HEAD',
    })

    const res = await worker.fetch(req, env, ctx)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe('1024')
    expect(res.headers.get('Content-Type')).toBe('audio/flac')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
  })

  it('cleans up 0-byte corrupt entries in R2', async () => {
    mockR2Store.set('drive-songs/corrupted-track', {
      data: new Uint8Array(0),
      meta: { httpMetadata: { contentType: 'audio/mpeg' } },
    })

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/drive-resolve-origin')) {
        return new Response(null, { status: 404 })
      }
      return new Response(null, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const req = new Request('https://worker.internal/api/drive-stream?id=corrupted-track', {
      method: 'GET',
    })

    await worker.fetch(req, env, ctx)

    expect(env.AUDIO_BUCKET.delete).toHaveBeenCalledWith('drive-songs/corrupted-track')
  })
})
