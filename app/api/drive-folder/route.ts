import { NextRequest, NextResponse } from 'next/server'

function decodeUnicodeEscapes(str: string): string {
  try {
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    ).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  } catch {
    return str
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const folderId = searchParams.get('folderId')

    if (!folderId) {
      return NextResponse.json({ error: 'Missing folderId' }, { status: 400 })
    }

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    }

    // Try fetching from Google Drive embedded folder view & standard public folder page
    const urls = [
      `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
      `https://drive.google.com/drive/folders/${folderId}`,
    ]

    const files: Array<{ id: string; name: string }> = []

    for (const url of urls) {
      if (files.length > 0) break

      try {
        const res = await fetch(url, { headers, cache: 'no-store' })
        if (!res.ok) continue

        const html = await res.text()
        let match: RegExpExecArray | null

        // Pattern 1: Embedded JSON script structures ["fileId", "fileName.ext", ...]
        const jsonPattern = /\["([a-zA-Z0-9_-]{19,45})",\s*"([^"]+?)"/g
        while ((match = jsonPattern.exec(html)) !== null) {
          const id = match[1]
          let rawName = match[2]
          if (id && id !== folderId && rawName) {
            const cleanName = decodeUnicodeEscapes(rawName).trim()
            if (
              (cleanName.includes('.') || cleanName.length < 100) &&
              !files.some((f) => f.id === id)
            ) {
              files.push({ id, name: cleanName })
            }
          }
        }

        // Pattern 2: HTML data attributes data-id and data-name
        if (files.length === 0) {
          const dataAttrPattern =
            /data-id=["']([a-zA-Z0-9_-]{19,45})["'][^>]*data-name=["']([^"']+)["']/g
          while ((match = dataAttrPattern.exec(html)) !== null) {
            const id = match[1]
            const name = decodeUnicodeEscapes(match[2]).trim()
            if (id !== folderId && !files.some((f) => f.id === id)) {
              files.push({ id, name })
            }
          }
        }

        // Pattern 3: Drive file links /file/d/ID
        if (files.length === 0) {
          const linkPattern = /\/file\/d\/([a-zA-Z0-9_-]{19,45})[^\>]*>([^<]+)/g
          while ((match = linkPattern.exec(html)) !== null) {
            const id = match[1]
            const name = decodeUnicodeEscapes(match[2].trim())
            if (id !== folderId && !files.some((f) => f.id === id)) {
              files.push({ id, name })
            }
          }
        }

        // Pattern 4: Fallback to extract any file ID from drive.google.com/file/d/ID or open?id=ID
        if (files.length === 0) {
          const idPattern = /(?:file\/d\/|id=)([a-zA-Z0-9_-]{19,45})/g
          let count = 1
          while ((match = idPattern.exec(html)) !== null) {
            const id = match[1]
            if (id !== folderId && !files.some((f) => f.id === id)) {
              files.push({ id, name: `Bài hát ${count++}` })
            }
          }
        }
      } catch (err) {
        console.warn('Folder page fetch error:', err)
      }
    }

    return NextResponse.json({
      success: true,
      folderId,
      count: files.length,
      files,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
