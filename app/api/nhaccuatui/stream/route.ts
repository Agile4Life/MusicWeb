import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSongResponse } from '@/lib/nhaccuatui'
import { fetchWithRetry, isNetworkError, isTransientError } from '@/lib/fetchWithRetry'

export const dynamic = 'force-dynamic'
// Maximum execution time per invocation.
// NCT stream resolution + CDN pipe should not exceed 60s.
export const maxDuration = 60

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

function getNctSongUrl(id: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = `/api/song/${encodeURIComponent(id)}`
  url.search = ''
  return url
}

import {
  getNctAudioCache,
  setNctAudioCache,
  deleteNctAudioCache,
  getNctInFlight,
  setNctInFlight,
  deleteNctInFlight,
} from '@/lib/nctCacheStore'

async function resolveNctAudioUrlCached(id: string): Promise<string | null> {
  const trimmed = id.trim()
  if (!trimmed) return null

  const cached = getNctAudioCache(trimmed)
  if (cached && cached.audioUrl) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[NCT:Stream] Cache HIT for id: ${trimmed}`)
    }
    return cached.audioUrl
  }

  const existingInFlight = getNctInFlight(trimmed)
  if (existingInFlight) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[NCT:Stream] Coalescing in-flight request for id: ${trimmed}`)
    }
    const res = await existingInFlight
    return res?.audioUrl ?? null
  }

  const promise = (async (): Promise<string | null> => {
    try {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[NCT:Stream] Cache MISS for id: ${trimmed} — fetching upstream NCT API`)
      }
      // Retry once with quick backoff to fail-fast if external NCT upstream is cold/unresponsive
      const songRes = await fetchWithRetry(
        () =>
          fetch(getNctSongUrl(trimmed), {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(3800),
          }),
        {
          retries: 1,
          baseDelayMs: 150,
          maxDelayMs: 400,
          retryOn: (outcome) =>
            outcome instanceof Response ? isTransientError(outcome) : isNetworkError(outcome),
        }
      )
      if (!songRes.ok) {
        // Distinguish permanent 404 (song deleted) from transient errors:
        // Store a sentinel value so the route handler can return 404 instead of 502
        if (songRes.status === 404) {
          return '__NCT_NOT_FOUND__'
        }
        return null
      }

      const payload: unknown = await songRes.json()
      const song = normalizeNhacCuaTuiSongResponse(payload)
      if (!song || !song.audioUrl) return null

      setNctAudioCache(trimmed, {
        audioUrl: song.audioUrl,
        title: song.title,
        artist: song.artist,
        duration: song.duration ?? null,
        coverUrl: song.coverUrl || null,
      })
      return song.audioUrl
    } catch {
      return null
    } finally {
      deleteNctInFlight(trimmed)
    }
  })()

  // Track in-flight resolution in shared store
  const cacheInFlightPromise = promise.then((audioUrl) =>
    audioUrl && audioUrl !== '__NCT_NOT_FOUND__'
      ? {
          audioUrl,
          expiresAt: Date.now() + 10 * 60 * 1000,
        }
      : null
  )
  setNctInFlight(trimmed, cacheInFlightPromise)
  return promise
}

function applyCorsHeaders(headers: Headers) {
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type')
  headers.set('Accept-Ranges', 'bytes')
}

export async function OPTIONS() {
  const headers = new Headers()
  applyCorsHeaders(headers)
  return new Response(null, { status: 204, headers })
}

function createCompositeSignal(clientSignal?: AbortSignal, timeoutMs = 8000): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  if (!clientSignal) return timeoutSignal
  if (clientSignal.aborted) return clientSignal
  return AbortSignal.any([clientSignal, timeoutSignal])
}

export async function HEAD(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const id = url.searchParams.get('id') || url.searchParams.get('key')
  if (!id?.trim()) {
    return new Response(null, { status: 400 })
  }

  if (request.signal?.aborted) {
    return new Response(null, { status: 499 })
  }

  try {
    let audioUrl = await resolveNctAudioUrlCached(id.trim())
    if (audioUrl === '__NCT_NOT_FOUND__') return new Response(null, { status: 404 })
    if (!audioUrl) return new Response(null, { status: 502 })

    const signal = createCompositeSignal(request.signal, 4000)
    let upstream = await fetch(audioUrl, {
      method: 'HEAD',
      cache: 'no-store',
      signal,
    })

    // Cached URL may have expired upstream — re-resolve once before giving up
    if (!upstream.ok) {
      deleteNctAudioCache(id.trim())
      audioUrl = await resolveNctAudioUrlCached(id.trim())
      if (audioUrl === '__NCT_NOT_FOUND__') return new Response(null, { status: 404 })
      if (!audioUrl) return new Response(null, { status: 502 })
      upstream = await fetch(audioUrl, {
        method: 'HEAD',
        cache: 'no-store',
        signal: createCompositeSignal(request.signal, 4000),
      })
    }

    const headers = new Headers()
    headers.set('Cache-Control', 'private, no-store')
    applyCorsHeaders(headers)

    const contentType = upstream.headers.get('content-type') || 'audio/mpeg'
    headers.set('Content-Type', contentType)

    const contentLength = upstream.headers.get('content-length')
    if (contentLength) headers.set('Content-Length', contentLength)

    return new Response(null, { status: upstream.status, headers })
  } catch (err: unknown) {
    if (request.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return new Response(null, { status: 499 })
    }
    return new Response(null, { status: 502 })
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const id = url.searchParams.get('id') || url.searchParams.get('key')
  if (!id?.trim()) {
    return NextResponse.json({ error: 'Missing song id' }, { status: 400 })
  }

  if (request.signal?.aborted) {
    return new Response(null, { status: 499 })
  }

  let releaseConnection: (() => void) | undefined
  let bodyOwnsConnection = false
  try {
    let audioUrl = await resolveNctAudioUrlCached(id.trim())
    if (audioUrl === '__NCT_NOT_FOUND__') {
      return NextResponse.json({ error: 'Song not found on NhacCuaTui' }, { status: 404 })
    }
    if (!audioUrl) {
      return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
    }

    const upstreamHeaders = new Headers({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8',
    })
    const range = request.headers.get('range')
    if (range) {
      const match = range.match(/^bytes=(\d+)-(\d+)$/)
      if (match && parseInt(match[1], 10) > parseInt(match[2], 10)) {
        return new Response(null, {
          status: 416,
          headers: {
            'Content-Range': 'bytes */*',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }
      upstreamHeaders.set('Range', range)
    }

    const connectController = new AbortController()
    const connectTimer = setTimeout(() => connectController.abort(new Error('Connection timeout')), 10000)
    const onAbort = () => {
      try { connectController.abort(request.signal?.reason) } catch {}
    }
    if (request.signal) {
      request.signal.addEventListener('abort', onAbort, { once: true })
    }
    releaseConnection = () => request.signal?.removeEventListener('abort', onAbort)
    // The client may have cancelled during URL resolution, before listener setup.
    if (request.signal?.aborted) onAbort()

    let upstream: Response
    try {
      upstream = await fetch(audioUrl, {
        method: 'GET',
        headers: upstreamHeaders,
        cache: 'no-store',
        signal: connectController.signal,
      })
    } finally {
      clearTimeout(connectTimer)
    }

    // Cached URL may have expired upstream — re-resolve once before giving up
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {})
      deleteNctAudioCache(id.trim())
      audioUrl = await resolveNctAudioUrlCached(id.trim())
      if (audioUrl === '__NCT_NOT_FOUND__') {
        return NextResponse.json({ error: 'Song not found on NhacCuaTui' }, { status: 404 })
      }
      if (!audioUrl) {
        return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
      }
      const retryTimer = setTimeout(() => connectController.abort(new Error('Connection timeout')), 10000)
      try {
        upstream = await fetch(audioUrl, {
          method: 'GET',
          headers: upstreamHeaders,
          cache: 'no-store',
          signal: connectController.signal,
        })
      } finally {
        clearTimeout(retryTimer)
      }
    }

    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {})
      return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
    }

    if (request.signal?.aborted) {
      try { upstream.body?.cancel().catch(() => {}) } catch {}
      return new Response(null, { status: 499 })
    }

    const headers = new Headers()
    headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=600')
    applyCorsHeaders(headers)

    const contentType = upstream.headers.get('content-type')
    if (contentType) headers.set('Content-Type', contentType)

    const contentLength = upstream.headers.get('content-length')
    if (contentLength) headers.set('Content-Length', contentLength)

    const contentRange = upstream.headers.get('content-range')
    if (contentRange) headers.set('Content-Range', contentRange)

    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
    let downstreamController: ReadableStreamDefaultController<Uint8Array> | undefined

    const cancelUpstream = async () => {
      try {
        if (activeReader) {
          await activeReader.cancel().catch(() => {})
        } else {
          await upstream.body?.cancel().catch(() => {})
        }
      } catch {}
    }

    const onBodyAbort = () => {
      try { downstreamController?.error(request.signal.reason || new DOMException('Aborted', 'AbortError')) } catch {}
      void cancelUpstream()
    }
    const releaseBody = () => {
      request.signal?.removeEventListener('abort', onBodyAbort)
      releaseConnection?.()
    }
    request.signal?.addEventListener('abort', onBodyAbort, { once: true })

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        downstreamController = controller
        if (!upstream.body) {
          controller.close()
          releaseBody()
          return
        }
        const reader = upstream.body.getReader()
        activeReader = reader
        try {
          while (true) {
            if (request.signal?.aborted) {
              throw request.signal.reason || new DOMException('Aborted', 'AbortError')
            }
            const { done, value } = await reader.read()
            if (done) {
              controller.close()
              break
            }
            controller.enqueue(value)
          }
        } catch (error) {
          // A broken CDN connection must remain an error downstream. Closing
          // normally makes partial audio look like a successful cached response.
          try { controller.error(error) } catch {}
          try { await reader.cancel().catch(() => {}) } catch {}
        } finally {
          reader.releaseLock()
          activeReader = null
          releaseBody()
        }
      },
      cancel() {
        releaseBody()
        void cancelUpstream()
      },
    })

    bodyOwnsConnection = true
    return new Response(stream, {
      status: upstream.status,
      headers,
    })
  } catch (err: unknown) {
    if (request.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      return new Response(null, { status: 499 })
    }
    return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
  } finally {
    if (!bodyOwnsConnection) releaseConnection?.()
  }
}
