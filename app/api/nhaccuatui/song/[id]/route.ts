import { NextResponse } from 'next/server'
import { normalizeNhacCuaTuiSongResponse } from '@/lib/nhaccuatui'
import { fetchWithRetry, isTransientError } from '@/lib/fetchWithRetry'

const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

function getNctSongUrl(id: string): URL {
  const url = new URL(process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL)
  url.pathname = `/api/song/${encodeURIComponent(id)}`
  url.search = ''
  return url
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  if (!id?.trim()) return NextResponse.json({ error: 'Missing song id' }, { status: 400 })

  try {
    const upstream = await fetchWithRetry(
      () =>
        fetch(getNctSongUrl(id.trim()), {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
        }),
      {
        retries: 2,
        baseDelayMs: 200,
        maxDelayMs: 800,
        retryOn: (res: unknown) => {
          if (res instanceof Response) return isTransientError(res)
          return false
        },
      }
    )
    if (!upstream.ok) return NextResponse.json({ error: 'Song not found' }, { status: 404 })

    const payload: unknown = await upstream.json()
    const song = normalizeNhacCuaTuiSongResponse(payload)
    if (!song) return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })

    const { audioUrl: _signedAudioUrl, ...publicSong } = song

    return NextResponse.json({
      song: {
        ...publicSong,
        streamUrl: `/api/nhaccuatui/stream?id=${encodeURIComponent(song.id)}`,
      },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Song stream unavailable' }, { status: 502 })
  }
}
