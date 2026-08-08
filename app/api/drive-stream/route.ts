import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ⚡ Cache TTL cho CDN URL đã xác minh hoạt động (lưu bền vững trong Supabase,
// sống sót qua cold start của serverless function — khác với Map in-memory cũ)
const CDN_CACHE_TTL_MS = 60 * 60 * 1000 // 1 giờ

// Service-role client để đọc/ghi cache mà không bị chặn bởi RLS.
// BẮT BUỘC: đặt SUPABASE_SERVICE_ROLE_KEY trong biến môi trường server
// (KHÔNG bao giờ expose biến này ra client/NEXT_PUBLIC_*)
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong env')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  })
}

interface CachedCdnEntry {
  url: string
  contentType: string
}

async function getCachedCdnUrl(
  fileId: string,
  supabase: ReturnType<typeof getServiceClient>
): Promise<CachedCdnEntry | null> {
  try {
    const { data, error } = await supabase
      .from('tracks')
      .select('drive_stream_url, drive_stream_content_type, drive_stream_cached_at')
      .eq('drive_file_id', fileId)
      .maybeSingle()

    if (error || !data?.drive_stream_url || !data.drive_stream_cached_at) return null

    const isFresh = Date.now() - new Date(data.drive_stream_cached_at).getTime() < CDN_CACHE_TTL_MS
    if (!isFresh) return null

    return {
      url: data.drive_stream_url,
      contentType: data.drive_stream_content_type || '',
    }
  } catch (err) {
    console.warn('getCachedCdnUrl error (bỏ qua, tiếp tục dò CDN):', err)
    return null
  }
}

async function saveCdnUrl(
  fileId: string,
  url: string,
  contentType: string,
  supabase: ReturnType<typeof getServiceClient>
) {
  try {
    await supabase
      .from('tracks')
      .update({
        drive_stream_url: url,
        drive_stream_content_type: contentType,
        drive_stream_cached_at: new Date().toISOString(),
      })
      .eq('drive_file_id', fileId)
  } catch (err) {
    // Không throw — lỗi ghi cache không nên làm hỏng response stream đang trả về user
    console.warn('saveCdnUrl error (không ảnh hưởng tới stream hiện tại):', err)
  }
}

function detectContentType(opts: {
  fetchedContentType: string
  titleParam: string
  contentDisposition: string
}): string {
  const { fetchedContentType, titleParam, contentDisposition } = opts
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

function decodeCookieConfirmToken(rawCookies: string[]): string | undefined {
  return rawCookies.join('; ').match(/download_warning_[^=]+=([^;]+)/)?.[1]
}

export async function GET(req: NextRequest) {
  let supabase: ReturnType<typeof getServiceClient> | null = null
  try {
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('id') || searchParams.get('fileId')
    const titleParam = searchParams.get('filename') || searchParams.get('title') || ''

    if (!fileId) {
      return NextResponse.json({ error: 'Missing fileId parameter' }, { status: 400 })
    }

    try {
      supabase = getServiceClient()
    } catch (envErr) {
      console.warn('Supabase service client init failed:', envErr)
    }

    const UA_HEADER =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

    // ⚡ Build list of candidate CDN URLs (ordered by priority)
    const directCdnUrls: string[] = []

    // 1. Persistent Supabase cache — survives cold starts, shared across all instances
    const cachedCdn = supabase ? await getCachedCdnUrl(fileId, supabase) : null
    if (cachedCdn) {
      directCdnUrls.push(cachedCdn.url)
    }

    // 2. High-speed CDN endpoints
    directCdnUrls.push(
      `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`,
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}&confirm=t`
    )

    // 🚀 Stage 1: Probe CDN URLs with HEAD requests (tiny bandwidth, fast)
    // Then REDIRECT client directly to the working CDN URL — ZERO bandwidth through Vercel!
    for (const cdnUrl of directCdnUrls) {
      try {
        const testRes = await fetch(cdnUrl, {
          method: 'HEAD',
          headers: { 'User-Agent': UA_HEADER },
          cache: 'no-store',
          redirect: 'follow',
        })
        const testCt = testRes.headers.get('content-type') || ''
        if ((testRes.ok || testRes.status === 206) && !testCt.includes('text/html')) {
          // ✅ CDN URL works — save to persistent cache & redirect client
          if (supabase) {
            saveCdnUrl(fileId, cdnUrl, testCt, supabase).catch(() => {})
          }
          // 302 Redirect: browser fetches audio directly from Google CDN
          // This saves ~5-20MB of Fast Origin Transfer PER song play!
          const redirectHeaders = new Headers()
          redirectHeaders.set('Location', cdnUrl)
          redirectHeaders.set('Access-Control-Allow-Origin', '*')
          redirectHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
          redirectHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type')
          redirectHeaders.set('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400')

          return new Response(null, { status: 302, headers: redirectHeaders })
        }
      } catch (err) {
        console.warn('CDN probe warning:', err)
      }
    }

    // 🐢 Stage 2: Fallback — virus warning page (files >25MB, e.g. FLAC)
    // Must proxy this because confirm flow requires cookies
    const fallbackUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
    const headers: Record<string, string> = { 'User-Agent': UA_HEADER }
    const rangeHeader = req.headers.get('range')
    if (rangeHeader) headers['Range'] = rangeHeader

    const testRes = await fetch(fallbackUrl, { headers, cache: 'no-store', redirect: 'follow' })
    const testCt = testRes.headers.get('content-type') || ''

    let finalCdnUrl: string | null = null

    if (testCt.includes('text/html')) {
      const responseText = await testRes.text()
      const rawCookies: string[] = (testRes.headers as any).getSetCookie
        ? (testRes.headers as any).getSetCookie()
        : ([testRes.headers.get('set-cookie')].filter(Boolean) as string[])

      const cookieHeader = rawCookies.map((c: string) => c.split(';')[0]).join('; ')
      const confirmMatch =
        responseText.match(/confirm=([a-zA-Z0-9_-]+)/) ||
        responseText.match(/name="confirm"\s+value="([a-zA-Z0-9_-]+)"/) ||
        responseText.match(/uuid=([a-zA-Z0-9_-]+)/)

      const warningCookie = decodeCookieConfirmToken(rawCookies)
      const confirmToken = confirmMatch?.[1] || warningCookie || 't'

      const confirmUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
        fileId
      )}&export=download&confirm=${confirmToken}`

      // For large files, we still need to proxy because confirm URL needs cookies
      const fetchHeaders: Record<string, string> = {
        ...headers,
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      }
      const res2 = await fetch(confirmUrl, { headers: fetchHeaders, cache: 'no-store', redirect: 'follow' })
      const ct2 = res2.headers.get('content-type') || ''

      if (!ct2.includes('text/html') && (res2.ok || res2.status === 206)) {
        if (supabase) {
          saveCdnUrl(fileId, confirmUrl, ct2, supabase).catch(() => {})
        }

        // Proxy only for this fallback case (large files needing cookies)
        const contentDisposition = res2.headers.get('content-disposition') || ''
        const finalContentType = detectContentType({
          fetchedContentType: ct2,
          titleParam,
          contentDisposition,
        })
        const responseHeaders = new Headers()
        responseHeaders.set('Content-Type', finalContentType)
        responseHeaders.set('Accept-Ranges', 'bytes')
        responseHeaders.set('Access-Control-Allow-Origin', '*')
        responseHeaders.set('Cache-Control', 'public, max-age=3600')
        const cl = res2.headers.get('content-length')
        if (cl) responseHeaders.set('Content-Length', cl)
        const cr = res2.headers.get('content-range')
        if (cr) responseHeaders.set('Content-Range', cr)

        return new Response(res2.body, {
          status: res2.status === 206 || rangeHeader ? 206 : 200,
          headers: responseHeaders,
        })
      }
    } else if (testRes.ok || testRes.status === 206) {
      // Direct download worked without virus warning — redirect!
      finalCdnUrl = testRes.url || fallbackUrl
      if (supabase) saveCdnUrl(fileId, finalCdnUrl, testCt, supabase).catch(() => {})

      const redirectHeaders = new Headers()
      redirectHeaders.set('Location', finalCdnUrl)
      redirectHeaders.set('Access-Control-Allow-Origin', '*')
      redirectHeaders.set('Cache-Control', 'public, max-age=3600')
      return new Response(null, { status: 302, headers: redirectHeaders })
    }

    return NextResponse.json(
      { error: 'Google Drive: could not resolve a playable stream URL' },
      { status: 502 }
    )
  } catch (err: any) {
    console.error('Drive stream proxy error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type',
    },
  })
}

export async function HEAD(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('id') || searchParams.get('fileId')

    if (!fileId) {
      return new NextResponse(null, { status: 400 })
    }

    const cdnUrl = `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`
    const res = await fetch(cdnUrl, {
      method: 'HEAD',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      return new NextResponse(null, { status: res.status })
    }

    const headers = new Headers()
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    headers.set('ETag', `W/"drive-${fileId}"`)
    const cl = res.headers.get('content-length')
    if (cl) headers.set('Content-Length', cl)

    return new NextResponse(null, { status: 200, headers })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
