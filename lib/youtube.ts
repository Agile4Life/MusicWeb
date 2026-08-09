import { Track } from '@/types'

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
 * Parse human-readable view count string (e.g. "1,2M lượt xem", "12M views", "450K views") into integer
 */
export function parseViewCountText(text?: string | null): number | null {
  if (!text) return null
  const cleaned = text.toLowerCase().replace(/,/g, '.').trim()

  const bMatch = cleaned.match(/([\d\.]+)\s*(?:b|tỷ)/i)
  if (bMatch) return Math.round(parseFloat(bMatch[1]) * 1000000000)

  const mMatch = cleaned.match(/([\d\.]+)\s*(?:m|tr|triệu)/i)
  if (mMatch) return Math.round(parseFloat(mMatch[1]) * 1000000)

  const kMatch = cleaned.match(/([\d\.]+)\s*(?:k|n|nghìn|ngàn)/i)
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000)

  const digits = cleaned.replace(/[^\d]/g, '')
  if (digits) {
    const parsed = parseInt(digits, 10)
    return isNaN(parsed) || parsed === 0 ? null : parsed
  }
  return null
}

/**
 * Primary YouTube Search via YouTube InnerTube API (Fastest, 100% Reliable on Vercel Serverless Datacenters)
 */
async function searchYouTubeInnerTube(query: string, limit = 15): Promise<Track[]> {
  try {
    const postData = JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: '2.20240318.01.00',
          hl: 'vi',
          gl: 'VN',
        },
      },
      query: query.trim(),
    })

    const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: postData,
      signal: AbortSignal.timeout(6000),
    })

    if (!res.ok) return []

    const resData = await res.json()
    const sectionList =
      resData?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []

    const tracks: Track[] = []
    const seenIds = new Set<string>()

    for (const section of sectionList) {
      const items = section?.itemSectionRenderer?.contents || []
      for (const item of items) {
        if (tracks.length >= limit) break
        const video = item.videoRenderer
        if (!video || !video.videoId || seenIds.has(video.videoId)) continue
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
        if (durationStr && /^\d{1,2}(:\d{2}){1,2}$/.test(durationStr.trim())) {
          const parts = durationStr.trim().split(':').map(Number)
          if (parts.length === 2) durationSeconds = parts[0] * 60 + parts[1]
          else if (parts.length === 3) durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
        }

        // Skip YouTube Shorts, sound effects, intro clips & memes shorter than 30 seconds
        if (durationSeconds > 0 && durationSeconds < 30) {
          continue
        }

        const viewText =
          video.viewCountText?.simpleText ||
          video.viewCountText?.runs?.map((r: any) => r.text).join('') ||
          video.shortViewCountText?.simpleText ||
          video.shortViewCountText?.runs?.map((r: any) => r.text).join('') ||
          ''
        const viewCount = parseViewCountText(viewText)

        tracks.push({
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
          view_count: viewCount,
        })
      }
    }

    return tracks
  } catch (err) {
    console.warn('InnerTube API search warning:', err)
    return []
  }
}

/**
 * Fallback Scrape YouTube Search directly from YouTube HTML
 */
async function scrapeYouTubeSearch(query: string, limit = 15): Promise<Track[]> {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
      },
      signal: AbortSignal.timeout(5000),
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

    for (const section of sectionList) {
      const items = section?.itemSectionRenderer?.contents || []
      for (const item of items) {
        if (tracks.length >= limit) break
        const video = item.videoRenderer
        if (!video || !video.videoId || seenIds.has(video.videoId)) continue
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
        if (durationStr && /^\d{1,2}(:\d{2}){1,2}$/.test(durationStr.trim())) {
          const parts = durationStr.trim().split(':').map(Number)
          if (parts.length === 2) durationSeconds = parts[0] * 60 + parts[1]
          else if (parts.length === 3) durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2]
        }

        // Skip YouTube Shorts, sound effects, intro clips & memes shorter than 30 seconds
        if (durationSeconds > 0 && durationSeconds < 30) {
          continue
        }

        const viewText =
          video.viewCountText?.simpleText ||
          video.viewCountText?.runs?.map((r: any) => r.text).join('') ||
          video.shortViewCountText?.simpleText ||
          video.shortViewCountText?.runs?.map((r: any) => r.text).join('') ||
          ''
        const viewCount = parseViewCountText(viewText)

        tracks.push({
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
          view_count: viewCount,
        })
      }
    }

    return tracks
  } catch (err) {
    console.warn('Direct YouTube HTML scraper warning:', err)
    return []
  }
}

/**
 * Keywords indicating a compilation, long loop, full album, or playlist mix.
 */
export const LONG_COMPILATION_KEYWORDS = [
  '1 hour', '1h', '2 hour', '2h', '3 hour', '3h', '10 hours',
  '40 min', '40p', '45 min', '30 min', '50 min', '60 min',
  'full album', 'tổng hợp', 'tuyển tập', 'nonstop', 'loop',
  'extended mix', 'playlist', 'danh sách nhạc', 'nhạc trẻ tổng hợp',
  'nhạc trẻ hay nhất', 'top 50', 'top 100', 'top 20', 'best of', 'mashup',
  'top vpop', 'nhiều lượt xem', 'most viewed', 'bảng xếp hạng', 'top bài hát',
  'tổng hợp vpop', 'top nhạc', 'nhạc tuần', 'nhạc tháng', 'tuần 1', 'tuần 2',
  'tuần 3', 'tuần 4', 'tháng 1', 'tháng 2', 'tháng 3', 'tháng 4', 'tháng 5',
  'tháng 6', 'tháng 7', 'tháng 8', 'tháng 9', 'tháng 10', 'tháng 11', 'tháng 12'
]

export const NEGATIVE_KEYWORDS = [
  'remix', 'reverb', 'slowed', 'sped up', 'speed up', '8d audio',
  'bass boosted', 'nightcore', 'lofi', 'lo-fi', 'piano version',
  'acoustic version', 'cover', 'karaoke', 'instrumental', 'reaction',
  'live', 'tiktok', 'chuẩn hot', 'hot tiktok', '1 hour', '1hour',
  '30min', 'loop', 'mashup'
]

export function isOriginalTrackOnly(title?: string): boolean {
  if (!title) return true
  const lower = title.toLowerCase().normalize('NFC')
  return !NEGATIVE_KEYWORDS.some((kw) => lower.includes(kw))
}

export function normalizeTitle(text: string): string {
  if (!text) return ''
  return text
    .normalize('NFC')
    .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
    .replace(/feat\.?|ft\.?/gi, ' ')
    .replace(/[\-\_\,\.\:\;]/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * Enhanced matching algorithm to pick the exact official digital audio / MV track.
 * Hard-filters out wrong compilations, covers, and reaction videos.
 * Gives absolute +1000 point priority to official "- Topic" channels.
 */
export function findBestYouTubeMatch(
  candidates: Track[],
  targetTitle?: string | null,
  targetArtist?: string | null,
  targetDuration?: number | null,
  targetAlbum?: string | null
): Track | null {
  if (!candidates || candidates.length === 0 || !targetTitle) return null

  const rawTargetTitle = targetTitle || ''
  const cleanTargetTitle = normalizeTitle(rawTargetTitle)
  if (!cleanTargetTitle) return null

  const rawTargetArtist = targetArtist || ''
  const cleanTargetArtist = normalizeTitle(rawTargetArtist)
  const cleanTargetAlbum = normalizeTitle(targetAlbum || '')
  const targetDur = targetDuration || 0

  const isQueryAskingForLong =
    LONG_COMPILATION_KEYWORDS.some((kw) => cleanTargetTitle.includes(kw)) ||
    (targetDur > 900)

  // Identify negative keywords that are explicitly requested by target title (e.g. if original IS a remix)
  const requestedNegativeKeywords = NEGATIVE_KEYWORDS.filter((kw) =>
    cleanTargetTitle.includes(kw)
  )

  let bestMatch: Track | null = null
  let highestScore = 30 // Threshold score for valid match

  const titleWords = cleanTargetTitle.split(/\s+/).filter((w) => w.length > 1)

  for (const candidate of candidates) {
    if (!candidate.youtube_id) continue

    const candidateTitleNorm = normalizeTitle(candidate.title || '')
    const candidateArtistNorm = normalizeTitle(candidate.artist || '')
    const candidateDuration = candidate.duration || 0

    // 1. HARD FILTER: Eliminate long compilations / loops > 20 mins when target is a single track
    if (!isQueryAskingForLong && candidateDuration > 1200) {
      continue
    }

    // 1b. HARD FILTER: Reject candidate if duration differs by more than 25 seconds from target single track
    if (targetDur > 0 && candidateDuration > 0 && !isQueryAskingForLong) {
      const diff = Math.abs(candidateDuration - targetDur)
      if (diff > 25) {
        continue
      }
    }

    // 2. HARD FILTER: Eliminate negative keywords (cover, karaoke, reaction, etc.) unless target explicitly asks for it
    const hasUnwantedNegativeKeyword = NEGATIVE_KEYWORDS.some((kw) => {
      if (requestedNegativeKeywords.includes(kw)) return false
      return candidateTitleNorm.includes(kw)
    })
    if (hasUnwantedNegativeKeyword) {
      continue
    }

    // 3. TITLE MATCH RATIO & SUBSTRING CHECK
    let matchedWordsCount = 0
    for (const word of titleWords) {
      if (candidateTitleNorm.includes(word)) {
        matchedWordsCount++
      }
    }

    const matchRatio = titleWords.length > 0 ? matchedWordsCount / titleWords.length : 0
    const hasSubstringMatch =
      (cleanTargetTitle.length >= 3 && candidateTitleNorm.includes(cleanTargetTitle)) ||
      (candidateTitleNorm.length >= 3 && cleanTargetTitle.includes(candidateTitleNorm))

    if (matchRatio < 0.35 && !hasSubstringMatch) {
      continue
    }

    let score = matchRatio * 120
    if (hasSubstringMatch) {
      score += 80
    }

    // 4. ALBUM MATCH BONUS (+500 points) - Strong signal for official releases
    if (cleanTargetAlbum && cleanTargetAlbum.length > 2) {
      if (candidateTitleNorm.includes(cleanTargetAlbum) || candidateArtistNorm.includes(cleanTargetAlbum)) {
        score += 500
      }
    }

    // 5. PRIORITY FOR DIGITAL AUDIO RELEASE ("- TOPIC" & "OFFICIAL AUDIO") OVER MV
    const isTopicChannel =
      candidateArtistNorm.endsWith('topic') ||
      candidateArtistNorm.includes('topic')
    const isOfficialAudio =
      candidateTitleNorm.includes('official audio') ||
      candidateTitleNorm.includes('audio official') ||
      candidateTitleNorm.includes('audio') ||
      candidateTitleNorm.includes('lyric')
    const isOfficialMV =
      candidateTitleNorm.includes('official music video') ||
      candidateTitleNorm.includes('official video') ||
      candidateTitleNorm.includes('music video') ||
      candidateTitleNorm.includes('mv')
    const isVevoOrOfficialChannel =
      candidateArtistNorm.includes('vevo') ||
      candidateArtistNorm.includes('official')

    if (isTopicChannel) {
      score += 400 // Direct studio audio release from Spotify/Apple Music provider
    } else if (isOfficialAudio) {
      score += 300 // Priority #1: Official Audio clean studio track
    } else if (isOfficialMV) {
      score += 100 // Priority #2: Official Music Video
    } else if (isVevoOrOfficialChannel) {
      score += 150
    }

    // 6. ARTIST MATCHING BONUS
    if (cleanTargetArtist) {
      const artistWords = cleanTargetArtist.split(/\s+/).filter((w) => w.length > 1)
      let artistMatch = false
      for (const word of artistWords) {
        if (candidateTitleNorm.includes(word) || candidateArtistNorm.includes(word)) {
          score += 30
          artistMatch = true
        }
      }
      if (artistMatch) score += 40
    }

    // 7. DURATION PRECISION SCORING (Non-overlapping thresholds)
    if (targetDur > 0 && candidateDuration > 0) {
      const diff = Math.abs(candidateDuration - targetDur)
      if (diff <= 3) {
        score += 120 // Almost exact duration match
      } else if (diff <= 10) {
        score += 30
      } else if (diff <= 20) {
        score -= 30
      } else if (diff <= 30) {
        score -= 150
      } else {
        score -= 300
      }
    }

    if (score > highestScore) {
      highestScore = score
      bestMatch = candidate
    }
  }

  return bestMatch
}

interface VideoMeta {
  duration: number
  viewCount: number
}

/**
 * Lấy duration thật (giây) VÀ view count thật cho danh sách videoId qua 1 lần gọi
 * videos.list (part=contentDetails,statistics) — gộp chung để tiết kiệm quota thay vì 2 request riêng.
 */
async function getVideoMeta(
  videoIds: string[],
  apiKey: string
): Promise<Record<string, VideoMeta>> {
  if (videoIds.length === 0) return {}
  try {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${videoIds.join(
      ','
    )}&key=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(4500) })
    if (!res.ok) return {}
    const data = await res.json()
    const map: Record<string, VideoMeta> = {}
    for (const item of data.items || []) {
      const iso = item.contentDetails?.duration || ''
      const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
      let duration = 0
      if (match) {
        const [, h, m, s] = match
        duration = parseInt(h || '0') * 3600 + parseInt(m || '0') * 60 + parseInt(s || '0')
      }
      const viewCount = item.statistics?.viewCount != null ? parseInt(item.statistics.viewCount, 10) || 0 : 0
      map[item.id] = { duration, viewCount }
    }
    return map
  } catch (err) {
    console.warn('getVideoMeta warning:', err)
    return {}
  }
}

/**
 * Search YouTube Data API v3 or InnerTube API + HTML Scraper Fallback
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

  let tracks: Track[] = []
  const YOUTUBE_API_KEY = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || ''

  // 1. Official YouTube Data API v3 if API key is provided
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
          tracks = items.map((item: any): Track => {
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

          // Fetch real duration + view count via videos.list (combined request)
          const videoIds = tracks.map((t) => t.youtube_id).filter(Boolean) as string[]
          const meta = await getVideoMeta(videoIds, YOUTUBE_API_KEY)
          tracks = tracks.map((t) => ({
            ...t,
            duration: (t.youtube_id && meta[t.youtube_id]?.duration) || 0,
            view_count: t.youtube_id && meta[t.youtube_id] ? meta[t.youtube_id].viewCount : null,
          }))

          // If duration enrichment failed for everything, don't trust this batch's duration=0.
          // Fall back to InnerTube which parses duration directly from search results.
          const allDurationsZero = tracks.every((t) => !t.duration)
          if (allDurationsZero) {
            const innerTubeTracks = await searchYouTubeInnerTube(query, limit)
            if (innerTubeTracks.length > 0) {
              tracks = innerTubeTracks
            }
          }
        }
      }
    } catch (err) {
      console.warn('Official YouTube API warning:', err)
    }
  }

  // 2. Primary Method: InnerTube API
  if (tracks.length === 0) {
    tracks = await searchYouTubeInnerTube(query, limit)
  }

  // 3. Fallback: Direct HTML Scraper
  if (tracks.length === 0) {
    tracks = await scrapeYouTubeSearch(query, limit)
  }

  // Prioritize single tracks and Official Audio / Topic channels over MVs & long compilations
  const isQueryLong = LONG_COMPILATION_KEYWORDS.some((kw) => query.toLowerCase().includes(kw))
  if (!isQueryLong && tracks.length > 1) {
    tracks = [...tracks].sort((a, b) => {
      const aTitle = (a.title || '').toLowerCase()
      const bTitle = (b.title || '').toLowerCase()
      const aArtist = (a.artist || '').toLowerCase()
      const bArtist = (b.artist || '').toLowerCase()

      const aIsLong = (a.duration || 0) > 900 || LONG_COMPILATION_KEYWORDS.some((kw) => aTitle.includes(kw))
      const bIsLong = (b.duration || 0) > 900 || LONG_COMPILATION_KEYWORDS.some((kw) => bTitle.includes(kw))
      if (aIsLong && !bIsLong) return 1
      if (!aIsLong && bIsLong) return -1

      const aIsAudio = aTitle.includes('official audio') || aTitle.includes('audio official') || aTitle.includes('audio') || aArtist.includes('topic')
      const bIsAudio = bTitle.includes('official audio') || bTitle.includes('audio official') || bTitle.includes('audio') || bArtist.includes('topic')
      if (aIsAudio && !bIsAudio) return -1
      if (!aIsAudio && bIsAudio) return 1

      const aIsMV = aTitle.includes('official music video') || aTitle.includes('official video') || aTitle.includes('music video') || aTitle.includes('mv')
      const bIsMV = bTitle.includes('official music video') || bTitle.includes('official video') || bTitle.includes('music video') || bTitle.includes('mv')
      if (aIsMV && !bIsMV) return -1
      if (!aIsMV && bIsMV) return 1

      return 0
    })
  }

  return tracks
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

/**
 * On-demand: lấy view count thật cho MỘT track cụ thể (vd khi mở trang chi tiết
 * hoặc khi track bắt đầu phát). KHÔNG gọi hàm này cho toàn bộ danh sách kết quả
 * tìm kiếm — chỉ dùng khi cần hiển thị 1 track cụ thể, để tránh tốn quota.
 */
export async function fetchViewCountForVideo(youtubeId: string): Promise<number | null> {
  const YOUTUBE_API_KEY = process.env.NEXT_PUBLIC_YOUTUBE_API_KEY || process.env.YOUTUBE_API_KEY || ''
  if (!YOUTUBE_API_KEY || !youtubeId) return null

  const meta = await getVideoMeta([youtubeId], YOUTUBE_API_KEY)
  return meta[youtubeId]?.viewCount ?? null
}

