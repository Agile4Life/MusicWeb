import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const fileId = searchParams.get('id') || searchParams.get('fileId')

    if (!fileId) {
      return NextResponse.json({ error: 'Missing fileId parameter' }, { status: 400 })
    }

    // Google Drive direct download URL
    let driveUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`

    // Range header from client (for HTML5 <audio> seeking and partial streaming)
    const rangeHeader = req.headers.get('range')
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    }
    if (rangeHeader) {
      headers['Range'] = rangeHeader
    }

    // Initial fetch to Google Drive
    let res = await fetch(driveUrl, { headers, cache: 'no-store' })

    // Check if Google Drive returns a virus scan warning confirmation page (common for large FLAC files > 25MB)
    const contentType = res.headers.get('content-type') || ''
    
    if (contentType.includes('text/html')) {
      const responseText = await res.text()
      // Look for confirm token in HTML links or cookies
      const confirmMatch = responseText.match(/confirm=([a-zA-Z0-9_-]+)/) ||
        responseText.match(/name="confirm"\s+value="([a-zA-Z0-9_-]+)"/)
      
      const setCookieHeader = res.headers.get('set-cookie')
      const warningCookie = setCookieHeader?.match(/download_warning_[^=]+=([^;]+)/)?.[1]
      
      const confirmToken = confirmMatch?.[1] || warningCookie

      if (confirmToken) {
        driveUrl = `https://drive.google.com/uc?export=download&confirm=${confirmToken}&id=${encodeURIComponent(fileId)}`
        res = await fetch(driveUrl, { headers, cache: 'no-store' })
      } else {
        // Alternative download URL format for Google Drive files
        driveUrl = `https://docs.google.com/uc?export=download&id=${encodeURIComponent(fileId)}&confirm=t`
        res = await fetch(driveUrl, { headers, cache: 'no-store' })
      }
    }

    if (!res.ok && res.status !== 206) {
      return NextResponse.json(
        { error: `Google Drive error (HTTP ${res.status})` },
        { status: res.status }
      )
    }

    // Determine correct Audio MIME type
    let finalContentType = res.headers.get('content-type') || 'audio/mpeg'
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

    const driveUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
    const res = await fetch(driveUrl, {
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
