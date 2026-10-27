import { normalizeBattleTrack, type BattleTrack } from './songBattleSources'

export interface CommunityDeckSummary {
  id: string
  name: string
  description: string
  creator_name: string
  cover_url: string | null
  track_count: number
  created_at: string
  updated_at: string
  is_owner: boolean
}
export interface CommunityDeck extends CommunityDeckSummary { tracks: BattleTrack[] }
export interface CommunityDeckInput { name: string; description: string; creator_name: string; tracks: BattleTrack[] }
export const COMMUNITY_DECK_MAX_BYTES = 1024 * 1024
export class CommunityDeckValidationError extends Error {}
export function isDeckId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new CommunityDeckValidationError('Thông tin bộ bài không hợp lệ hoặc quá dài.')
  }
  return value.trim()
}
function soundcloudPermalink(value: string | null): string | null {
  if (!value || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname) || url.username || url.password || url.port) return null
    if (!/^\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) || url.pathname.startsWith('/tracks/')) return null
    url.search = ''
    url.hash = ''
    return url.href
  } catch { return null }
}
export function validateCommunityDeckInput(value: unknown): CommunityDeckInput {
  if (!value || typeof value !== 'object' || new TextEncoder().encode(JSON.stringify(value)).length > COMMUNITY_DECK_MAX_BYTES) {
    throw new CommunityDeckValidationError('Dữ liệu bộ bài quá lớn hoặc không hợp lệ.')
  }
  const raw = value as Record<string, unknown>
  const name = text(raw.name, 120, true)
  const description = text(raw.description ?? '', 1000)
  const creator_name = text(raw.creator_name, 80, true)
  if (!Array.isArray(raw.tracks) || raw.tracks.length < 2 || raw.tracks.length > 512) {
    throw new CommunityDeckValidationError('Bộ bài cần từ 2 đến 512 bài hát.')
  }
  const tracks = new Map<string, BattleTrack>()
  for (const item of raw.tracks) {
    const normalized = normalizeBattleTrack(item)
    if (!normalized) throw new CommunityDeckValidationError('Bài hát không hợp lệ.')
    const { source } = normalized
    if (source === 'musicweb') {
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(normalized.id)) throw new CommunityDeckValidationError('Mã bài hát không hợp lệ.')
      const stream = normalized.stream_url
      let safe = false
      if (stream && stream.length <= 2048) {
        try {
          const url = new URL(stream, 'https://musicweb.invalid')
          safe = stream.startsWith('https://') && !url.username && !url.password
          if (stream.startsWith('/api/')) {
            safe = ['/api/drive-stream', '/api/nhaccuatui/stream', '/api/soundcloud/stream'].includes(url.pathname)
          }
        } catch { /* Reject invalid playback URLs. */ }
      }
      if (!safe) throw new CommunityDeckValidationError('Bài từ MusicWeb cần có nguồn âm thanh hợp lệ để đăng công khai.')
      const track: BattleTrack = {
        id: normalized.id, source, title: text(normalized.title, 300, true), artist: text(normalized.artist, 300, true),
        album: text(normalized.album, 300), duration: Math.min(normalized.duration, 86400),
        cover_url: normalized.cover_url?.startsWith('https://') ? text(normalized.cover_url, 2048) : null,
        preview_url: null, source_url: null, stream_url: stream,
      }
      if (!tracks.has(track.id)) tracks.set(track.id, track)
      continue
    }
    const sourceId = (source === 'spotify' ? normalized.spotify_id : source === 'youtube' ? normalized.youtube_id : normalized.soundcloud_id) || ''
    const pattern = source === 'spotify' ? /^[A-Za-z0-9]{1,64}$/ : source === 'youtube' ? /^[A-Za-z0-9_-]{1,64}$/ : /^[0-9]{1,30}$/
    if (!pattern.test(sourceId)) throw new CommunityDeckValidationError('Mã bài hát không hợp lệ.')
    const id = `${source}-${sourceId}`
    const cover = normalized.cover_url
    if (cover && cover.length > 2048) throw new CommunityDeckValidationError('Ảnh bài hát quá dài.')
    const track: BattleTrack = {
      id, source, title: text(normalized.title, 300, true), artist: text(normalized.artist, 300, true),
      album: text(normalized.album, 300), duration: Math.min(normalized.duration, 86400),
      cover_url: cover?.startsWith('https://') ? cover : null, preview_url: null,
      source_url: source === 'spotify' ? `https://open.spotify.com/track/${sourceId}`
        : source === 'youtube' ? `https://www.youtube.com/watch?v=${sourceId}` : soundcloudPermalink(normalized.source_url),
      ...(source === 'spotify' ? { spotify_id: sourceId } : source === 'youtube' ? { youtube_id: sourceId } : { soundcloud_id: sourceId }),
    }
    if (!tracks.has(id)) tracks.set(id, track)
  }
  if (tracks.size < 2) throw new CommunityDeckValidationError('Cần ít nhất 2 bài hát khác nhau.')
  return { name, description, creator_name, tracks: [...tracks.values()] }
}
