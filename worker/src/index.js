/**
 * MusicStream Cache Worker
 *
 * GET  /api/stream?id=<songId>  -> full or Range-sliced audio (200 / 206 / 416)
 * HEAD /api/stream?id=<songId>  -> headers only + background R2 prewarm
 *
 * 3-tier cache:
 *   T1  Cache API        https://cache.internal/audio/<songId>   (full body, short-lived)
 *   T2  R2               songs/<songId>.mp3                      (permanent full file, native range reads)
 *   T3  Origin           NCT API -> fallback matching service (YouTube)
 *
 * Performance & Concurrency Guarantees:
 * - Never buffers full MP3 into ArrayBuffer before returning byte 0.
 * - Range requests on cold cache forward Range to origin for ~120ms TTFB while
 *   populating the full file into R2 asynchronously via ctx.waitUntil.
 * - Full requests on cold cache tee the ReadableStream to the client and R2 simultaneously.
 * - Coalesces concurrent URL resolutions (inFlightResolves) and R2 writes (inFlightR2Writes)
 *   for the same songId to prevent stampedes when multiple requests arrive on a cold cache.
 */

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'
const ORIGIN_TIMEOUT_MS = 10000
const POPULATE_R2_TIMEOUT_MS = 30000
const FULL_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days
const STREAM_URL_KV_TTL_SECONDS = 6 * 60 * 60 // ~6h, mirrors signed NCT URL window
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const AUDIO_ACCEPT = 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Accept-Ranges',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag, X-Cache',
}

// Isolate-level in-flight deduplication maps
const inFlightResolves = new Map()
const inFlightR2Writes = new Map()

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const { pathname, searchParams } = url
    const method = request.method

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    if (pathname === '/api/stream' || pathname === '/api/stream/') {
      const id = (searchParams.get('id') || '').trim()
      if (!id) return json({ error: 'Missing song id' }, 400)
      return method === 'HEAD' ? handleHead(id, env, ctx) : handleStream(id, request, env, ctx)
    }

    if (pathname === '/health' || pathname === '/') {
      return json({ ok: true, worker: 'music-stream-cache' })
    }

    return json({ error: 'Not found' }, 404)
  },
}

// ---------------------------------------------------------------- main GET flow

async function handleStream(id, request, env, ctx) {
  const cacheKey = `https://cache.internal/audio/${encodeURIComponent(id)}`
  const r2Key = `songs/${id}.mp3`
  const kvKey = `stream:${id}`
  const rangeHeader = request.headers.get('range')

  // Validate malformed / inverted Range early
  if (rangeHeader) {
    const m = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader.trim())
    if (m && Number(m[1]) > Number(m[2])) {
      return rangeNotSatisfiable('*')
    }
  }

  // ---- T1: Cache API (full-file requests only; skip for Range to avoid ArrayBuffer buffering) ----
  if (!rangeHeader) {
    try {
      const cached = await caches.default.match(cacheKey)
      if (cached && cached.ok && cached.body) {
        return cloneWithCors(cached, 'HIT (Edge)')
      }
    } catch {
      /* cache read error -> fall through to R2 */
    }
  }

  // ---- T2: R2 (permanent full file, native range reads without buffering whole file) ----
  if (env.AUDIO_BUCKET) {
    try {
      const meta = await env.AUDIO_BUCKET.head(r2Key)
      if (meta && meta.size > 0) {
        const total = meta.size
        const range = parseRange(rangeHeader, total)
        if (range && range.unsatisfiable) return rangeNotSatisfiable(total)

        const part =
          range && !range.invalid
            ? await env.AUDIO_BUCKET.get(r2Key, {
                range: { offset: range.start, length: range.end - range.start + 1 },
              })
            : await env.AUDIO_BUCKET.get(r2Key)
        if (part && part.body && !part.body.locked) {
          const contentType = meta.httpMetadata?.contentType || 'audio/mpeg'
          const resp = serveR2(
            part,
            total,
            range && !range.invalid ? range : null,
            contentType,
            meta.httpEtag,
          )
          if (!rangeHeader && ctx?.waitUntil) {
            ctx.waitUntil(caches.default.put(cacheKey, resp.clone()).catch(() => {}))
          }
          return resp
        }
      } else if (meta && meta.size === 0) {
        if (ctx?.waitUntil) {
          ctx.waitUntil(env.AUDIO_BUCKET.delete(r2Key).catch(() => {}))
        }
      }
    } catch {
      /* R2 read error -> fall through to origin */
    }
  }

  // ---- T3: Origin — forward Range for instant first byte + background R2 population ----
  let resolved = await resolveStreamUrl(id, env, false)
  let origin = resolved ? await fetchOriginStream(resolved.url, rangeHeader) : null

  // Signed URL in KV may have expired upstream — drop it and re-resolve once
  if ((!origin || (!origin.ok && origin.status !== 416)) && resolved && resolved.source === 'kv') {
    if (origin?.body) await origin.body.cancel().catch(() => {})
    if (env.STREAM_URL_KV) {
      await env.STREAM_URL_KV.delete(kvKey).catch(() => {})
    }
    resolved = await resolveStreamUrl(id, env, true)
    origin = resolved ? await fetchOriginStream(resolved.url, rangeHeader) : null
  }

  if (!origin) {
    return json({ error: 'Song stream unavailable' }, 502)
  }

  if (origin.status === 416) {
    const cr = origin.headers.get('content-range') || 'bytes */*'
    if (origin.body) await origin.body.cancel().catch(() => {})
    return new Response(null, {
      status: 416,
      headers: { ...CORS, 'Content-Range': cr },
    })
  }

  if (!origin.ok || !origin.body) {
    if (origin.body) await origin.body.cancel().catch(() => {})
    return json({ error: 'Song stream unavailable' }, 502)
  }

  const contentType = origin.headers.get('content-type') || 'audio/mpeg'
  const originContentRange = origin.headers.get('content-range')
  const originContentLength = origin.headers.get('content-length')

  // Check if this response is the complete file (200 OK or 206 bytes 0-(total-1)/total)
  let isFullFile = origin.status === 200 && !originContentRange
  if (originContentRange) {
    const match = originContentRange.match(/^bytes\s+0-(\d+)\/(\d+)$/i)
    if (match) {
      const end = Number(match[1])
      const total = Number(match[2])
      if (Number.isFinite(end) && Number.isFinite(total) && total > 0 && end === total - 1) {
        isFullFile = true
      }
    }
  }

  // Only persist genuine NCT audio into permanent R2/Edge cache (never overwrite R2 with transient fallback)
  const canPersist = resolved.source !== 'matching'

  if (isFullFile && canPersist && !inFlightR2Writes.has(id) && origin.body.tee) {
    const [clientBody, cacheBody] = origin.body.tee()

    if (ctx?.waitUntil) {
      ctx.waitUntil(
        storeStreamInR2(id, cacheBody, contentType, originContentLength, r2Key, cacheKey, env),
      )
    }

    const headers = new Headers(CORS)
    headers.set('Content-Type', contentType)
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Cache-Control', `public, max-age=${FULL_CACHE_TTL_SECONDS}, immutable`)
    headers.set('X-Cache', 'MISS (Streaming)')
    if (originContentLength) headers.set('Content-Length', originContentLength)
    if (originContentRange) headers.set('Content-Range', originContentRange)

    return new Response(clientBody, { status: origin.status, headers })
  }

  // Partial slice (e.g. Range: bytes=0-1023 or seek): stream immediately & populate R2 in background
  if (canPersist && !inFlightR2Writes.has(id) && ctx?.waitUntil) {
    ctx.waitUntil(populateR2(id, resolved.url, contentType, r2Key, cacheKey, env))
  }

  const headers = new Headers(CORS)
  headers.set('Content-Type', contentType)
  headers.set('Accept-Ranges', 'bytes')
  headers.set(
    'Cache-Control',
    canPersist ? `public, max-age=${FULL_CACHE_TTL_SECONDS}, immutable` : 'no-store',
  )
  headers.set('X-Cache', 'MISS (Streaming)')
  if (originContentLength) headers.set('Content-Length', originContentLength)
  if (originContentRange) headers.set('Content-Range', originContentRange)

  return new Response(origin.body, { status: origin.status, headers })
}

// ---------------------------------------------------------------- HEAD flow

async function handleHead(id, env, ctx) {
  const cacheKey = `https://cache.internal/audio/${encodeURIComponent(id)}`
  const r2Key = `songs/${id}.mp3`

  try {
    const cached = await caches.default.match(cacheKey)
    if (cached && cached.ok) {
      return headerOnly(
        parseInt(cached.headers.get('content-length') || '0', 10),
        cached.headers.get('content-type'),
      )
    }
  } catch {
    /* ignore */
  }

  if (env.AUDIO_BUCKET) {
    try {
      const meta = await env.AUDIO_BUCKET.head(r2Key)
      if (meta && meta.size > 0) {
        return headerOnly(meta.size, meta.httpMetadata?.contentType, meta.httpEtag)
      }
    } catch {
      /* ignore */
    }
  }

  const resolved = await resolveStreamUrl(id, env, false)
  if (!resolved) return json({ error: 'Song stream unavailable' }, 502)

  // Trigger background R2 prewarm so the subsequent GET is served from R2 in <100ms
  if (resolved.source !== 'matching' && ctx?.waitUntil) {
    ctx.waitUntil(populateR2(id, resolved.url, 'audio/mpeg', r2Key, cacheKey, env))
  }

  try {
    const upstream = await fetch(resolved.url, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT, Accept: AUDIO_ACCEPT },
      cache: 'no-store',
      signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
    })
    if (!upstream.ok) return json({ error: 'Song stream unavailable' }, 502)
    return headerOnly(
      parseInt(upstream.headers.get('content-length') || '0', 10),
      upstream.headers.get('content-type'),
    )
  } catch {
    return json({ error: 'Song stream unavailable' }, 502)
  }
}

// ---------------------------------------------------------------- URL resolution (coalesced)

/**
 * Tier-3 resolution order: KV (recent signed URL) -> NCT API -> matching service.
 * Coalesces concurrent resolutions for the same song ID within the isolate.
 */
async function resolveStreamUrl(id, env, forceRefresh = false) {
  const kvKey = `stream:${id}`

  if (!forceRefresh) {
    if (env.STREAM_URL_KV) {
      try {
        const cachedUrl = await env.STREAM_URL_KV.get(kvKey)
        if (cachedUrl) return { url: cachedUrl, source: 'kv' }
      } catch {
        /* KV read error -> resolve from upstream */
      }
    }

    const existing = inFlightResolves.get(id)
    if (existing) return existing
  }

  const promise = (async () => {
    try {
      // 1) NCT API (mirrors app/api/nhaccuatui/stream/route.ts)
      try {
        const nctUrl = new URL(env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
        nctUrl.pathname = `/api/song/${encodeURIComponent(id)}`
        nctUrl.search = ''

        const res = await fetch(nctUrl, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
        })
        if (res.ok) {
          const audioUrl = readNctAudioUrl(await res.json())
          if (audioUrl) {
            if (env.STREAM_URL_KV) {
              await env.STREAM_URL_KV.put(kvKey, audioUrl, {
                expirationTtl: STREAM_URL_KV_TTL_SECONDS,
              }).catch(() => {})
            }
            return { url: audioUrl, source: 'nct' }
          }
        }
      } catch {
        /* fall through */
      }

      // 2) Matching service fallback (YouTube) — optional via MATCHING_SERVICE_URL
      // Note: Do NOT permanently cache fallback URLs in KV/R2 under the NCT song key.
      if (env.MATCHING_SERVICE_URL) {
        try {
          const sep = env.MATCHING_SERVICE_URL.includes('?') ? '&' : '?'
          const res = await fetch(`${env.MATCHING_SERVICE_URL}${sep}id=${encodeURIComponent(id)}`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
          })
          if (res.ok) {
            const data = await res.json()
            const url =
              typeof data === 'string'
                ? data
                : data && typeof data.url === 'string'
                  ? data.url
                  : null
            if (url && /^https:\/\//.test(url)) {
              return { url, source: 'matching' }
            }
          }
        } catch {
          /* fall through */
        }
      }

      return null
    } finally {
      if (inFlightResolves.get(id) === promise) {
        inFlightResolves.delete(id)
      }
    }
  })()

  inFlightResolves.set(id, promise)
  return promise
}

// Mirrors normalizeNhacCuaTuiSongResponse: accepts {song:{...}} or flat payload,
// only trusts https URLs on nct.vn (incl. subdomains like stream.nct.vn, a01.nct.vn)
function readNctAudioUrl(payload) {
  if (!payload || typeof payload !== 'object') return null
  const root = payload
  const item = root.song && typeof root.song === 'object' ? root.song : root
  const raw = item.audioUrl || item.audio_url || item.streamUrl || item.stream_url
  if (typeof raw !== 'string') return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || (u.hostname !== 'nct.vn' && !u.hostname.endsWith('.nct.vn')))
      return null
    return u.href
  } catch {
    return null
  }
}

async function fetchOriginStream(streamUrl, rangeHeader) {
  try {
    const headers = { 'User-Agent': USER_AGENT, Accept: AUDIO_ACCEPT }
    if (rangeHeader) headers['Range'] = rangeHeader
    const res = await fetch(streamUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
    })
    return res
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- background R2 population (coalesced)

async function storeStreamInR2(id, bodyStream, contentType, contentLength, r2Key, cacheKey, env) {
  if (!env.AUDIO_BUCKET) return
  if (inFlightR2Writes.has(id)) {
    try {
      await bodyStream.cancel().catch(() => {})
    } catch {}
    return inFlightR2Writes.get(id)
  }

  const writePromise = (async () => {
    try {
      const existing = await env.AUDIO_BUCKET.head(r2Key)
      if (existing && existing.size > 0) {
        await bodyStream.cancel().catch(() => {})
        return
      }
      await env.AUDIO_BUCKET.put(r2Key, bodyStream, {
        httpMetadata: { contentType: contentType || 'audio/mpeg' },
      })
    } catch {
      await env.AUDIO_BUCKET.delete(r2Key).catch(() => {})
    } finally {
      inFlightR2Writes.delete(id)
    }
  })()

  inFlightR2Writes.set(id, writePromise)
  return writePromise
}

async function populateR2(id, streamUrl, contentType, r2Key, cacheKey, env) {
  if (!env.AUDIO_BUCKET) return
  if (inFlightR2Writes.has(id)) {
    return inFlightR2Writes.get(id)
  }

  const writePromise = (async () => {
    try {
      const existing = await env.AUDIO_BUCKET.head(r2Key)
      if (existing && existing.size > 0) return

      const res = await fetch(streamUrl, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: AUDIO_ACCEPT },
        cache: 'no-store',
        signal: AbortSignal.timeout(POPULATE_R2_TIMEOUT_MS),
      })
      if (!res.ok || !res.body) return

      const resolvedType = res.headers.get('content-type') || contentType || 'audio/mpeg'
      await env.AUDIO_BUCKET.put(r2Key, res.body, {
        httpMetadata: { contentType: resolvedType },
      })
    } catch {
      await env.AUDIO_BUCKET.delete(r2Key).catch(() => {})
    } finally {
      inFlightR2Writes.delete(id)
    }
  })()

  inFlightR2Writes.set(id, writePromise)
  return writePromise
}

// ---------------------------------------------------------------- response builders

function serveR2(part, total, range, contentType, etag) {
  const headers = baseHeaders(
    contentType,
    range ? range.end - range.start + 1 : total,
    etag || part.httpEtag,
  )
  headers.set('X-Cache', 'HIT (R2)')
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${total}`)
    return new Response(part.body, { status: 206, headers })
  }
  return new Response(part.body, { status: 200, headers })
}

function cloneWithCors(response, cacheStatus) {
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  if (cacheStatus) headers.set('X-Cache', cacheStatus)
  return new Response(response.body, { status: response.status, headers })
}

function headerOnly(total, contentType, etag) {
  return new Response(null, { status: 200, headers: baseHeaders(contentType, total, etag) })
}

function rangeNotSatisfiable(total) {
  return new Response(null, {
    status: 416,
    headers: { ...CORS, 'Content-Range': `bytes */${total}` },
  })
}

function baseHeaders(contentType, length, etag) {
  const headers = new Headers(CORS)
  headers.set('Content-Type', contentType || 'audio/mpeg')
  headers.set('Content-Length', String(length))
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', `public, max-age=${FULL_CACHE_TTL_SECONDS}, immutable`)
  if (etag) headers.set('ETag', etag)
  return headers
}

// ---------------------------------------------------------------- helpers

/** Parse "bytes=start-end | start- | -suffix" -> { start, end } | { invalid } | { unsatisfiable } */
function parseRange(header, size) {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return { invalid: true }

  let start, end
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true }
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(m[1])
    if (!Number.isFinite(start) || start < 0) return { invalid: true }
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }

  if (start >= size || start > end) return { unsatisfiable: true }
  return { start, end }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  })
}
