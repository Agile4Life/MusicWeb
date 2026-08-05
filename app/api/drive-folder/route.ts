import { NextRequest, NextResponse } from 'next/server'

function decodeUnicodeEscapes(str: string): string {
  try {
    return str
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
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

    const urls = [
      `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
      `https://drive.google.com/drive/folders/${folderId}`,
    ]

    const files: Array<{ id: string; name: string }> = []
    const seenIds = new Set<string>()
    if (folderId) seenIds.add(folderId)

    for (const url of urls) {
      try {
        const res = await fetch(url, { headers, cache: 'no-store' })
        if (!res.ok) continue

        const html = await res.text()
        let match: RegExpExecArray | null

        // Pattern 1: JSON array structures ["fileId", "fileName.ext", ...]
        const jsonPattern = /\["([a-zA-Z0-9_-]{18,45})",\s*"([^"]+?)"/g
        while ((match = jsonPattern.exec(html)) !== null) {
          const id = match[1]
          const rawName = match[2]
          if (id && !seenIds.has(id) && rawName) {
            const cleanName = decodeUnicodeEscapes(rawName).trim()
            if (cleanName.includes('.') || cleanName.length < 120) {
              files.push({ id, name: cleanName })
              seenIds.add(id)
            }
          }
        }

        // Pattern 2: Audio filename pattern inside JSON "fileId", "fileName.(flac|mp3|wav|m4a...)"
        const audioFilePattern = /"([a-zA-Z0-9_-]{18,45})",\s*"([^"]+?\.(?:mp3|flac|wav|m4a|aac|ogg|wma))"/gi
        while ((match = audioFilePattern.exec(html)) !== null) {
          const id = match[1]
          const rawName = match[2]
          if (id && !seenIds.has(id) && rawName) {
            const cleanName = decodeUnicodeEscapes(rawName).trim()
            files.push({ id, name: cleanName })
            seenIds.add(id)
          }
        }

        // Pattern 3: HTML data attributes data-id and data-name
        const dataAttrPattern = /data-id=["']([a-zA-Z0-9_-]{18,45})["'][^>]*data-name=["']([^"']+)["']/gi
        while ((match = dataAttrPattern.exec(html)) !== null) {
          const id = match[1]
          const name = decodeUnicodeEscapes(match[2]).trim()
          if (!seenIds.has(id)) {
            files.push({ id, name })
            seenIds.add(id)
          }
        }

        // Pattern 4: Drive file view links /file/d/ID
        const linkPattern = /\/file\/d\/([a-zA-Z0-9_-]{18,45})[^\>]*>([^<]+)/gi
        while ((match = linkPattern.exec(html)) !== null) {
          const id = match[1]
          const name = decodeUnicodeEscapes(match[2].trim())
          if (!seenIds.has(id)) {
            files.push({ id, name })
            seenIds.add(id)
          }
        }

        // Pattern 5: Any drive file URL href="/file/d/ID/view"
        const hrefPattern = /(?:href|src)=["'](?:https?:\/\/drive\.google\.com)?\/file\/d\/([a-zA-Z0-9_-]{18,45})/gi
        let fallbackCount = files.length + 1
        while ((match = hrefPattern.exec(html)) !== null) {
          const id = match[1]
          if (!seenIds.has(id)) {
            files.push({ id, name: `Bài hát ${fallbackCount++}` })
            seenIds.add(id)
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
