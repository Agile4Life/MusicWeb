import { NextRequest, NextResponse } from 'next/server'

interface FolderCacheEntry {
  files: Array<{ id: string; name: string }>
  timestamp: number
}

const folderCache = new Map<string, FolderCacheEntry>()
const FOLDER_CACHE_TTL = 15 * 60 * 1000 // 15 minutes TTL

function decodeUnicodeEscapes(str: string): string {
  if (!str) return ''
  try {
    let decoded = str
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, ' ')
    decoded = decoded
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
    return decoded.trim()
  } catch {
    return str.trim()
  }
}

async function fetchDriveFileRealName(fileId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://drive.google.com/file/d/${fileId}/view`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const html = await res.text()
      const ogTitleMatch =
        html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
        html.match(/<title>([^<]+?)(?:\s*-\s*Google Drive)?<\/title>/i)

      if (ogTitleMatch && ogTitleMatch[1]) {
        let name = ogTitleMatch[1].replace(/\s*-\s*Google Drive$/i, '').trim()
        if (name && name !== 'Google Drive' && !name.toLowerCase().includes('google drive')) {
          return decodeUnicodeEscapes(name)
        }
      }
    }
  } catch {
    // Ignore fetch error
  }
  return null
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const folderId = searchParams.get('folderId')

    if (!folderId) {
      return NextResponse.json({ error: 'Missing folderId' }, { status: 400 })
    }

    // ⚡ STEP 1: Return from 15-minute Server Memory Cache if available (< 1ms latency)
    const cachedEntry = folderCache.get(folderId)
    if (cachedEntry && Date.now() - cachedEntry.timestamp < FOLDER_CACHE_TTL) {
      return NextResponse.json({
        success: true,
        folderId,
        count: cachedEntry.files.length,
        files: cachedEntry.files,
        cached: true,
      }, {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=1800',
        },
      })
    }

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    }

    const urls = [
      `https://drive.google.com/embeddedfolderview?id=${folderId}#list`,
      `https://drive.google.com/drive/folders/${folderId}`,
    ]

    const fileMap = new Map<string, string>() // id -> title
    const seenIds = new Set<string>()
    if (folderId) seenIds.add(folderId)

    // 🚀 Fetch BOTH URLs in parallel (saves 1-3 seconds vs sequential)
    const fetchResults = await Promise.allSettled(
      urls.map((url) =>
        fetch(url, { headers, cache: 'no-store', signal: AbortSignal.timeout(8000) })
          .then(async (res) => {
            if (!res.ok) return ''
            return res.text()
          })
          .catch(() => '')
      )
    )

    for (const result of fetchResults) {
      if (result.status !== 'fulfilled' || !result.value) continue
      const html = result.value
      let match: RegExpExecArray | null

      // 1. Audio filename pattern inside JSON: "FILE_ID", "FILENAME.ext"
      const audioPattern1 = /"([a-zA-Z0-9_-]{18,45})"\s*,\s*"([^"\r\n]+?\.(?:mp3|flac|wav|m4a|aac|ogg|wma|mp4))"/gi
      while ((match = audioPattern1.exec(html)) !== null) {
        const id = match[1]
        const name = decodeUnicodeEscapes(match[2])
        if (id && !seenIds.has(id) && name) {
          fileMap.set(id, name)
          seenIds.add(id)
        }
      }

      // 2. Audio filename pattern inside JSON: "FILENAME.ext", "FILE_ID"
      const audioPattern2 = /"([^"\r\n]+?\.(?:mp3|flac|wav|m4a|aac|ogg|wma|mp4))"\s*,\s*"([a-zA-Z0-9_-]{18,45})"/gi
      while ((match = audioPattern2.exec(html)) !== null) {
        const name = decodeUnicodeEscapes(match[1])
        const id = match[2]
        if (id && !seenIds.has(id) && name) {
          fileMap.set(id, name)
          seenIds.add(id)
        }
      }

      // 3. Array pattern: ["FILE_ID", "FILENAME", ...]
      const jsonPattern = /\[\s*"([a-zA-Z0-9_-]{18,45})"\s*,\s*"([^"\r\n]+?)"/gi
      while ((match = jsonPattern.exec(html)) !== null) {
        const id = match[1]
        const name = decodeUnicodeEscapes(match[2])
        if (id && !seenIds.has(id) && name) {
          if (name.includes('.') || name.length < 120) {
            fileMap.set(id, name)
            seenIds.add(id)
          }
        }
      }

      // 4. HTML attributes: data-id and data-name
      const dataAttrPattern = /data-id=["']([a-zA-Z0-9_-]{18,45})["'][^>]*data-name=["']([^"']+)["']/gi
      while ((match = dataAttrPattern.exec(html)) !== null) {
        const id = match[1]
        const name = decodeUnicodeEscapes(match[2])
        if (id && !seenIds.has(id) && name) {
          fileMap.set(id, name)
          seenIds.add(id)
        }
      }

      // 5. HTML anchor links: /file/d/ID ... >FILENAME</a>
      const linkPattern = /\/file\/d\/([a-zA-Z0-9_-]{18,45})[^\\>]*>([^<]+)/gi
      while ((match = linkPattern.exec(html)) !== null) {
        const id = match[1]
        const name = decodeUnicodeEscapes(match[2])
        if (id && !seenIds.has(id) && name && !name.toLowerCase().includes('google drive')) {
          fileMap.set(id, name)
          seenIds.add(id)
        }
      }

      // 6. Any drive file URL href="/file/d/ID/view"
      const hrefPattern = /(?:href|src)=["'](?:https?:\/\/drive\.google\.com)?\/file\/d\/([a-zA-Z0-9_-]{18,45})/gi
      while ((match = hrefPattern.exec(html)) !== null) {
        const id = match[1]
        if (id && !seenIds.has(id)) {
          seenIds.add(id)
          fileMap.set(id, '__FETCH_REAL_TITLE__')
        }
      }
    }

    // Resolve remaining raw IDs — limit to max 3 concurrent to avoid rate limiting
    const unresolves = Array.from(fileMap.entries()).filter(
      ([_, name]) => name === '__FETCH_REAL_TITLE__'
    )

    if (unresolves.length > 0) {
      const MAX_CONCURRENT = 3
      for (let i = 0; i < unresolves.length; i += MAX_CONCURRENT) {
        const batch = unresolves.slice(i, i + MAX_CONCURRENT)
        await Promise.all(
          batch.map(async ([id]) => {
            const realName = await fetchDriveFileRealName(id)
            if (realName) {
              fileMap.set(id, realName)
            } else {
              fileMap.delete(id)
            }
          })
        )
      }
    }

    const files: Array<{ id: string; name: string }> = []
    const seenFileNames = new Set<string>()

    for (const [id, name] of Array.from(fileMap.entries())) {
      if (!name || name === '__FETCH_REAL_TITLE__') continue
      const normName = name.trim().toLowerCase().normalize('NFKC')
      if (!seenFileNames.has(normName)) {
        seenFileNames.add(normName)
        files.push({ id, name })
      }
    }

    // 💾 Store in 15-minute Server Memory Cache
    folderCache.set(folderId, { files, timestamp: Date.now() })

    return NextResponse.json({
      success: true,
      folderId,
      count: files.length,
      files,
    }, {
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=1800',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
