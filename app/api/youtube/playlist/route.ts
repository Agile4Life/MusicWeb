import { NextRequest, NextResponse } from 'next/server'
import { Track } from '@/types'
import { getBestYouTubeThumbnailUrl } from '@/lib/youtube'

export interface YouTubePlaylistMeta {
  id: string
  title: string
  description: string
  channelTitle: string
  cover_url: string | null
  total_tracks: number
}

function cleanHtmlEntities(str?: string | null): string {
  if (!str) return ''
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function parseDurationText(str?: string | null): number {
  if (!str) return 0
  const trimmed = str.trim()
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map(Number)
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return parts[0] * 60 + parts[1]
    }
    if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2]
    }
  }
  const parsed = parseInt(trimmed, 10)
  return isNaN(parsed) ? 0 : parsed
}

async function fetchViaInnerTube(playlistId: string): Promise<{ meta: YouTubePlaylistMeta; tracks: Track[] } | null> {
  try {
    const browseId = playlistId.startsWith('VL') ? playlistId : `VL${playlistId}`
    const res = await fetch('https://music.youtube.com/youtubei/v1/browse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Origin': 'https://music.youtube.com',
        'Referer': 'https://music.youtube.com/',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240401.01.00',
            hl: 'vi',
            gl: 'VN',
          },
        },
        browseId,
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return null
    const data = await res.json()

    const mf = data.microformat?.microformatDataRenderer || {}
    const playlistTitle = cleanHtmlEntities(mf.title) || 'YouTube Playlist'
    const descText = mf.description || ''
    let channelTitle = 'YouTube Artist'

    if (descText.includes('•')) {
      const parts = descText.split('•')
      if (parts.length > 1) channelTitle = parts[1].trim()
    }

    const coverUrl = mf.thumbnail?.thumbnails?.[0]?.url || null

    const tracks: Track[] = []
    const seenIds = new Set<string>()

    function traverseItems(obj: any) {
      if (!obj || typeof obj !== 'object') return
      if (obj.musicResponsiveListItemRenderer) {
        const r = obj.musicResponsiveListItemRenderer
        const flexColumns = r.flexColumns || []
        const titleRun = flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text
        const artistRuns = flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []
        const artist = artistRuns.map((x: any) => x.text).join('').replace(/ • .*/, '').trim() || channelTitle

        const fixedDuration = r.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text?.runs?.[0]?.text
        const durationSeconds = parseDurationText(fixedDuration)

        const playlistItemData = r.playlistItemData || {}
        const videoId = playlistItemData.videoId || r.doubleTapCommand?.watchEndpoint?.videoId

        const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || []
        const itemCover = getBestYouTubeThumbnailUrl(videoId, thumbs[thumbs.length - 1]?.url || coverUrl)

        if (videoId && titleRun && !seenIds.has(videoId)) {
          seenIds.add(videoId)
          tracks.push({
            id: `yt-${videoId}`,
            user_id: 'youtube-global',
            title: cleanHtmlEntities(titleRun),
            artist: cleanHtmlEntities(artist),
            album: 'YouTube Music',
            duration: durationSeconds,
            file_path: `https://www.youtube.com/watch?v=${videoId}`,
            cover_url: itemCover,
            created_at: new Date().toISOString(),
            source: 'youtube',
            youtube_id: videoId,
          })
        }
      } else if (obj.playlistVideoRenderer) {
        const r = obj.playlistVideoRenderer
        const videoId = r.videoId
        const title = r.title?.runs?.[0]?.text || r.title?.simpleText
        const artist = r.shortBylineText?.runs?.[0]?.text || channelTitle

        const durationStr = r.lengthText?.runs?.[0]?.text || r.lengthText?.simpleText || r.lengthSeconds
        const durationSeconds = parseDurationText(durationStr)

        const thumbs = r.thumbnail?.thumbnails || []
        const itemCover = getBestYouTubeThumbnailUrl(videoId, thumbs[thumbs.length - 1]?.url || coverUrl)

        if (videoId && title && !seenIds.has(videoId)) {
          seenIds.add(videoId)
          tracks.push({
            id: `yt-${videoId}`,
            user_id: 'youtube-global',
            title: cleanHtmlEntities(title),
            artist: cleanHtmlEntities(artist),
            album: 'YouTube Music',
            duration: durationSeconds,
            file_path: `https://www.youtube.com/watch?v=${videoId}`,
            cover_url: itemCover,
            created_at: new Date().toISOString(),
            source: 'youtube',
            youtube_id: videoId,
          })
        }
      } else {
        for (const k of Object.keys(obj)) {
          traverseItems(obj[k])
        }
      }
    }

    if (data.contents) {
      traverseItems(data.contents)
    }

    if (!playlistTitle && tracks.length === 0) return null

    const meta: YouTubePlaylistMeta = {
      id: playlistId,
      title: playlistTitle,
      description: descText,
      channelTitle,
      cover_url: coverUrl,
      total_tracks: tracks.length,
    }

    return { meta, tracks }
  } catch (err) {
    console.error('InnerTube playlist fetch error:', err)
    return null
  }
}

async function fetchViaOfficialApi(playlistId: string, apiKey: string): Promise<{ meta: YouTubePlaylistMeta; tracks: Track[] } | null> {
  try {
    const metaUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&id=${playlistId}&key=${apiKey}`
    const metaRes = await fetch(metaUrl, { signal: AbortSignal.timeout(5000) })
    if (!metaRes.ok) return null

    const metaData = await metaRes.json()
    const item = metaData.items?.[0]
    if (!item) return null

    const snippet = item.snippet || {}
    const meta: YouTubePlaylistMeta = {
      id: item.id,
      title: cleanHtmlEntities(snippet.title) || 'Untitled Playlist',
      description: snippet.description || '',
      channelTitle: snippet.channelTitle || 'Unknown',
      cover_url:
        snippet.thumbnails?.maxres?.url ||
        snippet.thumbnails?.high?.url ||
        snippet.thumbnails?.medium?.url ||
        null,
      total_tracks: item.contentDetails?.itemCount || 0,
    }

    const tracks: Track[] = []
    let pageToken = ''

    do {
      const itemsUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}&key=${apiKey}${
        pageToken ? `&pageToken=${pageToken}` : ''
      }`
      const itemsRes = await fetch(itemsUrl, { signal: AbortSignal.timeout(5000) })
      if (!itemsRes.ok) break

      const itemsData = await itemsRes.json()
      const rawItems = itemsData.items || []

      for (const rawItem of rawItems) {
        const videoId = rawItem.contentDetails?.videoId
        const rawSnippet = rawItem.snippet || {}

        if (!videoId || rawSnippet.title === 'Deleted video' || rawSnippet.title === 'Private video') {
          continue
        }

        tracks.push({
          id: `yt-${videoId}`,
          user_id: 'youtube-global',
          title: cleanHtmlEntities(rawSnippet.title || 'YouTube Track'),
          artist: cleanHtmlEntities(
            (rawSnippet.videoOwnerChannelTitle || rawSnippet.channelTitle || 'YouTube Artist')
              .replace(' - Topic', '')
              .replace('VEVO', '')
          ),
          album: 'YouTube Music',
          duration: 0,
          file_path: `https://www.youtube.com/watch?v=${videoId}`,
          cover_url: getBestYouTubeThumbnailUrl(
            videoId,
            rawSnippet.thumbnails?.maxres?.url ||
              rawSnippet.thumbnails?.high?.url ||
              rawSnippet.thumbnails?.medium?.url
          ),
          created_at: new Date().toISOString(),
          source: 'youtube',
          youtube_id: videoId,
        })
      }

      pageToken = itemsData.nextPageToken || ''
    } while (pageToken)

    return { meta, tracks }
  } catch (err) {
    console.error('Official YouTube API playlist fetch error:', err)
    return null
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const playlistId = searchParams.get('id') || searchParams.get('playlistId') || ''

    if (!playlistId.trim()) {
      return NextResponse.json({ error: 'Missing playlist ID' }, { status: 400 })
    }

    const apiKey = process.env.YOUTUBE_API_KEY || process.env.NEXT_PUBLIC_YOUTUBE_API_KEY || ''

    // 1. Try Official YouTube API if key is present
    if (apiKey) {
      const officialResult = await fetchViaOfficialApi(playlistId.trim(), apiKey)
      if (officialResult && officialResult.tracks.length > 0) {
        return NextResponse.json(officialResult)
      }
    }

    // 2. Fallback to InnerTube Browse API (No API key required, 100% reliable for public playlists)
    const innerTubeResult = await fetchViaInnerTube(playlistId.trim())
    if (innerTubeResult && innerTubeResult.tracks.length > 0) {
      return NextResponse.json(innerTubeResult)
    }

    return NextResponse.json(
      { error: 'Không tìm thấy playlist — có thể playlist ở chế độ riêng tư hoặc link không đúng.' },
      { status: 404 }
    )
  } catch (err: any) {
    console.error('YouTube playlist API route error:', err)
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 })
  }
}
