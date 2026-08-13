/**
 * Google Drive Audio — R2 Cache Worker
 *
 * GET  /api/drive-stream?id=<fileId>&filename=<hint>  -> full or Range-sliced audio
 * HEAD /api/drive-stream?id=<fileId>                  -> headers only
 *
 * 3-tier cache:
 *   T1  Cache API   https://cache.internal/drive-audio/<fileId>   (short-lived)
 *   T2  R2           drive-songs/<fileId>                          (permanent full file)
 *   T3  Origin       calls back into the Next.js app's
 *                     /api/drive-resolve-origin endpoint, which runs the existing
 *                     probe/fallback logic in lib/drive-stream-resolver.ts and
 *                     returns { url, contentType }.
 *
 * Origin is always fetched as a FULL file (no Range forwarded), so R2 always
 * holds a complete, reusable copy. Range requests are served from R2 native range reads.
 */

const ORIGIN_TIMEOUT_MS = 15000 // Drive fallback path (confirm-token) can be slow for large FLAC
const FULL_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days — Drive file content doesn't change under a fixed fileId
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
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

    if (pathname === '/api/drive-stream' || pathname === '/api/drive-stream/') {
      const fileId = (searchParams.get('id') || searchParams.get('fileId') || '').trim()
      const filenameHint = searchParams.get('filename') || searchParams.get('title') || ''
      if (!fileId) return json({ error: 'Missing fileId' }, 400)
      return method === 'HEAD'
        ? handleHead(fileId, env)
        : handleStream(fileId, filenameHint, request, env, ctx)
    }

    if (pathname === '/health' || pathname === '/') {
      return json({ ok: true, worker: 'music-drive-stream-cache' })
    }

    return json({ error: 'Not found' }, 404)
  },
}

// ---------------------------------------------------------------- main GET flow

async function handleStream(fileId, filenameHint, request, env, ctx) {
  const cacheKey = `https://cache.internal/drive-audio/${encodeURIComponent(fileId)}`
  const r2Key = `drive-songs/${fileId}`
  const rangeHeader = request.headers.get('range')

  // ---- T1: Cache API ----
  try {
    const cached = await caches.default.match(cacheKey)
    if (cached && cached.ok) {
      const bytes = await cached.arrayBuffer()
      const range = parseRange(rangeHeader, bytes.byteLength)
      if (range && range.unsatisfiable) return rangeNotSatisfiable(bytes.byteLength)
      return sliceAndServe(bytes, range, cached.headers.get('content-type'))
    }
  } catch {
    /* fall through to R2 */
  }

  // ---- T2: R2 (permanent, native range reads — no need to load full file into memory) ----
  try {
    const meta = await env.AUDIO_BUCKET.head(r2Key)
    if (meta && meta.size > 0) {
      const total = meta.size
      const range = parseRange(rangeHeader, total)
      if (range && range.unsatisfiable) return rangeNotSatisfiable(total)

      const part = range && !range.invalid
        ? await env.AUDIO_BUCKET.get(r2Key, { range: { offset: range.start, length: range.end - range.start + 1 } })
        : await env.AUDIO_BUCKET.get(r2Key)
      if (part && part.body && !part.body.locked) {
        return serveR2(part, total, range && !range.invalid ? range : null, meta.httpMetadata?.contentType)
      }
    } else if (meta && meta.size === 0) {
      // 0-byte incomplete/corrupt entry from aborted write — delete it and fall through to origin
      ctx.waitUntil(env.AUDIO_BUCKET.delete(r2Key).catch(() => { }))
    }
  } catch (r2Err) {
    console.warn('R2 read failed for', fileId, r2Err?.message || r2Err)
    ctx.waitUntil(env.AUDIO_BUCKET.delete(r2Key).catch(() => { }))
    /* fall through to origin */
  }

  // ---- T3: Origin — resolve real Drive URL via the app, fetch FULL file (stream-tee into R2) ----
  const resolved = await resolveViaApp(fileId, filenameHint, env)
  if (!resolved) return json({ error: 'Google Drive: could not resolve a playable stream URL' }, 502)

  let originRes
  try {
    originRes = await fetch(resolved.url, {
      method: 'GET',
      headers: { 'User-Agent': USER_AGENT },
      cache: 'no-store',
      signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
    })
  } catch {
    return json({ error: 'Google Drive: origin fetch failed' }, 502)
  }
  if (!originRes.ok || !originRes.body) {
    return json({ error: 'Google Drive: origin fetch failed' }, 502)
  }

  const contentType = resolved.contentType || originRes.headers.get('content-type') || 'audio/mpeg'
  const contentLengthHeader = originRes.headers.get('content-length')

  // Large audio files (FLAC/WAV can be 40-80MB) — DO NOT buffer the whole body into
  // memory. Tee the stream: one branch goes to the client immediately, the other is
  // persisted to R2 in the background. Do NOT call originRes.clone() after tee() —
  // originRes.body is already locked and clone() will throw a synchronous TypeError.
  const [clientBody, r2Body] = originRes.body.tee()

  ctx.waitUntil(
    (async () => {
      try {
        await env.AUDIO_BUCKET.put(r2Key, r2Body, {
          httpMetadata: { contentType },
        })
      } catch (e) {
        console.warn('R2 put failed for', fileId, e?.message || e)
        // If background write was aborted (e.g. client disconnect/skip), delete partial R2 object
        await env.AUDIO_BUCKET.delete(r2Key).catch(() => { })
      }
    })()
  )

  const headers = new Headers(CORS)
  headers.set('Content-Type', contentType)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Cache-Control', `public, max-age=${FULL_CACHE_TTL_SECONDS}, immutable`)
  if (contentLengthHeader) headers.set('Content-Length', contentLengthHeader)

  // Note: We omit caches.default.put here because R2 is our primary, permanent cache
  // with native byte-range read support, and avoiding full-body arrayBuffer buffering
  // keeps Worker memory usage minimal for large audio files.

  return new Response(clientBody, { status: 200, headers })
}

// ---------------------------------------------------------------- HEAD flow

async function handleHead(fileId, env) {
  const cacheKey = `https://cache.internal/drive-audio/${encodeURIComponent(fileId)}`
  const r2Key = `drive-songs/${fileId}`

  try {
    const cached = await caches.default.match(cacheKey)
    if (cached && cached.ok) {
      return headerOnly(parseInt(cached.headers.get('content-length') || '0', 10), cached.headers.get('content-type'))
    }
  } catch { }

  try {
    const meta = await env.AUDIO_BUCKET.head(r2Key)
    if (meta) return headerOnly(meta.size, meta.httpMetadata?.contentType)
  } catch { }

  // Not cached anywhere yet — HEAD should not trigger a full origin fetch+R2 populate.
  // Return 404 so the caller falls back to a GET (which will populate the cache).
  return new Response(null, { status: 404, headers: CORS })
}

// ---------------------------------------------------------------- origin resolution via app

/**
 * Calls back into the Next.js app to run the existing probe/fallback logic
 * (lib/drive-stream-resolver.ts::resolveDriveStreamUrl). See Phase 2 for the
 * corresponding app route.
 */
async function resolveViaApp(fileId, filenameHint, env) {
  const base = env.APP_RESOLVE_ORIGIN_URL // e.g. https://your-app.vercel.app/api/drive-resolve-origin
  if (!base) return null
  try {
    const url = new URL(base)
    url.searchParams.set('id', fileId)
    if (filenameHint) url.searchParams.set('filename', filenameHint)
    if (env.INTERNAL_RESOLVE_SECRET) url.searchParams.set('secret', env.INTERNAL_RESOLVE_SECRET)

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data || !data.url) return null
    return { url: data.url, contentType: data.contentType || null }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- response builders

function sliceAndServe(bytes, range, contentType) {
  if (range && range.invalid) range = null
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
  return new Response(null, { status: 416, headers: { ...CORS, 'Content-Range': `bytes */${total}` } })
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
