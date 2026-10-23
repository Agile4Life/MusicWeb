export interface BattleTrack {
  id: string
  title: string
  artist: string
  album: string
  cover_url: string | null
  duration: number
  source: 'spotify' | 'youtube' | 'soundcloud'
  spotify_id?: string
  youtube_id?: string
  soundcloud_id?: string
  preview_url: string | null
  source_url: string | null
}

export function playlistEndpoint(input: string): string {
  let url: URL
  try { url = new URL(input.trim()) } catch { throw new Error('Vui lòng dán link playlist hợp lệ.') }
  if (url.protocol !== 'https:') throw new Error('Vui lòng dùng link playlist HTTPS.')
  if (url.hostname === 'open.spotify.com') {
    const id = url.pathname.match(/^\/(?:intl-[a-z]+\/)?playlist\/([a-zA-Z0-9]+)\/?$/)?.[1]
    if (id) return `/api/spotify/playlist?id=${encodeURIComponent(id)}&type=tracks`
  }
  if (['youtube.com', 'www.youtube.com', 'music.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)) {
    const id = url.searchParams.get('list')
    if (id && /^[a-zA-Z0-9_-]+$/.test(id)) return `/api/youtube/playlist?id=${encodeURIComponent(id)}`
  }
  if (['soundcloud.com', 'www.soundcloud.com', 'on.soundcloud.com'].includes(url.hostname)) {
    if (/^\/[^/]+\/sets\/[^/]+\/?$/.test(url.pathname) || (url.hostname === 'on.soundcloud.com' && /^\/[^/]+\/?$/.test(url.pathname))) {
      return `/api/soundcloud/playlists?url=${encodeURIComponent(url.href)}`
    }
  }
  throw new Error('Hỗ trợ playlist công khai từ Spotify, YouTube và SoundCloud. Kiểm tra lại link của bạn.')
}

function string(value: unknown): string { return typeof value === 'string' ? value : '' }
function webUrl(value: unknown): string | null {
  const text = string(value)
  try { const url = new URL(text); return ['https:', 'http:'].includes(url.protocol) ? url.href : null } catch { return null }
}

export function normalizeBattleTrack(value: unknown): BattleTrack | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const spotifyId = string(raw.spotify_id)
  const youtubeId = string(raw.youtube_id)
  const soundcloudId = typeof raw.soundcloud_id === 'number' ? String(raw.soundcloud_id) : string(raw.soundcloud_id)
  const source = raw.source === 'youtube' || (!spotifyId && youtubeId) ? 'youtube'
    : raw.source === 'soundcloud' || (!spotifyId && soundcloudId) ? 'soundcloud' : 'spotify'
  const sourceId = source === 'spotify' ? spotifyId : source === 'youtube' ? youtubeId : soundcloudId
  if (!sourceId || !string(raw.title).trim()) return null
  return {
    id: string(raw.id) || `${source}-${sourceId}`, source, title: string(raw.title),
    artist: string(raw.artist) || string(raw.artist_name) || 'Chưa rõ nghệ sĩ',
    album: string(raw.album), cover_url: webUrl(raw.cover_url),
    duration: typeof raw.duration === 'number' && Number.isFinite(raw.duration) ? Math.max(0, raw.duration) : 0,
    spotify_id: spotifyId || undefined, youtube_id: youtubeId || undefined, soundcloud_id: soundcloudId || undefined,
    preview_url: webUrl(raw.preview_url),
    source_url: source === 'spotify' ? `https://open.spotify.com/track/${encodeURIComponent(spotifyId)}`
      : source === 'youtube' ? `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeId)}`
        : webUrl(raw.soundcloud_permalink_url) || webUrl(raw.source_url),
  }
}

export function mergeBattleTracks(current: BattleTrack[], incoming: BattleTrack[]): BattleTrack[] {
  const seen = new Set<string>()
  return [...current, ...incoming].filter(track => {
    const key = `${track.source}:${track.spotify_id || track.youtube_id || track.soundcloud_id || track.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function fetchBattleTracks(endpoint: string, signal: AbortSignal): Promise<BattleTrack[]> {
  const timeout = AbortSignal.timeout(25000)
  try {
    const res = await fetch(endpoint, { signal: AbortSignal.any([signal, timeout]) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Không tải được bài hát. Vui lòng thử lại.')
    const items: unknown[] = Array.isArray(data) ? data : Array.isArray(data.tracks) ? data.tracks : []
    return mergeBattleTracks([], items.map(normalizeBattleTrack).filter((track): track is BattleTrack => track !== null))
  } catch (error) {
    if (timeout.aborted && !signal.aborted) throw new Error('Nguồn nhạc phản hồi quá lâu. Vui lòng thử lại.')
    if (error instanceof SyntaxError) throw new Error('Nguồn nhạc trả về dữ liệu không hợp lệ. Vui lòng thử lại.')
    throw error
  }
}
