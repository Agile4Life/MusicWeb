import { NextRequest, NextResponse } from 'next/server'

// In-memory cache for transliterated text
const romajiCache = new Map<string, string[]>()

const CJK_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/

async function transliterateSingleLine(line: string): Promise<string> {
  const trimmed = line.trim()
  if (!trimmed || !CJK_REGEX.test(trimmed)) {
    return ''
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=rm&q=${encodeURIComponent(trimmed)}`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      next: { revalidate: 86400 },
    })

    if (!res.ok) return ''
    const data = await res.json()

    if (Array.isArray(data) && Array.isArray(data[0])) {
      let fullRomaji = ''
      for (const segment of data[0]) {
        if (Array.isArray(segment) && segment[3]) {
          fullRomaji += segment[3] + ' '
        }
      }
      return fullRomaji.trim()
    }
    return ''
  } catch {
    return ''
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { lines } = body as { lines: string[] }

    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ romaji: [] })
    }

    const cacheKey = lines.join(':::')
    if (romajiCache.has(cacheKey)) {
      return NextResponse.json({ romaji: romajiCache.get(cacheKey) })
    }

    // Process lines in chunks of 10 concurrent requests to avoid rate limits
    const results: string[] = []
    const chunkSize = 10

    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, i + chunkSize)
      const chunkPromises = chunk.map((line) => transliterateSingleLine(line))
      const chunkResults = await Promise.all(chunkPromises)
      results.push(...chunkResults)
    }

    // Cache results (keep max 300 tracks)
    if (romajiCache.size > 300) {
      const firstKey = romajiCache.keys().next().value
      if (firstKey) romajiCache.delete(firstKey)
    }
    romajiCache.set(cacheKey, results)

    return NextResponse.json({ romaji: results })
  } catch (err: any) {
    console.warn('API /api/lyrics/romaji error:', err)
    return NextResponse.json({ romaji: [] }, { status: 500 })
  }
}
