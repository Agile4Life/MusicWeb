import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const folderId = searchParams.get('folderId')

    if (!folderId) {
      return NextResponse.json({ error: 'Missing folderId' }, { status: 400 })
    }

    // Try fetching from Google Drive embedded folder view (works for public folders)
    const embedUrl = `https://drive.google.com/embeddedfolderview?id=${folderId}#list`
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      cache: 'no-store'
    })

    if (!res.ok) {
      return NextResponse.json({ error: `Google Drive returned ${res.status}` }, { status: res.status })
    }

    const html = await res.text()
    const files: Array<{ id: string; name: string }> = []
    
    // Pattern 1: JSON structures embedded in script tags [id, name, ...]
    const jsonPattern = /\["([a-zA-Z0-9_-]{25,45})",\s*"([^"]+?)"/g
    let match: RegExpExecArray | null
    while ((match = jsonPattern.exec(html)) !== null) {
      const id = match[1]
      const name = match[2]
      if (id && name && (name.includes('.') || name.length < 100)) {
        if (!files.some(f => f.id === id)) {
          files.push({ id, name })
        }
      }
    }

    // Pattern 2: HTML data attributes data-id and data-name
    if (files.length === 0) {
      const dataAttrPattern = /data-id=["']([a-zA-Z0-9_-]{25,45})["'][^>]*data-name=["']([^"']+)["']/g
      while ((match = dataAttrPattern.exec(html)) !== null) {
        const id = match[1]
        const name = match[2]
        if (!files.some(f => f.id === id)) {
          files.push({ id, name })
        }
      }
    }

    // Pattern 3: Drive file view links /file/d/ID
    if (files.length === 0) {
      const linkPattern = /\/file\/d\/([a-zA-Z0-9_-]{25,45})[^\>]*>([^<]+)/g
      while ((match = linkPattern.exec(html)) !== null) {
        const id = match[1]
        const name = match[2].trim()
        if (!files.some(f => f.id === id)) {
          files.push({ id, name })
        }
      }
    }

    // Pattern 4: Fallback to extract any file ID from drive.google.com/file/d/ID or open?id=ID
    if (files.length === 0) {
      const idPattern = /(?:file\/d\/|id=)([a-zA-Z0-9_-]{25,45})/g
      let count = 1
      while ((match = idPattern.exec(html)) !== null) {
        const id = match[1]
        if (!files.some(f => f.id === id)) {
          files.push({ id, name: `Bài hát ${count++}` })
        }
      }
    }

    return NextResponse.json({
      success: true,
      folderId,
      count: files.length,
      files
    })

  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
