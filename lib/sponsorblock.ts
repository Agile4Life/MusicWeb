export interface SponsorBlockSegment {
  category: string
  actionType: string
  segment: [number, number] // [startSeconds, endSeconds]
  UUID: string
}

const sponsorBlockCache = new Map<string, SponsorBlockSegment[]>()

/**
 * Fetch community-submitted "Non-Music Section" segments for a YouTube video.
 * These mark intro logos, off-topic content, or silence before the song starts,
 * and outro content after it ends — the exact cause of MV-based lyric offset.
 *
 * Returns [] on 404 (no submissions yet) or any network error — this must never
 * throw, since it sits in the playback hot path.
 */
export async function getMusicOfftopicSegments(youtubeId: string): Promise<SponsorBlockSegment[]> {
  if (!youtubeId) return []

  if (sponsorBlockCache.has(youtubeId)) {
    return sponsorBlockCache.get(youtubeId)!
  }

  // Check localStorage for instant retrieval
  if (typeof window !== 'undefined') {
    try {
      const cachedRaw = localStorage.getItem(`sb_offset_${youtubeId}`)
      if (cachedRaw) {
        const offsetVal = parseFloat(cachedRaw)
        if (!isNaN(offsetVal)) {
          const fakeSegment: SponsorBlockSegment = {
            category: 'music_offtopic',
            actionType: 'skip',
            segment: [0, offsetVal],
            UUID: 'cached',
          }
          sponsorBlockCache.set(youtubeId, [fakeSegment])
          return [fakeSegment]
        }
      }
    } catch (e) {}
  }

  try {
    const categories = encodeURIComponent(JSON.stringify(['music_offtopic']))
    const res = await fetch(
      `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(youtubeId)}&categories=${categories}`,
      { signal: AbortSignal.timeout(3000) }
    )

    // 404 means no one has submitted segments for this video — not an error.
    if (!res.ok) {
      sponsorBlockCache.set(youtubeId, [])
      return []
    }

    const data: SponsorBlockSegment[] = await res.json()
    const result = Array.isArray(data) ? data : []
    sponsorBlockCache.set(youtubeId, result)

    // Persist calculated offset in localStorage
    if (typeof window !== 'undefined') {
      try {
        const offset = calculateIntroOffset(result)
        localStorage.setItem(`sb_offset_${youtubeId}`, offset.toString())
      } catch (e) {}
    }

    return result
  } catch (err) {
    console.warn('SponsorBlock fetch warning:', err)
    return []
  }
}

/**
 * Given the segments for a video, compute how many seconds of non-song content
 * sit at the START of the video (logo, silence, off-topic intro).
 * Only considers a segment that starts near time 0 — an off-topic segment
 * later in the video (e.g. an outro) should not shift lyric timing.
 */
export function calculateIntroOffset(segments: SponsorBlockSegment[]): number {
  if (!segments || segments.length === 0) return 0

  const introSegment = segments
    .filter((s) => s.category === 'music_offtopic' && s.segment[0] <= 3)
    .sort((a, b) => a.segment[1] - b.segment[1])[0]

  return introSegment ? Math.max(0, introSegment.segment[1]) : 0
}
