/**
 * Cloudflare Worker — High-Performance SoundCloud Stream Cache & Proxy
 * Features:
 * - L1 Cache: Cloudflare Cache API (caches.default) — Sub-5ms worldwide edge response
 * - L2 Cache: Cloudflare KV (SOUNDCLOUD_STREAM_KV) — Persistent global cache
 * - Dynamic Edge Client ID resolution & scraping with in-memory TTL
 * - Automatic Next.js fallback if direct edge resolution encounters edge-case tracks
 *
 * v2.3.0 — bug-fix pass:
 *   [FIX #1] resolveDirectlyFromEdge() now applies the SAME "full audio only"
 *            checks as lib/soundcloud.ts (isSoundCloudFullAudio) instead of
 *            only checking transcodings.length > 0. Previously a blocked /
 *            Go+ snippet-only track could still be streamed via the Worker
 *            even though the main Next.js app would refuse it.
 *   [FIX #3] Fallback client_id candidates now rotate on failure instead of
 *            always using FALLBACK_CLIENT_IDS[0].
 *   [FIX #4] Added in-flight de-duplication for client_id resolution at the
 *            edge, matching the app's inFlightClientIdPromise behaviour, to
 *            avoid a thundering-herd of soundcloud.com scrapes on cache miss.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
}

const FALLBACK_CLIENT_IDS = [
  'UMY1dzQ68n2QbCuypNe8JOivmV2FO2Ep',
  'nXIZT4VQQYkgHs75vpIYbnINQciCkV5Y',
  'iZIs9mchVcX5lhVRyQGGAYlNPVldzAoX',
]

const SC_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// In-worker isolate memory cache for dynamic client ID (15-minute TTL)
let cachedEdgeClientId = null
let edgeClientIdExpiresAt = 0
// [FIX #4] In-flight de-dupe so concurrent cache-miss requests on the same
// isolate don't each independently scrape soundcloud.com.
let inFlightEdgeClientIdPromise = null
// [FIX #3] Rotating index into FALLBACK_CLIENT_IDS.
let fallbackClientIdIndex = 0

function corsResponse(body, init = {}) {
  const headers = new Headers(init.headers || {})
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v)
  }
  return new Response(body, { ...init, headers })
}

function redirectResponse(targetUrl, maxAge = 900) {
  const headers = new Headers({
    Location: targetUrl,
    'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=300`,
    ...CORS_HEADERS,
  })
  return new Response(null, { status: 307, headers })
}

/**
 * [FIX #1] Mirrors isSoundCloudFullAudio() from lib/soundcloud.ts. Keep this
 * in sync with that function — it's duplicated here because the Worker runs
 * in a separate deploy/runtime and can't import the Next.js app's TS module.
 */
function isFullAudioTrack(raw) {
  if (!raw || typeof raw.id === 'undefined') return false
  if (raw.snippet === true) return false
  if (raw.policy === 'SNIPPET' || raw.policy === 'BLOCK') return false
  if (raw.monetization_model === 'SUB_HIGH_TIER') return false
  if (raw.access === 'blocked') return false
  if (raw.streamable === false) return false
  const transcodings = raw?.media?.transcodings
  if (!Array.isArray(transcodings) || transcodings.length === 0) return false
  return transcodings.some((t) => typeof t?.url === 'string' && t.url.includes('/stream/'))
}

function getCurrentFallbackClientId() {
  const id = FALLBACK_CLIENT_IDS[fallbackClientIdIndex % FALLBACK_CLIENT_IDS.length]
  if (!id) {
    throw new Error('[SoundCloud Worker] No fallback client_id available')
  }
  return id
}

function rotateFallbackClientId() {
  fallbackClientIdIndex = (fallbackClientIdIndex + 1) % FALLBACK_CLIENT_IDS.length
}

async function scrapeEdgeClientId() {
  try {
    const htmlRes = await fetch('https://soundcloud.com', {
      headers: { 'User-Agent': SC_USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    })
    if (htmlRes.ok) {
      const html = await htmlRes.text()
      const scriptUrls = [...html.matchAll(/<script[^>]+src="([^">]+\.js)"/g)].map((m) => m[1])
      for (const sUrl of scriptUrls.slice(-8).reverse()) {
        try {
          const sRes = await fetch(sUrl)
          if (sRes.ok) {
            const js = await sRes.text()
            const match = js.match(/client_id[:=]\s*["']([a-zA-Z0-9]{32})["']/)
            if (match && match[1]) return match[1]
          }
        } catch {
          // continue checking next script
        }
      }
    }
  } catch (err) {
    console.warn('[SoundCloud Worker] Dynamic client_id extraction warning:', err)
  }
  return null
}

/**
 * Dynamically resolves or extracts a working SoundCloud Client ID directly
 * at the Cloudflare Edge. forceRefresh bypasses the TTL cache (e.g. after a
 * 401/403 from SoundCloud) and rotates the fallback candidate.
 */
async function getEdgeSoundCloudClientId(env, forceRefresh = false) {
  if (env && env.SOUNDCLOUD_CLIENT_ID) {
    return env.SOUNDCLOUD_CLIENT_ID.trim()
  }
  const now = Date.now()
  if (!forceRefresh && cachedEdgeClientId && now < edgeClientIdExpiresAt) {
    return cachedEdgeClientId
  }
  // [FIX #4] De-dupe concurrent resolutions within this isolate.
  if (!forceRefresh && inFlightEdgeClientIdPromise) {
    return inFlightEdgeClientIdPromise
  }
  if (forceRefresh) {
    rotateFallbackClientId()
  }

  inFlightEdgeClientIdPromise = (async () => {
    const scraped = await scrapeEdgeClientId()
    if (scraped) {
      cachedEdgeClientId = scraped
      edgeClientIdExpiresAt = Date.now() + 15 * 60 * 1000
      fallbackClientIdIndex = 0
      return cachedEdgeClientId
    }
    // [FIX #3] Rotate through fallback candidates instead of always [0].
    const fallback = getCurrentFallbackClientId()
    cachedEdgeClientId = fallback
    edgeClientIdExpiresAt = Date.now() + 15 * 60 * 1000
    return cachedEdgeClientId
  })()

  try {
    return await inFlightEdgeClientIdPromise
  } finally {
    inFlightEdgeClientIdPromise = null
  }
}

/**
 * Direct Edge Resolver: Resolves stream URL straight from SoundCloud API.
 * [FIX #1] Now rejects non-full-audio tracks (blocked/snippet/Go+) instead
 * of returning any transcoding URL it can find.
 */
async function resolveDirectlyFromEdge(cleanId, clientId) {
  try {
    const trackApi = `https://api-v2.soundcloud.com/tracks/${cleanId}?client_id=${clientId}`
    const trackRes = await fetch(trackApi, {
      headers: { 'User-Agent': SC_USER_AGENT, Accept: 'application/json' },
    })
    if (!trackRes.ok) {
      return { status: trackRes.status, url: null }
    }
    const raw = await trackRes.json()

    // [FIX #1] Reject blocked / snippet-only / Go+ tracks at the edge, same
    // as the main app does via isSoundCloudFullAudio().
    if (!isFullAudioTrack(raw)) {
      return { status: 403, url: null, reason: 'not_full_audio' }
    }

    const transcodings = raw?.media?.transcodings || []
    if (transcodings.length === 0) return { status: 404, url: null }

    const progressiveStream =
      transcodings.find(
        (t) =>
          t.format?.protocol === 'progressive' &&
          t.url?.includes('/stream/') &&
          (t.format?.mime_type?.includes('audio/mpeg') || t.preset?.includes('mp3'))
      ) ||
      transcodings.find((t) => t.format?.protocol === 'progressive' && t.url?.includes('/stream/')) ||
      transcodings.find((t) => t.format?.protocol === 'progressive') ||
      transcodings[0]

    if (!progressiveStream?.url) return { status: 404, url: null }

    const mediaRes = await fetch(`${progressiveStream.url}?client_id=${clientId}`, {
      headers: { 'User-Agent': SC_USER_AGENT, Accept: 'application/json' },
    })
    if (!mediaRes.ok) {
      return { status: mediaRes.status, url: null }
    }
    const mediaData = await mediaRes.json()
    return { status: 200, url: mediaData?.url || null }
  } catch (e) {
    console.warn('[SoundCloud Worker] Direct resolve error:', e)
    return { status: 500, url: null }
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    if (url.pathname === '/' || url.pathname === '/health') {
      return corsResponse(
        JSON.stringify({ status: 'ok', service: 'soundcloud-stream-cache', version: '2.3.0' }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (url.pathname === '/stream') {
      const id = url.searchParams.get('id')
      const refresh = url.searchParams.get('refresh') === '1'
      if (!id) {
        return corsResponse(JSON.stringify({ error: 'Missing track id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const cleanId = id.replace(/^sc-/, '')
      const kvKey = `sc_stream_${cleanId}`
      const edgeCache = caches.default
      const cacheKey = new Request(url.toString(), { method: 'GET', headers: request.headers })

      if (!refresh) {
        try {
          const cachedEdgeResponse = await edgeCache.match(cacheKey)
          if (cachedEdgeResponse) return cachedEdgeResponse
        } catch (cacheReadErr) {
          console.warn('L1 Edge Cache read error:', cacheReadErr)
        }
        if (env.SOUNDCLOUD_STREAM_KV) {
          try {
            const cachedUrl = await env.SOUNDCLOUD_STREAM_KV.get(kvKey)
            if (cachedUrl) {
              const res = redirectResponse(cachedUrl, 900)
              ctx.waitUntil(edgeCache.put(cacheKey, res.clone()))
              return res
            }
          } catch (e) {
            console.warn('L2 KV read error:', e)
          }
        }
      }

      const isNumericId = /^\d+$/.test(cleanId)
      let streamUrl = null

      if (isNumericId) {
        const clientId = await getEdgeSoundCloudClientId(env)
        let result = await resolveDirectlyFromEdge(cleanId, clientId)
        streamUrl = result.url

        // Retry once with a rotated/forced-refresh client_id on auth failure.
        if (!streamUrl && (result.status === 401 || result.status === 403) && result.reason !== 'not_full_audio') {
          const freshClientId = await getEdgeSoundCloudClientId(env, true)
          if (freshClientId && freshClientId !== clientId) {
            result = await resolveDirectlyFromEdge(cleanId, freshClientId)
            streamUrl = result.url
          }
        }

        // [FIX #1] If the track was explicitly rejected as non-full-audio,
        // don't fall through to the Next.js app (which would reject it too) —
        // fail fast with a clear 404 instead of an extra round trip.
        if (!streamUrl && result.reason === 'not_full_audio') {
          return corsResponse(
            JSON.stringify({ error: 'Track is not full audio (blocked, snippet, or Go+ only)' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          )
        }
      }

      if (!streamUrl) {
        try {
          const appUrl = (env.NEXT_APP_URL || 'https://phongtctmusic.vercel.app').replace(/\/+$/, '')
          const refreshQuery = refresh ? '&refresh=1' : ''
          const resolveApi = `${appUrl}/api/soundcloud/stream?id=${encodeURIComponent(cleanId)}&format=json${refreshQuery}`
          const res = await fetch(resolveApi, { headers: { Accept: 'application/json' } })
          if (res.ok) {
            const data = await res.json()
            streamUrl = data?.url || null
          }
        } catch (err) {
          console.warn('App fallback resolution error:', err)
        }
      }

      if (!streamUrl) {
        return corsResponse(JSON.stringify({ error: 'Stream URL not available or track is unplayable' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const format = url.searchParams.get('format')
      if (format === 'json') {
        const jsonRes = corsResponse(JSON.stringify({ url: streamUrl }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=900, s-maxage=900, stale-while-revalidate=300',
          },
        })
        ctx.waitUntil(edgeCache.put(cacheKey, jsonRes.clone()))
        if (env.SOUNDCLOUD_STREAM_KV) {
          ctx.waitUntil(
            env.SOUNDCLOUD_STREAM_KV.put(kvKey, streamUrl, {
              expirationTtl: 900,
            })
          )
        }
        return jsonRes
      }

      const redirectRes = redirectResponse(streamUrl, 900)
      ctx.waitUntil(edgeCache.put(cacheKey, redirectRes.clone()))
      if (env.SOUNDCLOUD_STREAM_KV) {
        ctx.waitUntil(env.SOUNDCLOUD_STREAM_KV.put(kvKey, streamUrl, { expirationTtl: 900 }))
      }
      return redirectRes
    }

    return corsResponse(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
