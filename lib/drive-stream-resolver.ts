import { createClient } from '@supabase/supabase-js'

// ⚡ Cache TTL cho CDN URL đã xác minh (45 phút — Google CDN URLs expire in ~1h)
export const CDN_CACHE_TTL_MS = 45 * 60 * 1000

// In-memory CDN URL cache — checked FIRST so repeated plays / range requests skip
// the Supabase queries AND the HEAD validation entirely (both live on the critical path).
const memoryCdnCache = new Map<string, { url: string; contentType: string; expiresAt: number }>()

export function getMemoryCachedCdnUrl(fileId: string): { url: string; contentType: string } | null {
  const entry = memoryCdnCache.get(fileId)
  if (entry && Date.now() < entry.expiresAt) {
    return { url: entry.url, contentType: entry.contentType }
  }
  return null
}

export function setMemoryCachedCdnUrl(fileId: string, url: string, contentType: string) {
  memoryCdnCache.set(fileId, { url, contentType, expiresAt: Date.now() + CDN_CACHE_TTL_MS })
}

export function clearMemoryCachedCdnUrl(fileId: string) {
  memoryCdnCache.delete(fileId)
}

// Service-role client để đọc/ghi cache mà không bị chặn bởi RLS
export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.warn('getServiceClient warning: Thiếu SUPABASE_SERVICE_ROLE_KEY (Bỏ qua DB CDN caching)')
    return null
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
}

interface CachedCdnEntry {
  url: string
  contentType: string
}

export async function getCachedCdnUrl(
  fileId: string,
  supabase: ReturnType<typeof getServiceClient>
): Promise<CachedCdnEntry | null> {
  if (!supabase) return null
  try {
    let { data } = await supabase
      .from('tracks')
      .select('drive_stream_url, drive_stream_content_type, drive_stream_cached_at')
      .eq('drive_file_id', fileId)
      .maybeSingle()

    if (!data?.drive_stream_url) {
      const { data: altData } = await supabase
        .from('tracks')
        .select('drive_stream_url, drive_stream_content_type, drive_stream_cached_at')
        .ilike('file_path', `%${fileId}%`)
        .limit(1)
        .maybeSingle()
      data = altData
    }

    if (!data?.drive_stream_url || !data.drive_stream_cached_at) return null

    const isFresh = Date.now() - new Date(data.drive_stream_cached_at).getTime() < CDN_CACHE_TTL_MS
    if (!isFresh) return null

    // ⚡ Validate cached URL in the background (non-blocking): the play path must not
    // wait for a HEAD round-trip. If the URL turns out dead, the stream route re-resolves.
    try {
      fetch(data.drive_stream_url, {
        method: 'HEAD',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(1500),
      })
        .then((checkRes) => {
          const ct = checkRes.headers.get('content-type') || ''
          if (!(checkRes.ok || checkRes.status === 206) || ct.includes('text/html')) {
            memoryCdnCache.delete(fileId)
          }
        })
        .catch(() => {
          memoryCdnCache.delete(fileId)
        })
    } catch {}

    return {
      url: data.drive_stream_url,
      contentType: data.drive_stream_content_type || 'audio/mpeg',
    }
  } catch (err) {
    console.warn('getCachedCdnUrl error (continuing to probe):', err)
    return null
  }
}

export async function saveCdnUrl(
  fileId: string,
  url: string,
  contentType: string,
  supabase: ReturnType<typeof getServiceClient>
) {
  if (!supabase) return
  try {
    const updatePayload = {
      drive_stream_url: url,
      drive_stream_content_type: contentType,
      drive_stream_cached_at: new Date().toISOString(),
    }

    const { count } = await supabase
      .from('tracks')
      .update(updatePayload, { count: 'exact' })
      .eq('drive_file_id', fileId)

    if (!count || count === 0) {
      await supabase
        .from('tracks')
        .update(updatePayload)
        .ilike('file_path', `%${fileId}%`)
    }
  } catch (err) {
    console.warn('saveCdnUrl error:', err)
  }
}

export function detectContentType(opts: {
  fetchedContentType: string
  titleParam?: string
  contentDisposition?: string
}): string {
  const { fetchedContentType, titleParam = '', contentDisposition = '' } = opts
  const lowerTitle = titleParam.toLowerCase()
  const lowerDisposition = contentDisposition.toLowerCase()

  if (lowerTitle.endsWith('.flac') || lowerDisposition.includes('.flac') || fetchedContentType.includes('flac')) {
    return 'audio/flac'
  }
  if (lowerTitle.endsWith('.wav') || lowerDisposition.includes('.wav')) {
    return 'audio/wav'
  }
  if (
    lowerTitle.endsWith('.m4a') ||
    lowerTitle.endsWith('.aac') ||
    lowerDisposition.includes('.m4a') ||
    lowerDisposition.includes('.aac')
  ) {
    return 'audio/mp4'
  }
  if (lowerTitle.endsWith('.ogg') || lowerDisposition.includes('.ogg')) {
    return 'audio/ogg'
  }
  if (
    lowerTitle.endsWith('.mp3') ||
    lowerDisposition.includes('.mp3') ||
    fetchedContentType === 'application/octet-stream' ||
    fetchedContentType.includes('html') ||
    (!fetchedContentType && !lowerTitle)
  ) {
    return 'audio/mpeg'
  }
  return fetchedContentType || 'audio/mpeg'
}

export function decodeCookieConfirmToken(rawCookies: string[]): string | undefined {
  return rawCookies.join('; ').match(/download_warning_[^=]+=([^;]+)/)?.[1]
}

/**
 * Pure Drive stream resolver function used by /api/drive-stream, /api/drive-stream/prewarm, and Cron job.
 * Returns resolved URL, content-type and fromCache flag.
 */
export async function resolveDriveStreamUrl(
  fileId: string,
  supabaseClient?: ReturnType<typeof getServiceClient>,
  filenameHint?: string
): Promise<{ url: string; contentType: string; fromCache: boolean } | null> {
  if (!fileId) return null

  let supabase = supabaseClient
  if (!supabase) {
    try {
      supabase = getServiceClient()
    } catch {
      supabase = undefined
    }
  }

  // ⚡ 0. In-memory cache first — zero-latency repeat plays & range requests
  const memoryHit = getMemoryCachedCdnUrl(fileId)
  if (memoryHit && memoryHit.url) {
    return {
      url: memoryHit.url,
      contentType: memoryHit.contentType || 'audio/mpeg',
      fromCache: true,
    }
  }

  // ⚡ 1. Check Supabase DB cache next
  if (supabase) {
    const cachedCdn = await getCachedCdnUrl(fileId, supabase)
    if (cachedCdn && cachedCdn.url) {
      setMemoryCachedCdnUrl(fileId, cachedCdn.url, cachedCdn.contentType || 'audio/mpeg')
      return {
        url: cachedCdn.url,
        contentType: cachedCdn.contentType || 'audio/mpeg',
        fromCache: true,
      }
    }
  }

  const UA_HEADER =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

  // 🚀 2. Parallel Probe: Check high-speed CDN URLs in parallel (100-200ms)
  const candidateCdnUrls = [
    `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
    `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`,
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}&confirm=t`,
  ]

  const probePromises = candidateCdnUrls.map((cdnUrl) =>
    fetch(cdnUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': UA_HEADER },
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(4000),
    }).then((res) => {
      const ct = res.headers.get('content-type') || ''
      if ((res.ok || res.status === 206) && !ct.includes('text/html')) {
        return { cdnUrl: res.url || cdnUrl, contentType: ct }
      }
      throw new Error('Not direct audio')
    })
  )

  try {
    const winner = await Promise.any(probePromises)
    if (winner && winner.cdnUrl) {
      const finalCt = detectContentType({
        fetchedContentType: winner.contentType,
        titleParam: filenameHint,
      })
      setMemoryCachedCdnUrl(fileId, winner.cdnUrl, finalCt)
      if (supabase) {
        saveCdnUrl(fileId, winner.cdnUrl, finalCt, supabase).catch(() => {})
      }
      return {
        url: winner.cdnUrl,
        contentType: finalCt,
        fromCache: false,
      }
    }
  } catch {
    // All parallel probes failed or returned virus warning page
  }

  // 🐢 3. Fallback: Parse virus warning confirmation token for large files (>25MB, e.g. FLAC)
  try {
    const fallbackUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
    const headers: Record<string, string> = { 'User-Agent': UA_HEADER }

    const testRes = await fetch(fallbackUrl, {
      headers,
      cache: 'no-store',
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
    })
    const testCt = testRes.headers.get('content-type') || ''

    if (testCt.includes('text/html')) {
      const responseText = await testRes.text()
      const rawCookies: string[] = (testRes.headers as any).getSetCookie
        ? (testRes.headers as any).getSetCookie()
        : ([testRes.headers.get('set-cookie')].filter(Boolean) as string[])

      const cookieHeader = rawCookies.map((c: string) => c.split(';')[0]).join('; ')
      const confirmMatch =
        responseText.match(/confirm=([a-zA-Z0-9_-]+)/) ||
        responseText.match(/name="confirm"\s+value="([a-zA-Z0-9_-]+)"/) ||
        responseText.match(/href="[^"]*confirm=([a-zA-Z0-9_-]+)"/) ||
        responseText.match(/uuid=([a-zA-Z0-9_-]+)/) ||
        responseText.match(/at=([a-zA-Z0-9_-]+)/)

      const warningCookie = decodeCookieConfirmToken(rawCookies)
      const confirmToken = confirmMatch?.[1] || warningCookie || 't'

      const confirmUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
        fileId
      )}&export=download&confirm=${confirmToken}`

      const fetchHeaders: Record<string, string> = {
        ...headers,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      }
      const res2 = await fetch(confirmUrl, {
        headers: fetchHeaders,
        cache: 'no-store',
        redirect: 'follow',
        signal: AbortSignal.timeout(6000),
      })
      const ct2 = res2.headers.get('content-type') || ''

      if (!ct2.includes('text/html') && (res2.ok || res2.status === 206)) {
        const contentDisposition = res2.headers.get('content-disposition') || ''
        const finalCt = detectContentType({
          fetchedContentType: ct2,
          titleParam: filenameHint,
          contentDisposition,
        })
        if (supabase) {
          saveCdnUrl(fileId, confirmUrl, finalCt, supabase).catch(() => {})
        }
        setMemoryCachedCdnUrl(fileId, confirmUrl, finalCt)
        return {
          url: confirmUrl,
          contentType: finalCt,
          fromCache: false,
        }
      }
    } else if (testRes.ok || testRes.status === 206) {
      const finalCdnUrl = testRes.url || fallbackUrl
      const finalCt = detectContentType({
        fetchedContentType: testCt,
        titleParam: filenameHint,
      })
      if (supabase) {
        saveCdnUrl(fileId, finalCdnUrl, finalCt, supabase).catch(() => {})
      }
      setMemoryCachedCdnUrl(fileId, finalCdnUrl, finalCt)
      return {
        url: finalCdnUrl,
        contentType: finalCt,
        fromCache: false,
      }
    }
  } catch (err) {
    console.warn('Fallback resolve error for fileId:', fileId, err)
  }

  return null
}
