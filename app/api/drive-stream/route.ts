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
    // filename/title do client truyền lên để xác định đúng Content-Type
    // (xem lib/player/PlayerContext.tsx -> getAudioUrl())
    const titleParam = searchParams.get('filename') || searchParams.get('title') || ''

    if (!fileId) {
      return NextResponse.json({ error: 'Missing fileId parameter' }, { status: 400 })
    }

    try {
      supabase = getServiceClient()
    } catch (envErr) {
      console.warn('Supabase service client init failed, cache bền vững sẽ bị bỏ qua:', envErr)
    }

    const rangeHeader = req.headers.get('range')
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    }
    if (rangeHeader) {
      headers['Range'] = rangeHeader
    }

    const directCdnUrls: string[] = []

    // 1. Cache bền vững từ Supabase — sống sót qua cold start, chia sẻ giữa mọi instance/region
    const cachedCdn = supabase ? await getCachedCdnUrl(fileId, supabase) : null
    if (cachedCdn) {
      directCdnUrls.push(cachedCdn.url)
    }

    // 2. Các endpoint CDN tốc độ cao dự phòng
    directCdnUrls.push(
      `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`,
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}&confirm=t`
    )

    let res: Response | null = null
    let contentType = ''

    // 🚀 Stage 1: Thử các endpoint CDN nhanh trước
    for (const cdnUrl of directCdnUrls) {
      try {
        const testRes = await fetch(cdnUrl, { headers, cache: 'no-store', redirect: 'follow' })
        const testCt = testRes.headers.get('content-type') || ''
        if ((testRes.ok || testRes.status === 206) && !testCt.includes('text/html')) {
          res = testRes
          contentType = testCt
          // Ghi lại cache bền vững — request tiếp theo (kể cả từ cold start khác) dùng lại ngay
          if (supabase) {
            saveCdnUrl(fileId, cdnUrl, testCt, supabase).catch(() => {})
          }
          break
        }
      } catch (err) {
        console.warn('Direct CDN fetch attempt warning:', err)
      }
    }

    // 🐢 Stage 2: Fallback qua trang cảnh báo virus (file lớn >25MB, thường gặp với FLAC)
    if (!res) {
      const fallbackUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
      const testRes = await fetch(fallbackUrl, { headers, cache: 'no-store', redirect: 'follow' })
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
          responseText.match(/uuid=([a-zA-Z0-9_-]+)/)

        const warningCookie = decodeCookieConfirmToken(rawCookies)
        const confirmToken = confirmMatch?.[1] || warningCookie || 't'

        const fetchHeaders: Record<string, string> = {
          ...headers,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        }

        const confirmUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
          fileId
        )}&export=download&confirm=${confirmToken}`
        const res2 = await fetch(confirmUrl, { headers: fetchHeaders, cache: 'no-store', redirect: 'follow' })
        const ct2 = res2.headers.get('content-type') || ''

        if (!ct2.includes('text/html') && (res2.ok || res2.status === 206)) {
          res = res2
          contentType = ct2
          if (supabase) {
            // Lưu ý: confirmUrl phụ thuộc cookie phiên, có thể hết hạn sớm hơn CDN tĩnh —
            // vẫn cache để tránh phải parse lại HTML mỗi request, TTL 1h đã đủ an toàn.
            saveCdnUrl(fileId, confirmUrl, ct2, supabase).catch(() => {})
          }
        }
      } else if (testRes.ok || testRes.status === 206) {
        res = testRes
        contentType = testCt
      }
    }

    if (!res || (!res.ok && res.status !== 206)) {
      return NextResponse.json(
        { error: `Google Drive error (HTTP ${res ? res.status : 500})` },
        { status: res ? res.status : 500 }
      )
    }

    // Xác định đúng MIME type audio, ưu tiên filename do client truyền lên
    const contentDisposition = res.headers.get('content-disposition') || ''
    const finalContentType = detectContentType({
      fetchedContentType: contentType || res.headers.get('content-type') || '',
      titleParam,
      contentDisposition,
    })

    const responseHeaders = new Headers()
    responseHeaders.set('Content-Type', finalContentType)
    responseHeaders.set('Accept-Ranges', 'bytes')
    responseHeaders.set('Access-Control-Allow-Origin', '*')
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    responseHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type')
    responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable')
    responseHeaders.set('ETag', `W/"drive-${fileId}"`)

    const contentLength = res.headers.get('content-length')
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength)
    }

    const contentRange = res.headers.get('content-range')
    if (contentRange) {
      responseHeaders.set('Content-Range', contentRange)
    }

    const status = res.status === 206 || rangeHeader ? 206 : 200

    return new Response(res.body, {
      status,
      headers: responseHeaders,
    })
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
