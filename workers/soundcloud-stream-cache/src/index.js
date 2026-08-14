/**
 * Cloudflare Worker — SoundCloud Stream Cache & Proxy
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range, Authorization',
}

function corsResponse(body, init = {}) {
  const headers = new Headers(init.headers || {})
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v)
  }
  return new Response(body, { ...init, headers })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    // 1. Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return corsResponse(JSON.stringify({ status: 'ok', service: 'soundcloud-stream-cache' }), {
        headers: { 'Content-Type': 'application/json' },
      })
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

      // Check KV cache if available
      if (env.SOUNDCLOUD_STREAM_KV) {
        try {
          const cachedUrl = await env.SOUNDCLOUD_STREAM_KV.get(kvKey)
          if (cachedUrl) {
            return Response.redirect(cachedUrl, 307)
          }
        } catch (e) {
          console.warn('KV read error:', e)
        }
      }

      // Resolve stream URL from Next.js backend
      try {
        const appUrl = (env.NEXT_APP_URL || 'https://phongtctmusic.vercel.app').replace(/\/+$/, '')
        const resolveApi = `${appUrl}/api/soundcloud/stream?id=${encodeURIComponent(cleanId)}&format=json`

        const res = await fetch(resolveApi, {
          headers: { Accept: 'application/json' },
        })

        if (!res.ok) {
          return corsResponse(JSON.stringify({ error: 'Failed to resolve stream from app backend' }), {
            status: res.status,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        const data = await res.json()
        const streamUrl = data?.url

        if (!streamUrl) {
          return corsResponse(JSON.stringify({ error: 'Stream URL not available' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        // Cache in KV for 2 hours (SoundCloud signed tokens typically last ~4 hours)
        if (env.SOUNDCLOUD_STREAM_KV) {
          ctx.waitUntil(
            env.SOUNDCLOUD_STREAM_KV.put(kvKey, streamUrl, {
              expirationTtl: 7200,
            })
          )
        }

        return Response.redirect(streamUrl, 307)
      } catch (err) {
        return corsResponse(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return corsResponse(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
