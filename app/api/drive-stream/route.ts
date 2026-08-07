import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('id') || searchParams.get('fileId')

    if (!fileId) {
      return NextResponse.json({ error: 'Missing fileId parameter' }, { status: 400 })
    }

    // Range header from client (for HTML5 <audio> seeking and partial streaming)
    const rangeHeader = req.headers.get('range')
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    }
    if (rangeHeader) {
      headers['Range'] = rangeHeader
    }

    // ⚡ High-Speed Direct Google CDN Endpoints (Responds in < 100ms, zero HTML redirects)
    const directCdnUrls = [
      `https://lh3.googleusercontent.com/d/${encodeURIComponent(fileId)}`,
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`,
      `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}&confirm=t`,
    ]

    let res: Response | null = null
    let contentType = ''

    // 🚀 Stage 1: Try ultra-fast direct CDN endpoints first
    for (const cdnUrl of directCdnUrls) {
      try {
        const testRes = await fetch(cdnUrl, { headers, cache: 'no-store', redirect: 'follow' })
        const testCt = testRes.headers.get('content-type') || ''
        if ((testRes.ok || testRes.status === 206) && !testCt.includes('text/html')) {
          res = testRes
          contentType = testCt
          break
        }
      } catch (err) {
        console.warn('Direct CDN fetch attempt warning:', err)
      }
    }

    // 🐢 Stage 2: Fallback to virus warning HTML parser if CDN endpoints were blocked or returned HTML
    if (!res) {
      const fallbackUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
      const testRes = await fetch(fallbackUrl, { headers, cache: 'no-store', redirect: 'follow' })
      let testCt = testRes.headers.get('content-type') || ''

      if (testCt.includes('text/html')) {
        const responseText = await testRes.text()
        const rawCookies: string[] = (testRes.headers as any).getSetCookie
          ? (testRes.headers as any).getSetCookie()
          : [testRes.headers.get('set-cookie')].filter(Boolean) as string[]

        const cookieHeader = rawCookies.map((c: string) => c.split(';')[0]).join('; ')
        const confirmMatch =
          responseText.match(/confirm=([a-zA-Z0-9_-]+)/) ||
          responseText.match(/name="confirm"\s+value="([a-zA-Z0-9_-]+)"/) ||
          responseText.match(/uuid=([a-zA-Z0-9_-]+)/)

        const warningCookie = rawCookies.join('; ').match(/download_warning_[^=]+=([^;]+)/)?.[1]
        const confirmToken = confirmMatch?.[1] || warningCookie || 't'

        const fetchHeaders: Record<string, string> = {
          ...headers,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        }

        const confirmUrl = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=${confirmToken}`
        const res2 = await fetch(confirmUrl, { headers: fetchHeaders, cache: 'no-store', redirect: 'follow' })
        const ct2 = res2.headers.get('content-type') || ''

        if (!ct2.includes('text/html') && (res2.ok || res2.status === 206)) {
          res = res2
          contentType = ct2
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

    // Determine correct Audio MIME type
    let finalContentType = contentType || res.headers.get('content-type') || 'audio/mpeg'
    const contentDisposition = res.headers.get('content-disposition') || ''
    const titleParam = searchParams.get('filename') || searchParams.get('title') || ''

    if (
      titleParam.toLowerCase().endsWith('.flac') ||
      contentDisposition.toLowerCase().includes('.flac') ||
      finalContentType.includes('flac')
    ) {
      finalContentType = 'audio/flac'
    } else if (
      titleParam.toLowerCase().endsWith('.wav') ||
      contentDisposition.toLowerCase().includes('.wav')
    ) {
      finalContentType = 'audio/wav'
    } else if (
      titleParam.toLowerCase().endsWith('.m4a') ||
      titleParam.toLowerCase().endsWith('.aac') ||
      contentDisposition.toLowerCase().includes('.m4a')
    ) {
      finalContentType = 'audio/mp4'
    } else if (
      titleParam.toLowerCase().endsWith('.ogg') ||
      contentDisposition.toLowerCase().includes('.ogg')
    ) {
      finalContentType = 'audio/ogg'
    } else if (
      titleParam.toLowerCase().endsWith('.mp3') ||
      contentDisposition.toLowerCase().includes('.mp3') ||
      finalContentType === 'application/octet-stream' ||
      finalContentType.includes('html')
    ) {
      finalContentType = 'audio/mpeg'
    }

    // Build Response headers
    const responseHeaders = new Headers()
    responseHeaders.set('Content-Type', finalContentType)
    responseHeaders.set('Accept-Ranges', 'bytes')
    responseHeaders.set('Access-Control-Allow-Origin', '*')
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    responseHeaders.set('Access-Control-Allow-Headers', 'Range, Content-Type')
    responseHeaders.set('Cache-Control', 'public, max-age=31536000, immutable')

    const contentLength = res.headers.get('content-length')
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength)
    }

    const contentRange = res.headers.get('content-range')
    if (contentRange) {
      responseHeaders.set('Content-Range', contentRange)
    }

    // Return 206 Partial Content if Range request was sent, else status from Drive
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
    })

    if (!res.ok) {
      return new NextResponse(null, { status: res.status })
    }

    const headers = new Headers()
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Accept-Ranges', 'bytes')
    const cl = res.headers.get('content-length')
    if (cl) headers.set('Content-Length', cl)

    return new NextResponse(null, { status: 200, headers })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
