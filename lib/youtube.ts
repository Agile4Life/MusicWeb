import { Track } from '@/types'

const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://api.piped.privacydev.net',
  'https://pipedapi.tokhmi.xyz',
  'https://pipedapi.mha.fi',
]

const INVIDIOUS_INSTANCES = [
  'https://invidious.privacydev.net',
  'https://vid.puffyan.us',
  'https://inv.tux.pizza',
  'https://invidious.drgns.space',
]

/**
 * Extract 11-character YouTube Video ID from any input or URL
 */
export function extractYouTubeVideoId(input: string): string | null {
  if (!input) return null
  const trimmed = input.trim()

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed
  }

  const match = trimmed.match(
    /(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/|music\.youtube\.com\/watch\?v=|^yt-)([a-zA-Z0-9_-]{11})/
  )
  return match ? match[1] : null
}

/**
 * Scrape YouTube Search directly from YouTube HTML (100% Free - Works for YouTube & YouTube Music)
 */
async function scrapeYouTubeSearch(query: string, limit = 15): Promise<Track[]> {
  try {
    const videoIdFromUrl = extractYouTubeVideoId(query)
    if (videoIdFromUrl) {
      return [
        {
          id: `yt-${videoIdFromUrl}`,
          user_id: 'youtube-global',
          title: query.startsWith('http') ? 'YouTube Song' : `YouTube Video (${videoIdFromUrl})`,
          artist: 'YouTube Music',
          album: 'YouTube Music',
          duration: 0,
          file_path: `https://www.youtube.com/watch?v=${videoIdFromUrl}`,
          cover_url: `https://img.youtube.com/vi/${videoIdFromUrl}/hqdefault.jpg`,
          created_at: new Date().toISOString(),
          source: 'youtube',
          youtube_id: videoIdFromUrl,
        },
      ]
    }

    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
      },
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) return []

    const html = await res.text()
    const match =
      html.match(/var ytInitialData = ({[\s\S]*?});<\/script>/) ||
      html.match(/window\["ytInitialData"\] = ({[\s\S]*?});/)

    if (!match || !match[1]) return []

    const data = JSON.parse(match[1])
    const sectionList =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []

    const tracks: Track[] = []
    const seenIds = new Set<string>()

    const parseVideoRenderer = (video: any): Track | null => {
      if (!video || !video.videoId || seenIds.has(video.videoId)) return null
      seenIds.add(video.videoId)

      const videoId = video.videoId
      const title =
        video.title?.runs?.[0]?.text || video.title?.simpleText || 'YouTube Track'
      const artist =
        video.ownerText?.runs?.[0]?.text ||
        video.shortBylineText?.runs?.[0]?.text ||
        'YouTube Artist'

      const thumbnail =
        video.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
        `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`

      let durationSeconds = 0
      const durationStr =
        video.lengthText?.simpleText ||
        video.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText ||
        ''
      if (durationStr) {
        const parts = durationStr.split(':').map(Number)
        if (parts.length === 2) durationSeconds = parts[0] * 60 + parts[1]
        else if (parts.length === 3) durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
      }

      return {
        id: `yt-${videoId}`,
        user_id: 'youtube-global',
        title: title.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
        artist: artist.replace(' - Topic', '').replace('VEVO', ''),
        album: 'YouTube Music',
        duration: durationSeconds,
        file_path: `https://www.youtube.com/watch?v=${videoId}`,
        cover_url: thumbnail,
        created_at: new Date().toISOString(),
        source: 'youtube',
        youtube_id: videoId,
      }
    }

    for (const section of sectionList) {
      const items = section?.itemSectionRenderer?.contents || []
      for (const item of items) {
        if (tracks.length >= limit) break

        if (item.videoRenderer) {
          const t = parseVideoRenderer(item.videoRenderer)
          if (t) tracks.push(t)
        } else if (item.shelfRenderer?.content?.verticalListRenderer?.items) {
          for (const subItem of item.shelfRenderer.content.verticalListRenderer.items) {
            if (tracks.length >= limit) break
            if (subItem.videoRenderer) {
              const t = parseVideoRenderer(subItem.videoRenderer)
              if (t) tracks.push(t)
            }
          }
        }
      }
    }

    return tracks
  } catch (err) {
    console.warn('Direct YouTube HTML scraper warning:', err)
    return []
  }
}

/**
 * Fallback to Piped API instances if HTML scraper is blocked
 */
async function fetchFromPipedInstances(query: string, limit = 15): Promise<Track[]> {
  const fetchInstance = async (instance: string): Promise<Track[]> => {
    const res = await fetch(
      `${instance}/search?q=${encodeURIComponent(query.trim())}&filter=music_songs`,
      { signal: AbortSignal.timeout(3000) }
    )
    if (!res.ok) throw new Error('Piped HTTP error')
    const data = await res.json()
    const items = data.items || []
    if (!Array.isArray(items) || items.length === 0) throw new Error('Empty Piped items')

    return items.slice(0, limit).map((item: any): Track => {
      const urlParts = (item.url || '').split('v=')
      const videoId = urlParts[1] || item.id || ''
      return {
        id: `yt-${videoId}`,
        user_id: 'youtube-global',
        title: item.title || 'YouTube Track',
        artist: item.uploaderName || 'YouTube Artist',
        album: 'YouTube Music',
        duration: item.duration || 0,
        file_path: `https://www.youtube.com/watch?v=${videoId}`,
        cover_url: item.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        created_at: new Date().toISOString(),
        source: 'youtube',
        youtube_id: videoId,
      }
    })
  }

  try {
    return await Promise.any(PIPED_INSTANCES.map((inst) => fetchInstance(inst)))
  } catch {
    return []
  }
}

/**
 * Fallback to Invidious API instances
 */
async function fetchFromInvidiousInstances(query: string, limit = 15): Promise<Track[]> {
  const fetchInstance = async (instance: string): Promise<Track[]> => {
    const res = await fetch(
      `${instance}/api/v1/search?q=${encodeURIComponent(query.trim())}&type=video`,
      { signal: AbortSignal.timeout(3000) }
    )
    if (!res.ok) throw new Error('Invidious HTTP error')
    const items = await res.json()
    if (!Array.isArray(items) || items.length === 0) throw new Error('Empty Invidious items')

    return items.slice(0, limit).map((item: any): Track => ({
      id: `yt-${item.videoId}`,
      user_id: 'youtube-global',
      title: item.title || 'YouTube Track',
      artist: item.author || 'YouTube Artist',
      album: 'YouTube Music',
      duration: item.lengthSeconds || 0,
      file_path: `https://www.youtube.com/watch?v=${item.videoId}`,
      cover_url: item.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${item.videoId}/hqdefault.jpg`,
      created_at: new Date().toISOString(),
      source: 'youtube',
      youtube_id: item.videoId,
    }))
  }

  try {
    return await Promise.any(INVIDIOUS_INSTANCES.map((inst) => fetchInstance(inst)))
  } catch {
    return []
  }
}

/**
 * Search YouTube Data API v3 (or Direct Scraper + Piped + Invidious Fallbacks)
 */
export async function searchYouTubeTracks(query: string, limit = 15): Promise<Track[]> {
  if (!query.trim()) return []

  const videoIdFromUrl = extractYouTubeVideoId(query)
  if (videoIdFromUrl) {
    return [
      {
        id: `yt-${videoIdFromUrl}`,
        user_id: 'youtube-global',
        title: query.startsWith('http') ? 'YouTube Song' : `YouTube Video (${videoIdFromUrl})`,
        artist: 'YouTube Music',
        album: 'YouTube Music',
        duration: 0,
        file_path: `https://www.youtube.com/watch?v=${videoIdFromUrl}`,
        cover_url: `https://img.youtube.com/vi/${videoIdFromUrl}/hqdefault.jpg`,
        created_at: new Date().toISOString(),
        source: 'youtube',
        youtube_id: videoIdFromUrl,
      },
    ]
  }

  const YOUTUBE_API_KEY = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || ''

  // 1. Primary Method: Official YouTube Data API v3 if API key is provided
  if (YOUTUBE_API_KEY) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=${limit}&q=${encodeURIComponent(
        query.trim()
      )}&key=${YOUTUBE_API_KEY}`

      const res = await fetch(url, { signal: AbortSignal.timeout(4500) })
      if (res.ok) {
        const data = await res.json()
        const items = data.items || []

        if (items.length > 0) {
          return items.map((item: any): Track => {
            const videoId = item.id?.videoId
            const snippet = item.snippet || {}
            const title = snippet.title
              ? snippet.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
              : 'YouTube Track'

            const channelTitle = snippet.channelTitle
              ? snippet.channelTitle.replace(' - Topic', '').replace('VEVO', '')
              : 'YouTube Artist'

            const thumbnail =
              snippet.thumbnails?.high?.url ||
              snippet.thumbnails?.medium?.url ||
              snippet.thumbnails?.default?.url ||
              `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`

            return {
              id: `yt-${videoId}`,
              user_id: 'youtube-global',
              title,
              artist: channelTitle,
              album: title,
              duration: 0,
              file_path: `https://www.youtube.com/watch?v=${videoId}`,
              cover_url: thumbnail,
              created_at: snippet.publishedAt || new Date().toISOString(),
              source: 'youtube',
              youtube_id: videoId,
            }
          })
        }
      }
    } catch (err) {
      console.warn('Official YouTube API warning:', err)
    }
  }

  // 2. Direct YouTube HTML Search Scraper (Fastest, 100% Reliable without API Key)
  const scrapedTracks = await scrapeYouTubeSearch(query, limit)
  if (scrapedTracks.length > 0) {
    return scrapedTracks
  }

  // 3. Piped API Instances Fallback
  const pipedTracks = await fetchFromPipedInstances(query, limit)
  if (pipedTracks.length > 0) {
    return pipedTracks
  }

  // 4. Invidious API Instances Fallback
  return fetchFromInvidiousInstances(query, limit)
}

/**
 * Fetch Trending / Top YouTube songs for initial display
 */
export async function getTrendingYouTubeTracks(limit = 12): Promise<Track[]> {
  const tracks = await searchYouTubeTracks('Official Music Video Vpop USUK Trending 2026', limit * 2)
  const filtered = tracks.filter((t) => {
    const titleLower = t.title.toLowerCase()
    return (
      !titleLower.includes('top 100') &&
      !titleLower.includes('top 150') &&
      !titleLower.includes('top 50') &&
      !titleLower.includes('bảng xếp hạng') &&
      !titleLower.includes('full album') &&
      !titleLower.includes('tổng hợp') &&
      !titleLower.includes('danh sách')
    )
  })
  return filtered.length > 0 ? filtered.slice(0, limit) : tracks.slice(0, limit)
}
