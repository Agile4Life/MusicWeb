import { Track } from '@/types'



/**
 * Search YouTube Data API v3 (or fallback Invidious instances)
 */
export async function searchYouTubeTracks(query: string, limit = 15): Promise<Track[]> {
  if (!query.trim()) return []

  const YOUTUBE_API_KEY = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || ''

  // 1. Primary Method: Official YouTube Data API v3 if API key is provided
  if (YOUTUBE_API_KEY) {
    try {
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoCategoryId=10&maxResults=${limit}&q=${encodeURIComponent(
        query.trim()
      )}&key=${YOUTUBE_API_KEY}`

      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        const items = data.items || []

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
            album: 'YouTube Music',
            duration: 0, // Will be resolved dynamically by YouTube IFrame Player
            file_path: `https://www.youtube.com/watch?v=${videoId}`,
            cover_url: thumbnail,
            created_at: snippet.publishedAt || new Date().toISOString(),
            source: 'youtube',
            youtube_id: videoId,
          }
        })
      } else {
        console.warn('YouTube Data API HTTP error:', res.status, await res.text())
      }
    } catch (err) {
      console.warn('Official YouTube API error, falling back to Invidious:', err)
    }
  }

  // 2. Fallback Method: Invidious / Piped Instances (100% Free - No API Key required)
  const invidiousInstances = [
    'https://inv.tux.pizza',
    'https://vid.puffyan.us',
    'https://invidious.nerdvpn.de',
  ]

  for (const instance of invidiousInstances) {
    try {
      const res = await fetch(
        `${instance}/api/v1/search?q=${encodeURIComponent(query.trim())}&type=video`,
        { signal: AbortSignal.timeout(4000) }
      )
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data) && data.length > 0) {
          return data.slice(0, limit).map((item: any): Track => {
            const videoId = item.videoId
            return {
              id: `yt-${videoId}`,
              user_id: 'youtube-global',
              title: item.title || 'YouTube Track',
              artist: item.author || 'YouTube Artist',
              album: 'YouTube Music',
              duration: item.lengthSeconds || 0,
              file_path: `https://www.youtube.com/watch?v=${videoId}`,
              cover_url:
                item.videoThumbnails?.find((t: any) => t.quality === 'high')?.url ||
                `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
              created_at: new Date().toISOString(),
              source: 'youtube',
              youtube_id: videoId,
            }
          })
        }
      }
    } catch (e) {
      // try next instance
    }
  }

  return []
}
