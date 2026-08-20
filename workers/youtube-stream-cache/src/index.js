/**
 * YouTube Audio — R2 Stream Cache Worker
 *
 * GET  /api/yt-stream?id=<videoId>  → stream audio (range-aware)
 * HEAD /api/yt-stream?id=<videoId>  → metadata only (used for prewarm)
 *
 * ── Cache tiers ─────────────────────────────────────────────────────────────
 *
 *   T1  CF Cache API   in-memory edge cache, ~4h TTL
 *       Fast for hot tracks; skipped for Range requests (Cache API doesn't
 *       handle partial content well — always stores/returns full file).
 *
 *   T2  R2 bucket      permanent full-file storage, native range reads
 *       Key: yt-audio/<videoId>
 *       Once written, all future requests are served from R2 with 0 Vercel CPU.
 *       Stale/corrupt entries (size=0) are auto-deleted and re-fetched.
 *
 *   T3  Fresh resolve + origin fetch
 *       Resolution order (non-IP-bound methods, all can be called from CF edge):
 *         a) InnerTube ANDROID  — fastest (~1-2s), no binary needed
 *         b) InnerTube iOS      — alternative client context
 *         c) Vercel /api/youtube/resolve — yt-dlp-free fallback, more reliable
 *            for geo-blocked or age-restricted content
 *
 * ── Range request strategy ───────────────────────────────────────────────────
 *
 *   Client sends Range → forward Range to origin, serve 206 immediately.
 *   Simultaneously trigger ctx.waitUntil(populateR2) to fetch the full file
 *   and store in R2 so the NEXT play is served from R2 with native range reads.
 *
 *   Client sends no Range → fetch full file, tee: serve 200 + write to R2.
 *
 * ── iOS background audio compatibility ───────────────────────────────────────
 *
 *   audio.src = "https://<worker>/api/yt-stream?id=<videoId>"
 *   - Stable URL (never expires — Worker handles URL re-resolution internally)
 *   - CORS: Access-Control-Allow-Origin: * (works with crossOrigin="anonymous")
 *   - Range: supported natively from R2
 *   - Lock screen / background: CF edge serves bytes; Vercel is not involved
 */

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_API_TTL_SECONDS = 4 * 60 * 60   // 4 h — hot tracks in CF edge memory
const R2_CACHE_TTL_SECONDS  = 60 * 60 * 24 * 90 // 90 days — audio doesn't change per videoId
const INNERTUBE_TIMEOUT_MS  = 6_000
const ORIGIN_FETCH_TIMEOUT_MS = 25_000       // googlevideo can be slow on first connect
const POPULATE_R2_TIMEOUT_MS  = 45_000       // background R2 population — more lenient

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type, Accept-Ranges',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type, ETag',
}

// ── Entry point ───────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const { pathname, searchParams } = url
    const method = request.method

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    // Health check
    if (pathname === '/' || pathname === '/health') {
      return json({ ok: true, worker: 'youtube-stream-cache', ts: Date.now() })
    }

    // Stream endpoint
    if (pathname === '/api/yt-stream' || pathname === '/api/yt-stream/') {
      const videoId = sanitizeVideoId(searchParams.get('id') || searchParams.get('videoId') || '')
      if (!videoId) return json({ error: 'Invalid or missing videoId' }, 400)

      return method === 'HEAD'
        ? handleHead(videoId, env)
        : handleStream(videoId, request, env, ctx)
    }

    return json({ error: 'Not found' }, 404)
  },
}

// ── HEAD handler ─────────────────────────────────────────────────────────────

async function handleHead(videoId, env) {
  const r2Key = r2KeyFor(videoId)

  try {
    const meta = await env.AUDIO_BUCKET.head(r2Key)
    if (meta && meta.size > 0) {
      const headers = new Headers(CORS)
      headers.set('Content-Type', meta.httpMetadata?.contentType || 'audio/mp4')
      headers.set('Content-Length', String(meta.size))
      headers.set('Accept-Ranges', 'bytes')
      headers.set('Cache-Control', `public, max-age=${R2_CACHE_TTL_SECONDS}`)
      if (meta.httpEtag) headers.set('ETag', meta.httpEtag)
      return new Response(null, { status: 200, headers })
    }
  } catch {}

  // Not in R2 yet — return 200 with minimal headers to indicate the URL is valid
  return new Response(null, {
    status: 200,
    headers: { ...CORS, 'Accept-Ranges': 'bytes', 'Content-Type': 'audio/mp4' },
  })
}

// ── GET handler ───────────────────────────────────────────────────────────────

async function handleStream(videoId, request, env, ctx) {
  const r2Key       = r2KeyFor(videoId)
  const rangeHeader = request.headers.get('range')
  const cacheKey    = `https://cache.internal/yt-audio/${videoId}`

  // ── T1: CF Cache API (full-file only, 4h edge cache) ─────────────────────
  if (!rangeHeader) {
    try {
      const cached = await caches.default.match(cacheKey)
      if (cached && cached.ok) {
        return cloneWithCors(cached)
      }
    } catch {}
  }

  // ── T2: R2 (native range reads, permanent) ────────────────────────────────
  try {
    const meta = await env.AUDIO_BUCKET.head(r2Key)

    if (meta && meta.size > 0) {
      const total     = meta.size
      const range     = parseRange(rangeHeader, total)

      if (range && range.unsatisfiable) return rangeNotSatisfiable(total)

      const getOpts   = (range && !range.invalid)
        ? { range: { offset: range.start, length: range.end - range.start + 1 } }
        : {}

      const part      = await env.AUDIO_BUCKET.get(r2Key, getOpts)

      if (part && part.body && !part.body.locked) {
        const contentType = meta.httpMetadata?.contentType || 'audio/mp4'
        const resp        = serveR2(part, total, range && !range.invalid ? range : null, contentType, meta.httpEtag)

        // Backfill T1 Cache API for full-file hits (no Range)
        if (!rangeHeader) {
          ctx.waitUntil(caches.default.put(cacheKey, resp.clone()).catch(() => {}))
        }

        return resp
      }
    } else if (meta && meta.size === 0) {
      // Corrupt/incomplete write — clean up and fall through to fresh resolve
      ctx.waitUntil(env.AUDIO_BUCKET.delete(r2Key).catch(() => {}))
    }
  } catch (r2Err) {
    console.warn('[YT Worker] R2 read error for', videoId, r2Err?.message || r2Err)
    ctx.waitUntil(env.AUDIO_BUCKET.delete(r2Key).catch(() => {}))
  }

  // ── T3: Fresh resolve + origin fetch ─────────────────────────────────────
  const resolved = await resolveYouTubeAudio(videoId, env)
  if (!resolved) {
    return json({ error: 'Could not resolve YouTube audio stream' }, 502)
  }

  // Fetch from googlevideo
  // If client sent Range: forward it (fast first-byte), also trigger background R2 population.
  // If no Range: fetch full file, tee to R2 + serve.
  const controller = new AbortController()
  const fetchTimeout = setTimeout(() => controller.abort(), ORIGIN_FETCH_TIMEOUT_MS)

  let originRes
  try {
    const originHeaders = { 'User-Agent': USER_AGENT }
    if (rangeHeader) originHeaders['Range'] = rangeHeader
    originRes = await fetch(resolved.url, {
      headers: originHeaders,
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (err) {
    clearTimeout(fetchTimeout)
    console.error('[YT Worker] Origin fetch failed for', videoId, err?.message || err)
    return json({ error: 'Origin fetch failed' }, 502)
  }
  clearTimeout(fetchTimeout)

  if (!originRes.ok || !originRes.body) {
    return json({ error: `Origin responded ${originRes.status}` }, 502)
  }

  const contentType        = resolved.mimeType || originRes.headers.get('content-type') || 'audio/mp4'
  const originContentRange = originRes.headers.get('content-range')
  const originContentLen   = originRes.headers.get('content-length')
  const isPartial          = originRes.status === 206 || Boolean(originContentRange)

  if (isPartial) {
    // Serve the partial slice immediately, warm R2 with full file in background
    ctx.waitUntil(populateR2(videoId, resolved.url, contentType, r2Key, env))

    const headers = new Headers(CORS)
    headers.set('Content-Type', contentType)
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Cache-Control', 'no-cache')
    if (originContentRange) headers.set('Content-Range', originContentRange)
    if (originContentLen)   headers.set('Content-Length', originContentLen)

    return new Response(originRes.body, { status: 206, headers })
  }

  // Full response: tee → serve client + write to R2 in background
  const [clientBody, r2Body] = originRes.body.tee()

  ctx.waitUntil(
    env.AUDIO_BUCKET.put(r2Key, r2Body, {
      httpMetadata: { contentType },
    }).catch((e) => {
      console.warn('[YT Worker] R2 write failed for', videoId, e?.message || e)
      return env.AUDIO_BUCKET.delete(r2Key).catch(() => {})
    })
  )

  const fullHeaders = new Headers(CORS)
  fullHeaders.set('Content-Type', contentType)
  fullHeaders.set('Accept-Ranges', 'bytes')
  fullHeaders.set('Cache-Control', `public, max-age=${CACHE_API_TTL_SECONDS}`)
  if (originContentLen) fullHeaders.set('Content-Length', originContentLen)

  const fullResponse = new Response(clientBody, { status: 200, headers: fullHeaders })

  // Also store in Cache API for subsequent hot requests
  ctx.waitUntil(caches.default.put(cacheKey, fullResponse.clone()).catch(() => {}))

  return fullResponse
}

// ── Background R2 population ──────────────────────────────────────────────────
// Called after a Range (partial) response so that the next play can be served
// entirely from R2 without going to origin again.

async function populateR2(videoId, resolvedUrl, contentType, r2Key, env) {
  // Skip if R2 already has a complete entry (concurrent request may have written it)
  try {
    const existing = await env.AUDIO_BUCKET.head(r2Key)
    if (existing && existing.size > 0) return
  } catch {}

  try {
    const res = await fetch(resolvedUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(POPULATE_R2_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok || !res.body) return

    await env.AUDIO_BUCKET.put(r2Key, res.body, {
      httpMetadata: { contentType },
    })
    console.log('[YT Worker] Background R2 population complete for', videoId)
  } catch (e) {
    console.warn('[YT Worker] Background R2 population failed for', videoId, e?.message || e)
    await env.AUDIO_BUCKET.delete(r2Key).catch(() => {})
  }
}

// ── YouTube URL resolution ────────────────────────────────────────────────────
//
// Priority order — all methods produce non-IP-bound URLs that CF Worker can use
// to fetch audio from googlevideo on Cloudflare's network:
//   1. InnerTube ANDROID  — fastest, direct from Worker
//   2. InnerTube iOS      — alternative UA, sometimes succeeds when ANDROID fails
//   3. Vercel fallback    — /api/youtube/resolve, uses ANDROID+iOS+Piped from Vercel IP
//                           (helpful for geo-blocked content where CF IP is blocked)

async function resolveYouTubeAudio(videoId, env) {
  const android = await resolveViaAndroid(videoId)
  if (android) return android

  const ios = await resolveViaIos(videoId)
  if (ios) return ios

  if (env.APP_YT_RESOLVE_URL && env.INTERNAL_YT_RESOLVE_SECRET) {
    const vercel = await resolveViaVercel(videoId, env)
    if (vercel) return vercel
  }

  return null
}

async function resolveViaAndroid(videoId) {
  const UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip'
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'X-Goog-Api-Format-Version': '2',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            androidSdkVersion: 34,
            hl: 'en', gl: 'US',
            userAgent: UA,
          },
        },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(INNERTUBE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return extractBestAudio(await res.json())
  } catch (err) {
    console.warn('[YT Worker] ANDROID resolve failed:', err?.message || err)
    return null
  }
}

async function resolveViaIos(videoId) {
  const UA = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_4 like Mac OS X)'
  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
        'X-Youtube-Client-Name': '5',
        'X-Youtube-Client-Version': '20.10.4',
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: 'IOS',
            clientVersion: '20.10.4',
            deviceModel: 'iPhone16,2',
            hl: 'en', gl: 'US',
            userAgent: UA,
          },
        },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
      signal: AbortSignal.timeout(INNERTUBE_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return extractBestAudio(await res.json())
  } catch (err) {
    console.warn('[YT Worker] iOS resolve failed:', err?.message || err)
    return null
  }
}

async function resolveViaVercel(videoId, env) {
  try {
    const url = new URL(env.APP_YT_RESOLVE_URL)
    url.searchParams.set('id', videoId)
    url.searchParams.set('secret', env.INTERNAL_YT_RESOLVE_SECRET)

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data?.url) return null
    return { url: data.url, mimeType: data.mimeType || 'audio/mp4' }
  } catch (err) {
    console.warn('[YT Worker] Vercel resolve failed:', err?.message || err)
    return null
  }
}

function extractBestAudio(data) {
  if (!data || typeof data !== 'object') return null

  const sd      = data.streamingData || {}
  const formats = [...(sd.adaptiveFormats || []), ...(sd.formats || [])]

  // Only accept formats with a direct URL (skip signatureCipher — requires JS decipher)
  const audio   = formats.filter(
    (f) => f?.url && f?.mimeType && String(f.mimeType).startsWith('audio/')
  )

  if (!audio.length) {
    const status = data?.playabilityStatus?.status
    if (status && status !== 'OK') {
      console.warn('[YT Worker] Playability status:', status, data?.playabilityStatus?.reason || '')
    }
    return null
  }

  // Prefer m4a/mp4 (better iOS compat) then highest bitrate
  audio.sort((a, b) => {
    const aM4 = a.mimeType.includes('audio/mp4') ? 1 : 0
    const bM4 = b.mimeType.includes('audio/mp4') ? 1 : 0
    if (aM4 !== bM4) return bM4 - aM4
    return (b.bitrate || 0) - (a.bitrate || 0)
  })

  const best = audio[0]
  return { url: best.url, mimeType: best.mimeType.split(';')[0].trim() }
}

// ── R2 helpers ────────────────────────────────────────────────────────────────

function serveR2(part, total, range, contentType, etag) {
  const size    = range ? (range.end - range.start + 1) : total
  const headers = baseHeaders(contentType, size, etag)
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${total}`)
    return new Response(part.body, { status: 206, headers })
  }
  return new Response(part.body, { status: 200, headers })
}

// ── General helpers ───────────────────────────────────────────────────────────

function r2KeyFor(videoId) {
  return `yt-audio/${videoId}`
}

function sanitizeVideoId(raw) {
  const id = raw.trim()
  return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : ''
}

function cloneWithCors(response) {
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v)
  return new Response(response.body, { status: response.status, headers })
}

function baseHeaders(contentType, length, etag) {
  const h = new Headers(CORS)
  h.set('Content-Type', contentType || 'audio/mp4')
  h.set('Accept-Ranges', 'bytes')
  h.set('Cache-Control', `public, max-age=${R2_CACHE_TTL_SECONDS}`)
  if (length != null) h.set('Content-Length', String(length))
  if (etag) h.set('ETag', etag)
  return h
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
    end   = size - 1
  } else {
    start = Number(m[1])
    if (!Number.isFinite(start) || start < 0) return { invalid: true }
    end   = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }

  if (start >= size || start > end) return { unsatisfiable: true }
  return { start, end }
}

function rangeNotSatisfiable(total) {
  return new Response(null, {
    status: 416,
    headers: { ...CORS, 'Content-Range': `bytes */${total}` },
  })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  })
}
