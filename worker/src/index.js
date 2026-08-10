/**
 * MusicStream Cache Worker
 *
 * GET  /api/stream?id=<songId>  -> full or Range-sliced audio (200 / 206 / 416)
 * HEAD /api/stream?id=<songId>  -> headers only (same cache lookup)
 *
 * 3-tier cache:
 *   T1  Cache API        https://cache.internal/audio/<songId>   (full body, short-lived)
 *   T2  R2                songs/<songId>.mp3                      (permanent full file)
 *   T3  Origin            NCT API -> fallback matching service (YouTube)
 *
 * The origin is ALWAYS fetched as a FULL file (Range is never forwarded upstream),
 * so R2 always holds a complete, reusable copy. Range requests are satisfied
 * from the stored copy at the edge (Worker-side slicing / R2 native range reads).
 */

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'
const ORIGIN_TIMEOUT_MS = 8000
const FULL_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7 // 7 days
const STREAM_URL_KV_TTL_SECONDS = 6 * 60 * 60 // ~6h, mirrors signed NCT URL window
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const AUDIO_ACCEPT = 'audio/mpeg,audio/*;q=0.9,*/*;q=0.8'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
}

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
      return method === 'HEAD' ? handleHead(id, env) : handleStream(id, request, env, ctx)
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

  // ---- T1: Cache API (full body) ----
  try {
    const cached = await caches.default.match(cacheKey)
    if (cached && cached.ok) {
      const bytes = await cached.arrayBuffer()
      return sliceAndServe(bytes, parseRange(rangeHeader, bytes.byteLength), cached.headers.get('content-type'))
    }
  } catch {
    /* cache read error -> fall through to R2 */
  }

  // ---- T2: R2 (permanent full file, native range reads) ----
  try {
    const meta = await env.AUDIO_BUCKET.head(r2Key)
    if (meta) {
      const total = meta.size
      const range = parseRange(rangeHeader, total)
      if (range && range.unsatisfiable) return rangeNotSatisfiable(total)

      const part = range && !range.invalid
        ? await env.AUDIO_BUCKET.get(r2Key, { range: { offset: range.start, length: range.end - range.start + 1 } })
        : await env.AUDIO_BUCKET.get(r2Key)
      if (part) {
        return serveR2(part, total, range && !range.invalid ? range : null, meta.httpMetadata?.contentType)
      }
    }
  } catch {
    /* R2 read error -> fall through to origin */
  }

  // ---- T3: Origin — full fetch (no Range forwarded), persist, slice locally ----
  let resolved = await resolveStreamUrl(id, env)
  let origin = resolved ? await fetchFullOrigin(resolved.url, env) : null

  // Signed URL may have expired upstream — drop it and re-resolve once
  if (!origin && resolved && resolved.source === 'kv') {
    await env.STREAM_URL_KV.delete(kvKey).catch(() => {})
    resolved = await resolveStreamUrl(id, env)
    origin = resolved ? await fetchFullOrigin(resolved.url, env) : null
  }

  if (!origin) {
    return json({ error: 'Song stream unavailable' }, 502)
  }

  const contentType = origin.headers.get('content-type') || 'audio/mpeg'
  const bytes = await origin.arrayBuffer()
  const total = bytes.byteLength

  // Persist the FULL file in the background; respond immediately with the slice
  ctx.waitUntil(populateCaches(env, ctx, r2Key, cacheKey, bytes, contentType))

  const range = parseRange(rangeHeader, total)
  if (range && range.unsatisfiable) return rangeNotSatisfiable(total)
  return sliceAndServe(bytes, range, contentType)
}

// ---------------------------------------------------------------- HEAD flow

async function handleHead(id, env) {
  const cacheKey = `https://cache.internal/audio/${encodeURIComponent(id)}`
  const r2Key = `songs/${id}.mp3`

  try {
    const cached = await caches.default.match(cacheKey)
    if (cached && cached.ok) {
      return headerOnly(parseInt(cached.headers.get('content-length') || '0', 10), cached.headers.get('content-type'))
    }
  } catch {
    /* ignore */
  }

  try {
    const meta = await env.AUDIO_BUCKET.head(r2Key)
    if (meta) {
      return headerOnly(meta.size, meta.httpMetadata?.contentType)
    }
  } catch {
    /* ignore */
  }

  const resolved = await resolveStreamUrl(id, env)
  if (!resolved) return json({ error: 'Song stream unavailable' }, 502)

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
      upstream.headers.get('content-type')
    )
  } catch {
    return json({ error: 'Song stream unavailable' }, 502)
  }
}

// ---------------------------------------------------------------- URL resolution

/**
 * Tier-3 resolution order: KV (recent signed URL) -> NCT API -> matching service.
 * The resolved URL is cached in KV so the same signed URL is reused until expiry
 * (one KV write per song per ~6h window).
 */
async function resolveStreamUrl(id, env) {
  const kvKey = `stream:${id}`

  try {
    const cachedUrl = await env.STREAM_URL_KV.get(kvKey)
    if (cachedUrl) return { url: cachedUrl, source: 'kv' }
  } catch {
    /* KV read error -> resolve from upstream */
  }

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
        await env.STREAM_URL_KV.put(kvKey, audioUrl, { expirationTtl: STREAM_URL_KV_TTL_SECONDS }).catch(() => {})
        return { url: audioUrl, source: 'nct' }
      }
    }
  } catch {
    /* fall through */
  }

  // 2) Matching service fallback (YouTube) — optional via MATCHING_SERVICE_URL
  if (env.MATCHING_SERVICE_URL) {
    try {
      const sep = env.MATCHING_SERVICE_URL.includes('?') ? '&' : '?'
      const res = await fetch(`${env.MATCHING_SERVICE_URL}${sep}id=${encodeURIComponent(id)}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
      })
      if (res.ok) {
        const data = await res.json()
        const url = typeof data === 'string' ? data : data && typeof data.url === 'string' ? data.url : null
        if (url && /^https:\/\//.test(url)) {
          await env.STREAM_URL_KV.put(kvKey, url, { expirationTtl: STREAM_URL_KV_TTL_SECONDS }).catch(() => {})
          return { url, source: 'matching' }
        }
      }
    } catch {
      /* fall through */
    }
  }

  return null
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
    if (u.protocol !== 'https:' || (u.hostname !== 'nct.vn' && !u.hostname.endsWith('.nct.vn'))) return null
    return u.href
  } catch {
    return null
  }
}

async function fetchFullOrigin(streamUrl, env) {
  try {
    const res = await fetch(streamUrl, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT, Accept: AUDIO_ACCEPT },
      cache: 'no-store',
      signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
    })
    return res.ok ? res : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- response builders

function sliceAndServe(bytes, range, contentType) {
  if (range && range.invalid) range = null // malformed Range -> serve full 200
  const total = bytes.byteLength
  const body = range ? bytes.slice(range.start, range.end + 1) : bytes
  const headers = baseHeaders(contentType, range ? range.end - range.start + 1 : total)
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${total}`)
    return new Response(body, { status: 206, headers })
  }
  return new Response(body, { status: 200, headers })
}

function serveR2(part, total, range, contentType) {
  const headers = baseHeaders(contentType, range ? range.end - range.start + 1 : total, part.httpEtag)
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${total}`)
    return new Response(part.body, { status: 206, headers })
  }
  return new Response(part.body, { status: 200, headers })
}

function headerOnly(total, contentType) {
  return new Response(null, { status: 200, headers: baseHeaders(contentType, total) })
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

async function populateCaches(env, ctx, r2Key, cacheKey, bytes, contentType) {
  await Promise.all([
    env.AUDIO_BUCKET.put(r2Key, bytes, { httpMetadata: { contentType: contentType || 'audio/mpeg' } }).catch(() => {}),
    caches.default
      .put(
        cacheKey,
        new Response(bytes, {
          headers: {
            'Content-Type': contentType || 'audio/mpeg',
            'Content-Length': String(bytes.byteLength),
            'Cache-Control': `public, max-age=${FULL_CACHE_TTL_SECONDS}, immutable`,
          },
        })
      )
      .catch(() => {}),
  ])
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  })
}
