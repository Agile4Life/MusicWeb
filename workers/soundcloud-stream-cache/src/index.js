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

function parseFmp4SegmentSidx(segmentBytes) {
  if (!(segmentBytes instanceof Uint8Array) || segmentBytes.byteLength < 24) {
    return null
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
    if (type === 'sidx' && size >= 24) {
      const version = segmentBytes[offset + 8]
      const timescale = view.getUint32(offset + 16, false)
      const countOffset = offset + 20 + (version === 0 ? 8 : 16) + 2
      if (countOffset + 2 > offset + size) return null
      const refCount = view.getUint16(countOffset, false)
      let totalDuration = 0
      let refPos = countOffset + 2
      for (let i = 0; i < refCount && refPos + 12 <= offset + size; i++) {
        totalDuration += view.getUint32(refPos + 4, false)
        refPos += 12
      }
      if (timescale > 0 && totalDuration > 0) {
        return { subsegmentDuration: totalDuration, timescale }
      }
      return null
    }
    if (type === 'moof') break
    offset += size
  }
  return null
}

function buildMasterFmp4SidxBox(segments, timescale = 44100) {
  const count = segments.length
  const safeTimescale = timescale > 0 ? timescale : 44100
  const boxSize = 32 + count * 12
  const out = new Uint8Array(boxSize)
  const view = new DataView(out.buffer)
  view.setUint32(0, boxSize, false)
  out[4] = 0x73 // 's'
  out[5] = 0x69 // 'i'
  out[6] = 0x64 // 'd'
  out[7] = 0x78 // 'x'
  view.setUint32(8, 0, false) // version 0, flags 0
  view.setUint32(12, 1, false) // reference_id = 1
  view.setUint32(16, safeTimescale, false)
  view.setUint32(20, 0, false) // earliest_presentation_time = 0
  view.setUint32(24, 0, false) // first_offset = 0
  view.setUint16(28, 0, false) // reserved = 0
  view.setUint16(30, count, false)

  let pos = 32
  for (const seg of segments) {
    view.setUint32(pos, seg.byteLength & 0x7fffffff, false)
    view.setUint32(pos + 4, seg.durationTicks >>> 0, false)
    view.setUint32(pos + 8, 0x90000000, false)
    pos += 12
  }
  return out
}

const edgeHlsBufferCache = new Map()
const edgeInFlightHlsBuffer = new Map()
const EDGE_HLS_CACHE_MAX_ENTRIES = 8
const EDGE_HLS_CACHE_TTL_MS = 10 * 60 * 1000

async function assembleEdgeHlsMedia(cleanId, hlsInfo, bypassCache = false, requestSignal) {
  const cacheKey = String(cleanId || '')
  const now = Date.now()
  if (bypassCache) {
    edgeHlsBufferCache.delete(cacheKey)
    edgeInFlightHlsBuffer.delete(cacheKey)
  } else {
    const cached = edgeHlsBufferCache.get(cacheKey)
    if (cached && now < cached.expiresAt) {
      edgeHlsBufferCache.delete(cacheKey)
      edgeHlsBufferCache.set(cacheKey, cached)
      return cached
    }
    const existing = edgeInFlightHlsBuffer.get(cacheKey)
    if (existing) return existing
  }

  const promise = (async () => {
    try {
      const buffers = await Promise.all(
        hlsInfo.urls.map(async (segUrl) => {
          const segRes = await fetch(segUrl, {
            headers: { 'User-Agent': SC_USER_AGENT },
            signal: requestSignal,
          })
          if (!segRes.ok) {
            throw new Error(`Segment fetch failed: ${segRes.status}`)
          }
          return new Uint8Array(await segRes.arrayBuffer())
        })
      )

      const isFmp4 =
        Boolean(hlsInfo.hasInitMap) || hlsInfo.contentType === 'audio/mp4'
      let assembled
      let contentType = hlsInfo.contentType || 'audio/mp4'

      if (isFmp4 && buffers.length >= 2) {
        let timescale = 44100
        let totalDurationTicks = 0
        const strippedSegments = []
        const segMeta = []

        for (let i = 1; i < buffers.length; i++) {
          const sidxInfo = parseFmp4SegmentSidx(buffers[i])
          if (sidxInfo && sidxInfo.timescale) {
            timescale = sidxInfo.timescale
          }
          const stripped = stripFmp4SegmentIndexBoxes(buffers[i])
          const durationTicks =
            (sidxInfo && sidxInfo.subsegmentDuration) || Math.round(10 * timescale)
          totalDurationTicks += durationTicks
          strippedSegments.push(stripped)
          segMeta.push({ byteLength: stripped.byteLength, durationTicks })
        }

        const exactDurationSeconds =
          totalDurationTicks > 0 && timescale > 0
            ? totalDurationTicks / timescale
            : hlsInfo.durationSeconds || 0
        const initPatched = patchInitMp4Duration(buffers[0], exactDurationSeconds)
        const masterSidx = buildMasterFmp4SidxBox(segMeta, timescale)

        let totalBytes = initPatched.byteLength + masterSidx.byteLength
        for (const seg of strippedSegments) totalBytes += seg.byteLength

        assembled = new Uint8Array(totalBytes)
        let writeOffset = 0
        assembled.set(initPatched, writeOffset)
        writeOffset += initPatched.byteLength
        assembled.set(masterSidx, writeOffset)
        writeOffset += masterSidx.byteLength
        for (const seg of strippedSegments) {
          assembled.set(seg, writeOffset)
          writeOffset += seg.byteLength
        }
      } else {
        contentType = hlsInfo.contentType || 'audio/mpeg'
        let totalBytes = 0
        for (const seg of buffers) totalBytes += seg.byteLength
        assembled = new Uint8Array(totalBytes)
        let writeOffset = 0
        for (const seg of buffers) {
          assembled.set(seg, writeOffset)
          writeOffset += seg.byteLength
        }
      }

      const entry = {
        buffer: assembled,
        contentType,
        expiresAt: Date.now() + EDGE_HLS_CACHE_TTL_MS,
      }
      if (edgeHlsBufferCache.size >= EDGE_HLS_CACHE_MAX_ENTRIES) {
        const oldestKey = edgeHlsBufferCache.keys().next().value
        if (oldestKey !== undefined) edgeHlsBufferCache.delete(oldestKey)
      }
      edgeHlsBufferCache.set(cacheKey, entry)
      return entry
    } catch {
      return null
    } finally {
      edgeInFlightHlsBuffer.delete(cacheKey)
    }
  })()

  if (!bypassCache) {
    edgeInFlightHlsBuffer.set(cacheKey, promise)
  }
  return promise
}

function parseByteRange(rangeHeader, totalSize) {
  if (!rangeHeader || totalSize <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim())
  if (!match || (match[1] === '' && match[2] === '')) return null

  let start
  let end
  if (match[1] === '') {
    const suffixLength = Number.parseInt(match[2], 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    start = Math.max(0, totalSize - suffixLength)
    end = totalSize - 1
  } else {
    start = Number.parseInt(match[1], 10)
    if (!Number.isFinite(start) || start < 0) return null
    end =
      match[2] === ''
        ? totalSize - 1
        : Math.min(Number.parseInt(match[2], 10), totalSize - 1)
  }

  if (!Number.isFinite(end) || start >= totalSize || start > end) {
    return { unsatisfiable: true }
  }
  return { start, end }
}

async function serveSeekableHlsResponse(cleanId, hlsInfo, request, bypassCache = false) {
  const media = await assembleEdgeHlsMedia(cleanId, hlsInfo, bypassCache, request.signal)
  if (!media) {
    return corsResponse(JSON.stringify({ error: 'Failed to assemble HLS media' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const total = media.buffer.byteLength
  const isHead = request.method === 'HEAD'
  const baseHeaders = {
    'Content-Type': media.contentType || 'audio/mp4',
    'Accept-Ranges': 'bytes',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
    'Cache-Control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=120',
    ETag: `"sc-hls-${cleanId}-${total}"`,
  }

  const parsedRange = parseByteRange(request.headers.get('Range'), total)
  if (parsedRange && parsedRange.unsatisfiable) {
    return corsResponse(null, {
      status: 416,
      headers: { ...baseHeaders, 'Content-Range': `bytes */${total}` },
    })
  }

  if (parsedRange) {
    const { start, end } = parsedRange
    const chunkLength = end - start + 1
    const headers = {
      ...baseHeaders,
      'Content-Length': String(chunkLength),
      'Content-Range': `bytes ${start}-${end}/${total}`,
    }
    if (isHead) return corsResponse(null, { status: 206, headers })
    return corsResponse(media.buffer.subarray(start, end + 1), { status: 206, headers })
  }

  const headers = {
    ...baseHeaders,
    'Content-Length': String(total),
  }
  if (isHead) return corsResponse(null, { status: 200, headers })
  return corsResponse(media.buffer, { status: 200, headers })
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
                return serveSeekableHlsResponse(cleanId, hlsInfo, request, false)
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
        return serveSeekableHlsResponse(cleanId, resolved.hlsInfo, request, refresh)
      }

      return redirectResponse(resolved.url, 600)
    }

    return corsResponse(JSON.stringify({ error: 'Not Found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  },
}
