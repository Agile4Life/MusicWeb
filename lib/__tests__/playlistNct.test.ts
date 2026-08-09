import { describe, expect, it, vi } from 'vitest'
import type { Track } from '@/types'
import { resolvePlaylistTrackWithNct } from '../playlistNct'
import { resolveNhacCuaTuiTrack } from '../nhaccuatuiClient'

vi.mock('../nhaccuatuiClient', () => ({
  resolveNhacCuaTuiTrack: vi.fn(),
}))

const resolveMock = vi.mocked(resolveNhacCuaTuiTrack)

const fallbackTrack: Track = {
  id: 'yt-video-1',
  user_id: 'youtube-global',
  title: 'Xương Rồng',
  artist: 'Sơn Tùng M-TP',
  album: 'YouTube Music',
  duration: 215,
  file_path: 'https://www.youtube.com/watch?v=video-1',
  cover_url: 'https://img.youtube.com/vi/video-1/hqdefault.jpg',
  created_at: '2026-08-10T00:00:00.000Z',
  source: 'youtube',
  youtube_id: 'video-1',
}

describe('resolvePlaylistTrackWithNct', () => {
  it('replaces a playlist fallback track with NCT metadata without a signed URL', async () => {
    resolveMock.mockResolvedValueOnce({
      id: 'nct-1',
      title: 'Xương Rồng',
      artist: 'Sơn Tùng M-TP',
      coverUrl: 'https://cdn.example/nct-cover.jpg',
      duration: 214,
      audioUrl: 'https://stream.nct.vn/song.mp3?token=secret',
    })

    const result = await resolvePlaylistTrackWithNct(fallbackTrack)

    expect(result).toMatchObject({
      id: 'nct-nct-1',
      title: 'Xương Rồng',
      artist: 'Sơn Tùng M-TP',
      album: 'YouTube Music',
      duration: 214,
      file_path: '',
      cover_url: 'https://cdn.example/nct-cover.jpg',
      source: 'nhaccuatui',
      nhaccuatui_id: 'nct-1',
    })
    expect(result.audio_url).toBeUndefined()
    expect(result.youtube_id).toBeUndefined()
  })

  it('keeps the original track when NCT has no match', async () => {
    resolveMock.mockResolvedValueOnce(null)

    await expect(resolvePlaylistTrackWithNct(fallbackTrack)).resolves.toEqual(fallbackTrack)
  })

  it('keeps the original track when the NCT lookup fails', async () => {
    resolveMock.mockRejectedValueOnce(new Error('NCT unavailable'))

    await expect(resolvePlaylistTrackWithNct(fallbackTrack)).resolves.toEqual(fallbackTrack)
  })
})
