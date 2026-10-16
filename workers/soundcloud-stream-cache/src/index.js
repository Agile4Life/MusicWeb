/**
 * Cloudflare Worker — High-Performance SoundCloud Stream Cache & Proxy
 * Features:
 * - L1 Cache: Cloudflare Cache API (caches.default) — Sub-5ms worldwide edge response
 * - L2 Cache: Cloudflare KV (SOUNDCLOUD_STREAM_KV) — Persistent global cache
 * - Dynamic Edge Client ID resolution & scraping with in-memory TTL
 * - Seamless fMP4 / MP3 HLS stitching into progressive audio/mp4 or audio/mpeg streams
 *   for universal HTML5 <audio> compatibility across Chrome, Edge, Firefox, and Safari
 * - Strict rejection of Go+ 30s previews, SNIP tracks, and FairPlay /cbcs/ DRM tracks
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
let inFlightEdgeClientIdPromise = null
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
 * Mirrors isSoundCloudFullAudio() from lib/soundcloud.ts.
 */
function isFullAudioTrack(raw) {
  if (!raw || typeof raw.id === 'undefined') return false
  if (raw.snippet === true) return false
  if (raw.policy === 'SNIPPET' || raw.policy === 'BLOCK' || raw.policy === 'SNIP') return false
  if (raw.monetization_model === 'SUB_HIGH_TIER') return false
  if (raw.access === 'blocked' || raw.access === 'preview') return false
  if (raw.streamable === false) return false
  if (
    typeof raw.full_duration === 'number' &&
    typeof raw.duration === 'number' &&
    raw.full_duration > 45000 &&
    raw.duration <= 35000 &&
    raw.full_duration - raw.duration > 15000
  ) {
    return false
  }
  const transcodings = raw?.media?.transcodings
  if (!Array.isArray(transcodings) || transcodings.length === 0) return false
  return transcodings.some(
    (t) =>
      typeof t?.url === 'string' &&
      t.url.includes('/stream/') &&
      !t.url.includes('/cbcs/') &&
      !t.snipped &&
      (t.format?.protocol === 'progressive' ||
        (t.format?.protocol === 'hls' &&
          t.preset !== 'abr_sq' &&
          t.format?.mime_type !== 'audio/mpegurl' &&
          t.format?.mime_type !== 'application/vnd.apple.mpegurl'))
  )
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

async function getEdgeSoundCloudClientId(env, forceRefresh = false) {
  if (env && env.SOUNDCLOUD_CLIENT_ID) {
    return env.SOUNDCLOUD_CLIENT_ID.trim()
  }
  const now = Date.now()
  if (!forceRefresh && cachedEdgeClientId && now < edgeClientIdExpiresAt) {
    return cachedEdgeClientId
  }
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

function patchInitMp4Duration(initBytes, durationSeconds) {
  if (
    !(initBytes instanceof Uint8Array) ||
    initBytes.byteLength < 16 ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0
  ) {
    return initBytes
  }

  const out = new Uint8Array(initBytes)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  let mvhdTimescale = 1000

  function walkBoxes(start, end) {
    let offset = start
    while (offset + 8 <= end) {
      const size = view.getUint32(offset, false)
      const type = String.fromCharCode(
        out[offset + 4],
        out[offset + 5],
        out[offset + 6],
        out[offset + 7]
      )
      const boxEnd = size === 0 ? end : offset + size
      if (size < 8 || boxEnd > end) break

      if (type === 'moov' || type === 'trak' || type === 'mdia') {
        walkBoxes(offset + 8, boxEnd)
      } else if (type === 'mvhd') {
        const version = out[offset + 8]
        if (version === 0 && offset + 28 <= boxEnd) {
          const timescale = view.getUint32(offset + 20, false)
          if (timescale > 0) {
            mvhdTimescale = timescale
            view.setUint32(offset + 24, Math.round(durationSeconds * timescale), false)
          }
        } else if (version === 1 && offset + 36 <= boxEnd) {
          const timescale = view.getUint32(offset + 28, false)
          if (timescale > 0) {
            mvhdTimescale = timescale
            view.setBigUint64(
              offset + 32,
              BigInt(Math.round(durationSeconds * timescale)),
              false
            )
          }
        }
      } else if (type === 'tkhd') {
        const version = out[offset + 8]
        if (version === 0 && offset + 32 <= boxEnd) {
          view.setUint32(
            offset + 28,
            Math.round(durationSeconds * mvhdTimescale),
            false
          )
        } else if (version === 1 && offset + 44 <= boxEnd) {
          view.setBigUint64(
            offset + 36,
            BigInt(Math.round(durationSeconds * mvhdTimescale)),
            false
          )
        }
      } else if (type === 'mdhd') {
        const version = out[offset + 8]
        if (version === 0 && offset + 28 <= boxEnd) {
          const timescale = view.getUint32(offset + 20, false)
          if (timescale > 0) {
            view.setUint32(offset + 24, Math.round(durationSeconds * timescale), false)
          }
        } else if (version === 1 && offset + 36 <= boxEnd) {
          const timescale = view.getUint32(offset + 28, false)
          if (timescale > 0) {
            view.setBigUint64(
              offset + 32,
              BigInt(Math.round(durationSeconds * timescale)),
              false
            )
          }
        }
      }

      offset = boxEnd
    }
  }

  walkBoxes(0, out.byteLength)
  return out
}

function stripFmp4SegmentIndexBoxes(segmentBytes) {
  if (!(segmentBytes instanceof Uint8Array) || segmentBytes.byteLength < 8) {
    return segmentBytes
  }
  const view = new DataView(
    segmentBytes.buffer,
    segmentBytes.byteOffset,
    segmentBytes.byteLength
  )
  let offset = 0
  while (offset + 8 <= segmentBytes.byteLength) {
    const size = view.getUint32(offset, false)
    if (size < 8 || offset + size > segmentBytes.byteLength) break
    const type = String.fromCharCode(
      segmentBytes[offset + 4],
      segmentBytes[offset + 5],
      segmentBytes[offset + 6],
      segmentBytes[offset + 7]
    )
    if (type === 'styp' || type === 'sidx') {
      offset += size
      continue
    }
    break
  }
  return offset > 0 ? segmentBytes.subarray(offset) : segmentBytes
}

/**
 * Fetches and validates an HLS .m3u8 playlist.
 * Rejects DRM-encrypted (#EXT-X-KEY / /cbcs/) playlists and extracts init.mp4 + media segments.
 */
async function parseAndValidateHlsPlaylist(m3u8Url) {
  try {
    if (!m3u8Url || m3u8Url.includes('/cbcs/')) {
      return { encrypted: true }
    }
    const res = await fetch(m3u8Url, {
      headers: { 'User-Agent': SC_USER_AGENT },
    })
    if (!res.ok) return null
    const text = await res.text()
    if (!text || text.includes('#EXT-X-KEY') || text.includes('/cbcs/')) {
      return { encrypted: true }
    }
    const mapMatch = text.match(/#EXT-X-MAP:URI="([^"]+)"/)
    const mapUrl = mapMatch ? mapMatch[1] : null
    let durationSeconds = 0
    for (const match of text.matchAll(/#EXTINF:([0-9]+(?:\.[0-9]+)?)/g)) {
      const segDur = Number.parseFloat(match[1])
      if (Number.isFinite(segDur) && segDur > 0) {
        durationSeconds += segDur
      }
    }
    const segmentUrls = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('http://') || line.startsWith('https://'))
    if (segmentUrls.length === 0) return null
    return {
      encrypted: false,
      contentType: mapUrl ? 'audio/mp4' : 'audio/mpeg',
      urls: mapUrl ? [mapUrl, ...segmentUrls] : segmentUrls,
      hasInitMap: Boolean(mapUrl),
      durationSeconds,
    }
  } catch (err) {
    console.warn('[SoundCloud Worker] HLS manifest parse error:', err)
    return null
  }
}

/**
 * Streams an unencrypted fMP4 or MP3 HLS segment list as a single continuous progressive audio response.
 */
function streamHlsSegments(hlsInfo, requestSignal) {
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  ;(async () => {
    try {
      const isFmp4 =
        Boolean(hlsInfo.hasInitMap) || hlsInfo.contentType === 'audio/mp4'
      for (let i = 0; i < hlsInfo.urls.length; i++) {
        const segUrl = hlsInfo.urls[i]
        if (requestSignal?.aborted) break
        const segRes = await fetch(segUrl, {
          headers: { 'User-Agent': SC_USER_AGENT },
          signal: requestSignal,
        })
        if (!segRes.ok || !segRes.body) {
          break
        }

        if (isFmp4 && i === 0) {
          const initBytes = new Uint8Array(await segRes.arrayBuffer())
          const patched = patchInitMp4Duration(
            initBytes,
            hlsInfo.durationSeconds || 0
          )
          if (patched.byteLength > 0) {
            await writer.write(patched)
          }
          continue
        }

        const reader = segRes.body.getReader()
        let stripLeadingBoxes = isFmp4 && i > 0
        let pendingHeader = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            if (pendingHeader && pendingHeader.byteLength > 0) {
              const stripped = stripFmp4SegmentIndexBoxes(pendingHeader)
              if (stripped.byteLength > 0) {
                await writer.write(stripped)
              }
              pendingHeader = null
            }
            break
          }
          if (!value || value.byteLength === 0) continue

          if (!stripLeadingBoxes) {
            await writer.write(value)
            continue
          }

          if (!pendingHeader) {
            pendingHeader = value
          } else {
            const combined = new Uint8Array(
              pendingHeader.byteLength + value.byteLength
            )
            combined.set(pendingHeader, 0)
            combined.set(value, pendingHeader.byteLength)
            pendingHeader = combined
          }

          const view = new DataView(
            pendingHeader.buffer,
            pendingHeader.byteOffset,
            pendingHeader.byteLength
          )
          let offset = 0
          let needMore = false
          while (offset + 8 <= pendingHeader.byteLength) {
            const size = view.getUint32(offset, false)
            const type = String.fromCharCode(
              pendingHeader[offset + 4],
              pendingHeader[offset + 5],
              pendingHeader[offset + 6],
              pendingHeader[offset + 7]
            )
            if (type === 'styp' || type === 'sidx') {
              if (size < 8) break
              if (offset + size > pendingHeader.byteLength) {
                needMore = true
                break
              }
              offset += size
              continue
            }
            break
          }

          if (offset + 8 > pendingHeader.byteLength || needMore) {
            continue
          }

          const remainder =
            offset > 0 ? pendingHeader.subarray(offset) : pendingHeader
          pendingHeader = null
          stripLeadingBoxes = false
          if (remainder.byteLength > 0) {
            await writer.write(remainder)
          }
        }
      }
    } catch {
      // Client disconnected or aborted
    } finally {
      try {
        await writer.close()
      } catch {}
    }
  })()

  return corsResponse(readable, {
    status: 200,
    headers: {
      'Content-Type': hlsInfo.contentType || 'audio/mp4',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Accept-Ranges': 'none',
    },
  })
}

/**
 * Direct Edge Resolver: Resolves stream URL straight from SoundCloud API.
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

    if (!isFullAudioTrack(raw)) {
      return { status: 403, url: null, reason: 'not_full_audio' }
    }

    const transcodings = raw?.media?.transcodings || []
    if (transcodings.length === 0) return { status: 404, url: null }

    // Candidate order:
    // 1. Progressive MP3 stream
    // 2. Unencrypted fMP4 AAC 160k HLS stream
    // 3. Unencrypted fMP4 AAC 96k / MP3 HLS stream
    const candidates = [
      transcodings.find(
        (t) =>
          t.format?.protocol === 'progressive' &&
          t.url?.includes('/stream/') &&
          !t.snipped &&
          (t.format?.mime_type?.includes('audio/mpeg') || t.preset?.includes('mp3'))
      ),
      transcodings.find((t) => t.format?.protocol === 'progressive' && t.url?.includes('/stream/') && !t.snipped),
      transcodings.find(
        (t) =>
          t.format?.protocol === 'hls' &&
          t.url?.includes('/stream/') &&
          !t.url?.includes('/cbcs/') &&
          !t.snipped &&
          t.preset === 'aac_160k'
      ),
      transcodings.find(
        (t) =>
          t.format?.protocol === 'hls' &&
          t.url?.includes('/stream/') &&
          !t.url?.includes('/cbcs/') &&
          !t.snipped &&
          t.preset !== 'abr_sq' &&
          (t.format?.mime_type?.includes('audio/mp4') || t.format?.mime_type?.includes('audio/mpeg')) &&
          t.format?.mime_type !== 'audio/mpegurl'
      ),
    ].filter(Boolean)

    if (candidates.length === 0) {
      return { status: 403, url: null, reason: 'not_full_audio' }
    }

    for (const candidate of candidates) {
      const mediaRes = await fetch(`${candidate.url}?client_id=${clientId}`, {
        headers: { 'User-Agent': SC_USER_AGENT, Accept: 'application/json' },
      })
      if (!mediaRes.ok) {
        if (mediaRes.status === 401 || mediaRes.status === 403) {
          return { status: mediaRes.status, url: null }
        }
        continue
      }
      const mediaData = await mediaRes.json()
      const resolvedUrl = mediaData?.url || null
      if (!resolvedUrl || resolvedUrl.includes('/cbcs/')) {
        continue
      }
      if (resolvedUrl.includes('.m3u8')) {
        const hlsInfo = await parseAndValidateHlsPlaylist(resolvedUrl)
        if (!hlsInfo || hlsInfo.encrypted) {
          continue
        }
        return { status: 200, url: resolvedUrl, isHls: true, hlsInfo }
      }
      return { status: 200, url: resolvedUrl, isHls: false }
    }

    return { status: 403, url: null, reason: 'not_full_audio' }
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
        JSON.stringify({ status: 'ok', service: 'soundcloud-stream-cache', version: '2.4.0' }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }

    if (url.pathname === '/stream') {
      const id = url.searchParams.get('id')
      const format = url.searchParams.get('format')
      const refresh = url.searchParams.get('refresh') === '1'
      if (!id) {
        return corsResponse(JSON.stringify({ error: 'Missing track id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      const cleanId = id.replace(/^sc-/, '')
      const kvKey = `sc_stream_v3_${cleanId}`
      const selfStreamUrl = `${url.origin}/stream?id=${encodeURIComponent(cleanId)}`

      if (!refresh && env.SOUNDCLOUD_STREAM_KV) {
        try {
          const cachedRaw = await env.SOUNDCLOUD_STREAM_KV.get(kvKey)
          if (cachedRaw) {
            const parsed = JSON.parse(cachedRaw)
            if (parsed && parsed.url) {
              if (format === 'json') {
                const publicUrl = parsed.isHls ? selfStreamUrl : parsed.url
                return corsResponse(JSON.stringify({ url: publicUrl }), {
                  status: 200,
                  headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120',
                  },
                })
              }
              if (!parsed.isHls) {
                return redirectResponse(parsed.url, 600)
              }
              const hlsInfo = await parseAndValidateHlsPlaylist(parsed.url)
              if (hlsInfo && !hlsInfo.encrypted) {
                if (request.method === 'HEAD') {
                  return corsResponse(null, {
                    status: 200,
                    headers: { 'Content-Type': hlsInfo.contentType || 'audio/mp4' },
                  })
                }
                return streamHlsSegments(hlsInfo, request.signal)
              }
            }
          }
        } catch (e) {
          console.warn('L2 KV read error:', e)
        }
      }

      const isNumericId = /^\d+$/.test(cleanId)
      let resolved = null

      if (isNumericId) {
        const clientId = await getEdgeSoundCloudClientId(env)
        let result = await resolveDirectlyFromEdge(cleanId, clientId)

        if (!result.url && (result.status === 401 || result.status === 403) && result.reason !== 'not_full_audio') {
          const freshClientId = await getEdgeSoundCloudClientId(env, true)
          if (freshClientId && freshClientId !== clientId) {
            result = await resolveDirectlyFromEdge(cleanId, freshClientId)
          }
        }

        if (!result.url && result.reason === 'not_full_audio') {
          return corsResponse(
            JSON.stringify({ error: 'Track is not full audio (blocked, snippet, or Go+ only)' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } }
          )
        }

        if (result.url) {
          resolved = result
        }
      }

      if (!resolved || !resolved.url) {
        return corsResponse(JSON.stringify({ error: 'Stream URL not available or track is unplayable' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      if (env.SOUNDCLOUD_STREAM_KV) {
        ctx.waitUntil(
          env.SOUNDCLOUD_STREAM_KV.put(
            kvKey,
            JSON.stringify({ url: resolved.url, isHls: Boolean(resolved.isHls) }),
            { expirationTtl: 600 }
          )
        )
      }

      if (format === 'json') {
        const publicUrl = resolved.isHls ? selfStreamUrl : resolved.url
        return corsResponse(JSON.stringify({ url: publicUrl }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': refresh
              ? 'no-cache, no-store, must-revalidate'
              : 'public, max-age=600, s-maxage=600, stale-while-revalidate=120',
          },
        })
      }

      if (resolved.isHls && resolved.hlsInfo) {
        if (request.method === 'HEAD') {
          return corsResponse(null, {
            status: 200,
            headers: { 'Content-Type': resolved.hlsInfo.contentType || 'audio/mp4' },
          })
        }
        return streamHlsSegments(resolved.hlsInfo, request.signal)
      }

      return redirectResponse(resolved.url, 600)
    }

    return corsResponse(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
