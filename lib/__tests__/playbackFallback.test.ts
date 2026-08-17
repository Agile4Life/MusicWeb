import { describe, expect, it } from 'vitest'
import { findBestYouTubeMatch } from '../youtube'
import { extractDriveFileId, buildDriveStreamUrl } from '../googleDriveUpload'
import { getNhacCuaTuiStreamUrl } from '../nhaccuatuiClient'
import type { Track } from '@/types'

const createMockTrack = (overrides: Partial<Track>): Track => ({
  id: 'test-id',
  user_id: 'test-user',
  title: 'Test Song',
  artist: 'Test Artist',
  duration: 200,
  file_path: '',
  cover_url: null,
  created_at: new Date().toISOString(),
  ...overrides,
})

describe('Playback Fallback & Resolution Engine', () => {
  describe('Google Drive Resolution Fallback', () => {
    it('correctly extracts file ID and builds stream URL for dynamic catalog matches', () => {
      const rawDriveId = '1sT-kP6Z9ABCDEF1234567890'
      const extracted = extractDriveFileId(rawDriveId)
      expect(extracted).toBe(rawDriveId)

      const streamUrl = buildDriveStreamUrl(extracted!)
      expect(streamUrl).toContain('/api/drive-stream?id=1sT-kP6Z9ABCDEF1234567890')
    })
  })

  describe('YouTube Fallback Matcher for Broken External Streams', () => {
    it('matches the best YouTube track when an NCT/SoundCloud stream fails', () => {
      const originalTrack = createMockTrack({
        id: 'nct-broken-1',
        title: 'Nơi Này Có Anh',
        artist: 'Sơn Tùng M-TP',
        duration: 260,
        source: 'nhaccuatui',
        nhaccuatui_id: 'broken_id',
      })

      const youtubeCandidates: Track[] = [
        createMockTrack({
          id: 'yt-1',
          youtube_id: 'FN7ALfpGxiI',
          title: 'NƠI NÀY CÓ ANH | OFFICIAL MUSIC VIDEO | SƠN TÙNG M-TP',
          artist: 'Sơn Tùng M-TP Official',
          duration: 275,
          source: 'youtube',
        }),
        createMockTrack({
          id: 'yt-2',
          youtube_id: 'other_id',
          title: 'Nơi Này Có Anh Cover hay nhất',
          artist: 'Cover Channel',
          duration: 250,
          source: 'youtube',
        }),
        createMockTrack({
          id: 'yt-3',
          youtube_id: 'karaoke_id',
          title: 'Nơi Này Có Anh Karaoke Beat',
          artist: 'Karaoke Beat',
          duration: 260,
          source: 'youtube',
        }),
      ]

      const best = findBestYouTubeMatch(
        youtubeCandidates,
        originalTrack.title,
        originalTrack.artist,
        originalTrack.duration
      )

      expect(best).not.toBeNull()
      expect(best?.youtube_id).toBe('FN7ALfpGxiI')
    })

    it('rejects long compilation videos (> 20 mins) when looking for a single song fallback', () => {
      const originalTrack = createMockTrack({
        id: 'sp-1',
        title: 'Chúng Ta Của Tương Lai',
        artist: 'Sơn Tùng M-TP',
        duration: 250,
        source: 'spotify',
      })

      const compilationCandidate = createMockTrack({
        id: 'yt-compilation',
        youtube_id: 'compilation_id',
        title: 'Chúng Ta Của Tương Lai 1 Giờ Loop - Sơn Tùng M-TP',
        artist: 'Music Loop',
        duration: 3600, // 1 hour
        source: 'youtube',
      })

      const officialCandidate = createMockTrack({
        id: 'yt-official',
        youtube_id: 'real_id_123',
        title: 'SƠN TÙNG M-TP | CHÚNG TA CỦA TƯƠNG LAI | OFFICIAL AUDIO',
        artist: 'Sơn Tùng M-TP Official',
        duration: 255,
        source: 'youtube',
      })

      const best = findBestYouTubeMatch(
        [compilationCandidate, officialCandidate],
        originalTrack.title,
        originalTrack.artist,
        originalTrack.duration
      )

      expect(best?.youtube_id).toBe('real_id_123')
    })
  })

  describe('NhacCuaTui Stream URL Generation', () => {
    it('generates a valid stream proxy endpoint for NCT tracks', () => {
      const track: Pick<Track, 'source' | 'nhaccuatui_id'> = {
        source: 'nhaccuatui',
        nhaccuatui_id: 'nct_abc_123',
      }
      const streamUrl = getNhacCuaTuiStreamUrl(track)
      expect(streamUrl).toBe('/api/nhaccuatui/stream?id=nct_abc_123')
    })

    it('returns null if track does not have nhaccuatui source or id', () => {
      expect(getNhacCuaTuiStreamUrl({ source: 'spotify' as any, nhaccuatui_id: undefined })).toBeNull()
      expect(getNhacCuaTuiStreamUrl({ source: 'nhaccuatui', nhaccuatui_id: undefined })).toBeNull()
    })
  })
})
