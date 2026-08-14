/**
 * Cloudflare Worker — High-Performance SoundCloud Stream Cache & Proxy
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
 * Direct Edge Resolver: Resolves stream URL straight from SoundCloud API
 */
async function resolveDirectlyFromEdge(cleanId) {
  for (const clientId of FALLBACK_CLIENT_IDS) {
    try {
      const trackApi = `https://api-v2.soundcloud.com/tracks/${cleanId}?client_id=${clientId}`
      const trackRes = await fetch(trackApi, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      })

      if (!trackRes.ok) continue
      const raw = await trackRes.json()

      const transcodings = raw?.media?.transcodings || []
      const progressiveTranscoding = transcodings.find(
        (t) =>
          t.format?.protocol === 'progressive' &&
          (t.format?.mime_type?.includes('audio/mpeg') || t.preset?.includes('mp3'))
      ) || transcodings.find((t) => t.format?.protocol === 'progressive') || transcodings[0]

      if (!progressiveTranscoding?.url) continue

      const mediaRes = await fetch(`${progressiveTranscoding.url}?client_id=${clientId}`, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      })

      if (!mediaRes.ok) continue
      const mediaData = await mediaRes.json()
      if (mediaData?.url) {
        return mediaData.url
      }
    } catch {
      // Continue to next client ID or fallback
    }
  }
  return null
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
        JSON.stringify({ status: 'ok', service: 'soundcloud-stream-cache', version: '2.0.0' }),
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

      // A. Check Cloudflare KV cache first (sub-10ms response)
      if (env.SOUNDCLOUD_STREAM_KV) {
        try {
          const cachedUrl = await env.SOUNDCLOUD_STREAM_KV.get(kvKey)
          if (cachedUrl) {
            return redirectResponse(cachedUrl, 7200)
          }
        } catch (e) {
          console.warn('KV read error:', e)
        }
      }

      // B. Direct Edge Resolution (Ultra-fast ~150ms from Cloudflare Edge to SoundCloud CDN)
      let streamUrl = await resolveDirectlyFromEdge(cleanId)

      // C. Fallback to Next.js App backend if edge resolution was unable to find media
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

      // Save to Cloudflare KV cache with 2-hour TTL
      if (env.SOUNDCLOUD_STREAM_KV) {
        ctx.waitUntil(
          env.SOUNDCLOUD_STREAM_KV.put(kvKey, streamUrl, {
            expirationTtl: 7200,
          })
        )
      }

      // Return 307 Redirect with Cache-Control headers so browser also caches the CDN URL
      return redirectResponse(streamUrl, 7200)
    }

    return corsResponse(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
