import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchAudiusTracks } from '@/lib/audius'
import { searchYouTubeTracks } from '@/lib/youtube'
import { Track } from '@/types'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || ''
  const source = searchParams.get('source') || 'all'

  if (!q.trim()) {
    return NextResponse.json({ local: [], youtube: [], audius: [] })
  }

  const query = q.trim()

  try {
    const promises: Array<Promise<any>> = []

    // 1. Search local Supabase tracks
    if (source === 'all' || source === 'local') {
      const supabase = await createClient()
      promises.push(
        (async () => {
          try {
            const { data } = await supabase
              .from('tracks')
              .select('*')
              .or(`title.ilike.%${query}%,artist.ilike.%${query}%`)
              .limit(10)
            return (data || []).map((t: any) => ({ ...t, source: 'local' }))
          } catch {
            return []
          }
        })()
      )
    } else {
      promises.push(Promise.resolve([]))
    }

    // 2. Search YouTube tracks
    if (source === 'all' || source === 'youtube') {
      promises.push(searchYouTubeTracks(query, 12).catch(() => []))
    } else {
      promises.push(Promise.resolve([]))
    }

    // 3. Search Audius tracks
    if (source === 'all' || source === 'audius') {
      promises.push(searchAudiusTracks(query, 12).catch(() => []))
    } else {
      promises.push(Promise.resolve([]))
    }

    const [localTracks, youtubeTracks, audiusTracks] = await Promise.all(promises)

    return NextResponse.json({
      local: localTracks,
      youtube: youtubeTracks,
      audius: audiusTracks,
    })
  } catch (err: any) {
    console.error('Unified search route error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
