import { Track } from '@/types'

// Default fallback Audius Discovery Provider host
const DEFAULT_AUDIUS_HOST = 'https://discoveryprovider.audius.co'
const APP_NAME = 'MUSICWEB_PRO'

let cachedHost: string | null = null

/**
 * Get an active Audius Discovery Node host
 */
export async function getAudiusHost(): Promise<string> {
  if (cachedHost) return cachedHost
  try {
    const res = await fetch('https://api.audius.co', {
      headers: { Accept: 'application/json' },
    })
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data?.data) && data.data.length > 0) {
        cachedHost = data.data[0]
        return cachedHost!
      }
    }
  } catch (err) {
    console.warn('Audius host fetch warning, using fallback host:', err)
  }
  return DEFAULT_AUDIUS_HOST
}

/**
 * Search Audius tracks globally
 */
export async function searchAudiusTracks(query: string, limit = 15): Promise<Track[]> {
  if (!query.trim()) return []
  try {
    const host = await getAudiusHost()
    const url = `${host}/v1/tracks/search?query=${encodeURIComponent(query.trim())}&limit=${limit}&app_name=${APP_NAME}`

    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    })

    if (!res.ok) return []

    const result = await res.json()
    const rawTracks = result?.data || []

    return rawTracks.map((item: any): Track => {
      const artwork = item.artwork?.['480x480'] || item.artwork?.['150x150'] || null
      const streamUrl = `${host}/v1/tracks/${item.id}/stream?app_name=${APP_NAME}`

      return {
        id: `audius-${item.id}`,
        user_id: 'audius-global',
        title: item.title || 'Bài hát Audius',
        artist: item.user?.name || item.user?.handle || 'Nghệ sĩ Audius',
        album: 'Audius Global',
        duration: Math.round(item.duration || 0),
        file_path: streamUrl,
        cover_url: artwork,
        created_at: item.release_date || new Date().toISOString(),
        source: 'audius',
        audius_id: item.id,
        audio_url: streamUrl,
      }
    })
  } catch (err) {
    console.error('Audius search error:', err)
    return []
  }
}
