/**
 * Cloudflare Worker — High-Performance SoundCloud Stream Cache & Proxy
 * Features:
 * - L1 Cache: Cloudflare Cache API (caches.default) — Sub-5ms worldwide edge response
 * - L2 Cache: Cloudflare KV (SOUNDCLOUD_STREAM_KV) — Persistent global cache
 * - Dynamic Edge Client ID resolution & scraping with in-memory TTL
 * - Automatic Next.js fallback if direct edge resolution encounters edge-case tracks
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

// In-worker isolate memory cache for dynamic client ID
let cachedEdgeClientId = null
let edgeClientIdExpiresAt = 0

function corsResponse(body, init = {}) {
  const headers = new Headers(init.headers || {})
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v)
  }
  return new Response(body, { ...init, headers })
}

function redirectResponse(targetUrl, maxAge = 7200) {
  const headers = new Headers({
    Location: targetUrl,
    'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=3600`,
    ...CORS_HEADERS,
  })
  return new Response(null, { status: 307, headers })
}

/**
 * Dynamically resolves or extracts a working SoundCloud Client ID directly at the Cloudflare Edge
 */
async function getEdgeSoundCloudClientId(env) {
  if (env && env.SOUNDCLOUD_CLIENT_ID) {
    return env.SOUNDCLOUD_CLIENT_ID.trim()
  }

  const now = Date.now()
  if (cachedEdgeClientId && now < edgeClientIdExpiresAt) {
    return cachedEdgeClientId
  }

  // 1. Try extracting dynamically from soundcloud.com bundle
  try {
    const htmlRes = await fetch('https://soundcloud.com', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    })

    if (htmlRes.ok) {
      const html = await htmlRes.text()
      const scriptUrls = [...html.matchAll(/<script[^>]+src="([^">]+\.js)"/g)].map((m) => m[1])

      // Probe scripts in reverse order (client_id usually lives in app/vendor chunks)
      for (const sUrl of scriptUrls.slice(-8).reverse()) {
        try {
          const sRes = await fetch(sUrl)
          if (sRes.ok) {
            const js = await sRes.text()
            const match = js.match(/client_id[:=]\s*["']([a-zA-Z0-9]{32})["']/)
            if (match && match[1]) {
              cachedEdgeClientId = match[1]
              edgeClientIdExpiresAt = now + 2 * 60 * 60 * 1000 // 2 hours TTL
              return cachedEdgeClientId
            }
          }
        } catch {
          // continue checking next script
        }
      }
    }
  } catch (err) {
    console.warn('[SoundCloud Worker] Dynamic client_id extraction warning:', err)
  }

  // 2. Fallback to candidate list
  cachedEdgeClientId = FALLBACK_CLIENT_IDS[0]
  edgeClientIdExpiresAt = now + 15 * 60 * 1000
  return cachedEdgeClientId
}

/**
 * Direct Edge Resolver: Resolves stream URL straight from SoundCloud API
 */
async function resolveDirectlyFromEdge(cleanId, clientId) {
  try {
    const trackApi = `https://api-v2.soundcloud.com/tracks/${cleanId}?client_id=${clientId}`
    const trackRes = await fetch(trackApi, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    })

    if (!trackRes.ok) return null
    const raw = await trackRes.json()

    const transcodings = raw?.media?.transcodings || []
    if (transcodings.length === 0) return null

    // Pick best transcoding (Progressive MP3 full stream first)
    const progressiveStream = transcodings.find(
      (t) =>
        t.format?.protocol === 'progressive' &&
        t.url?.includes('/stream/') &&
        (t.format?.mime_type?.includes('audio/mpeg') || t.preset?.includes('mp3'))
    ) || transcodings.find(
      (t) => t.format?.protocol === 'progressive' && t.url?.includes('/stream/')
    ) || transcodings.find(
      (t) => t.format?.protocol === 'progressive'
    ) || transcodings[0]

    if (!progressiveStream?.url) return null

    const mediaRes = await fetch(`${progressiveStream.url}?client_id=${clientId}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
    })

    if (!mediaRes.ok) return null
    const mediaData = await mediaRes.json()
    return mediaData?.url || null
  } catch (e) {
    console.warn('[SoundCloud Worker] Direct resolve error:', e)
    return null
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    // 1. Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return corsResponse(
        JSON.stringify({ status: 'ok', service: 'soundcloud-stream-cache', version: '2.1.0' }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // 2. Stream endpoint: /stream?id=<trackId>
    if (url.pathname === '/stream') {
      const id = url.searchParams.get('id')
      if (!id) {
        return corsResponse(JSON.stringify({ error: 'Missing track id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      const cleanId = id.replace(/^sc-/, '')
      const kvKey = `sc_stream_${cleanId}`

      // A. Check Cloudflare Cache API (L1 Edge RAM/SSD Cache — Sub-5ms worldwide)
      const edgeCache = caches.default
      const cacheKey = new Request(url.toString(), {
        method: 'GET',
        headers: request.headers,
      })

      try {
        const cachedEdgeResponse = await edgeCache.match(cacheKey)
        if (cachedEdgeResponse) {
          return cachedEdgeResponse
        }
      } catch (cacheReadErr) {
        console.warn('L1 Edge Cache read error:', cacheReadErr)
      }

      // B. Check Cloudflare KV cache (L2 Persistent Cache)
      if (env.SOUNDCLOUD_STREAM_KV) {
        try {
          const cachedUrl = await env.SOUNDCLOUD_STREAM_KV.get(kvKey)
          if (cachedUrl) {
            const res = redirectResponse(cachedUrl, 7200)
            ctx.waitUntil(edgeCache.put(cacheKey, res.clone()))
            return res
          }
        } catch (e) {
          console.warn('L2 KV read error:', e)
        }
      }

      // C. Direct Edge Resolution via SoundCloud API
      const clientId = await getEdgeSoundCloudClientId(env)
      let streamUrl = await resolveDirectlyFromEdge(cleanId, clientId)

      // If failed, try invalidating cached client ID and retry once
      if (!streamUrl && clientId) {
        cachedEdgeClientId = null
        edgeClientIdExpiresAt = 0
        const freshClientId = await getEdgeSoundCloudClientId(env)
        if (freshClientId && freshClientId !== clientId) {
          streamUrl = await resolveDirectlyFromEdge(cleanId, freshClientId)
        }
      }

      // D. Fallback to Next.js App backend if direct edge resolution failed
      if (!streamUrl) {
        try {
          const appUrl = (env.NEXT_APP_URL || 'https://phongtctmusic.vercel.app').replace(/\/+$/, '')
          const resolveApi = `${appUrl}/api/soundcloud/stream?id=${encodeURIComponent(cleanId)}&format=json`

          const res = await fetch(resolveApi, {
            headers: { Accept: 'application/json' },
          })

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

      const redirectRes = redirectResponse(streamUrl, 7200)

      // Save to L1 Edge Cache (caches.default)
      ctx.waitUntil(edgeCache.put(cacheKey, redirectRes.clone()))

      // Save to L2 KV Cache (if bound)
      if (env.SOUNDCLOUD_STREAM_KV) {
        ctx.waitUntil(
          env.SOUNDCLOUD_STREAM_KV.put(kvKey, streamUrl, {
            expirationTtl: 7200,
          })
        )
      }

      // Return 307 Redirect directly to SoundCloud CDN
      return redirectRes
    }

    return corsResponse(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
