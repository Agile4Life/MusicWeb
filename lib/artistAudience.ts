/**
 * Fetches accurate, real-world artist subscriber/follower count from official channels.
 */

function parseSubscriberCount(raw?: string | null): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/người đăng ký|subscribers/gi, '').trim()
  let multiplier = 1
  let numStr = cleaned.replace(/,/g, '.')

  if (/tr|triệu|m|million/i.test(cleaned)) {
    multiplier = 1_000_000
    numStr = numStr.replace(/tr|triệu|m|million/gi, '').trim()
  } else if (/n|nghìn|k|thousand/i.test(cleaned)) {
    multiplier = 1_000
    numStr = numStr.replace(/n|nghìn|k|thousand/gi, '').trim()
  }

  const val = parseFloat(numStr)
  if (!isNaN(val)) {
    return Math.round(val * multiplier)
  }
  return null
}

export async function fetchArtistAudienceCount(artistName: string): Promise<number | null> {
  if (!artistName || !artistName.trim()) return null

  const postData = JSON.stringify({
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240401.01.00',
        hl: 'vi',
        gl: 'VN',
      },
    },
    query: artistName.trim(),
    params: 'EgIQAg%3D%3D', // Filter for Channels
  })

  try {
    const res = await fetch('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
      body: postData,
      signal: AbortSignal.timeout(4000),
      next: { revalidate: 86400 },
    })

    if (res.ok) {
      const data = await res.json()
      const sectionList =
        data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []

      for (const section of sectionList) {
        const items = section?.itemSectionRenderer?.contents || []
        for (const item of items) {
          const channel = item.channelRenderer
          if (channel) {
            const rawSub =
              channel.videoCountText?.simpleText || channel.subscriberCountText?.simpleText || ''
            const count = parseSubscriberCount(rawSub)
            if (count && count > 0) {
              return count
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('Artist audience fetch error:', err)
  }

  return null
}
