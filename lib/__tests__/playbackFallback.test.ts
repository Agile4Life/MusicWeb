import { describe, expect, it } from 'vitest'
import { findBestYouTubeMatch, normalizeTitle } from '../youtube'
import { findBestSoundCloudMatch, stripNonIdentityAnnotations } from '../catalogMatching'
import { resolveCatalogCandidates } from '../catalogResolutionRace'
import { deduplicateQueueTracks, extractCoreSongTitle } from '../utils'
import { rankSearchTracks } from '../searchFlow'
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

  describe('Timeless, Risk It All & All The Stars Catalog Resolution & Deduplication', () => {
    it('rejects unrequested SoundCloud club edits hidden in the artist field for Timeless', () => {
      const scCandidates = [
        {
          id: '2118188892',
          title: 'TIMELESS',
          artist: 'THE WEEKND (NAHKODA BKB EDIT)',
          duration: 251,
        },
        {
          id: '1984708235',
          title: 'timeless x into it',
          artist: 'Weeknd 999',
          duration: 230,
        },
      ]

      const match = findBestSoundCloudMatch(scCandidates, {
        title: 'Timeless (feat Playboi Carti)',
        artist: 'The Weeknd, Playboi Carti',
        duration: 256,
      })

      expect(match).toBeNull()
    })

    it('selects Official Audio over Lyric Video on YouTube for Timeless', () => {
      const ytCandidates: Track[] = [
        createMockTrack({
          id: 'yt-mv',
          youtube_id: '5EpyN_6dqyk',
          title: 'The Weeknd, Playboi Carti - Timeless',
          artist: 'The Weeknd',
          duration: 256,
          source: 'youtube',
        }),
        createMockTrack({
          id: 'yt-lyric',
          youtube_id: '16jA-6hiSUo',
          title: 'The Weeknd, Playboi Carti - Timeless (Official Lyric Video)',
          artist: 'The Weeknd',
          duration: 256,
          source: 'youtube',
        }),
        createMockTrack({
          id: 'yt-audio',
          youtube_id: 'mX19AV35PhI',
          title: 'The Weeknd, Playboi Carti - Timeless (Audio)',
          artist: 'The Weeknd',
          duration: 256,
          source: 'youtube',
        }),
      ]

      const best = findBestYouTubeMatch(
        ytCandidates,
        'Timeless (feat Playboi Carti)',
        'The Weeknd, Playboi Carti',
        256
      )

      expect(best?.youtube_id).toBe('mX19AV35PhI')
    })

    it('selects Risk It All [HQ] by Bruno Mars on SoundCloud and rejects MONADVTCH EDIT', () => {
      const scCandidates = [
        {
          id: '2328016970',
          title: 'Risk It All [HQ]',
          artist: 'Bruno Mars',
          duration: 223,
        },
        {
          id: '2278323617',
          title: 'RISK IT ALL',
          artist: 'BRUNO MARS (MONADVTCH EDIT)',
          duration: 229,
        },
      ]

      const match = findBestSoundCloudMatch(scCandidates, {
        title: 'Risk It All',
        artist: 'Bruno Mars',
        duration: 204,
      })

      expect(match?.id).toBe('2328016970')
    })

    it('prefers official artist channel over third-party lyric (7clouds) and fan album channels on YouTube for Risk It All', () => {
      const ytCandidates: Track[] = [
        createMockTrack({
          id: 'yt-official-mv',
          youtube_id: 'lY5V4hSLWY8',
          title: 'Bruno Mars - Risk It All [Official Music Video]',
          artist: 'Bruno Mars',
          duration: 211,
          source: 'youtube',
        }),
        createMockTrack({
          id: 'yt-7clouds',
          youtube_id: 'Vk-iPksP-IA',
          title: 'Bruno Mars - Risk It All (Lyrics)',
          artist: '7clouds',
          duration: 204,
          source: 'youtube',
        }),
        createMockTrack({
          id: 'yt-fan-album',
          youtube_id: 'MdcoTp-vnBE',
          title: 'Bruno Mars - Risk It All [The Romantic]',
          artist: 'Bruno Mars - The Romantic ',
          duration: 205,
          source: 'youtube',
        }),
      ]

      const best = findBestYouTubeMatch(ytCandidates, 'Risk It All', 'Bruno Mars', 204, 'The Romantic')
      expect(best?.youtube_id).toBe('lY5V4hSLWY8')
    })

    it('deduplicates Timeless (feat Playboi Carti) and Timeless across providers even when another artist with the same title appears in between', () => {
      const tracks: Track[] = [
        createMockTrack({
          id: 'spotify-timeless-weeknd',
          title: 'Timeless (feat Playboi Carti)',
          artist: 'The Weeknd, Playboi Carti',
          duration: 256,
          source: 'spotify',
        }),
        createMockTrack({
          id: 'spotify-timeless-taylor',
          title: 'Timeless (From The Vault)',
          artist: 'Taylor Swift',
          duration: 321,
          source: 'spotify',
        }),
        createMockTrack({
          id: 'deezer-timeless-weeknd',
          title: 'Timeless',
          artist: 'The Weeknd',
          duration: 256,
          source: 'deezer',
        }),
      ]

      const deduped = deduplicateQueueTracks(tracks)
      const weekndTracks = deduped.filter((t) => (t.artist || '').toLowerCase().includes('weeknd'))
      expect(weekndTracks).toHaveLength(1)
      expect(deduped).toHaveLength(2)
    })

    it('gives primary fallback (SoundCloud) priority over secondary fallback (YouTube) when preferred (NCT) returns null early', async () => {
      const result = await resolveCatalogCandidates(
        async () => null, // NCT returns null immediately
        [
          async () => {
            await new Promise((r) => setTimeout(r, 40))
            return { source: 'soundcloud', id: '2328016970' }
          },
          async () => {
            await new Promise((r) => setTimeout(r, 10))
            return { source: 'youtube', id: 'lY5V4hSLWY8' }
          },
        ],
        200
      )

      expect(result).toEqual({ source: 'soundcloud', id: '2328016970' })
    })

    it('strips (with SZA) and - From "Black Panther: The Album" so All The Stars resolves and does not skip', () => {
      const spotifyTitle = 'All The Stars (with SZA) - From "Black Panther: The Album"'
      const deezerTitle = 'All The Stars (From "Black Panther: The Album")'

      expect(stripNonIdentityAnnotations(spotifyTitle)).toBe('all the stars')
      expect(stripNonIdentityAnnotations(deezerTitle)).toBe('all the stars')
      expect(normalizeTitle(spotifyTitle)).toBe('all the stars')
      expect(extractCoreSongTitle(spotifyTitle)).toBe('all the stars')

      const ytCandidates: Track[] = [
        createMockTrack({
          id: 'yt-1',
          youtube_id: 'JQbjS0_ZfJ0',
          title: 'Kendrick Lamar, SZA - All The Stars',
          artist: 'Kendrick Lamar',
          duration: 235,
          source: 'youtube',
        }),
        createMockTrack({
          id: 'yt-2',
          youtube_id: 'yvOh7vVqlaE',
          title: 'Kendrick Lamar, SZA - All The Stars (Lyrics)',
          artist: 'SyrebralVibes',
          duration: 231,
          source: 'youtube',
        }),
      ]

      const bestYt = findBestYouTubeMatch(
        ytCandidates,
        spotifyTitle,
        'Kendrick Lamar, SZA',
        232,
        'Black Panther The Album Music From And Inspired By'
      )
      expect(bestYt).not.toBeNull()
      expect(bestYt?.youtube_id).toBe('JQbjS0_ZfJ0')

      const ranked = rankSearchTracks(
        [
          createMockTrack({
            id: 'sc-cypher',
            title: 'On The Radar All-Star Cypher',
            artist: 'Vonoff1700',
            duration: 81,
            source: 'soundcloud',
          }),
          createMockTrack({
            id: 'deezer-other',
            title: 'All The Stars',
            artist: 'Lonely In The Rain',
            duration: 158,
            source: 'spotify',
          }),
          createMockTrack({
            id: 'spotify-kendrick',
            title: spotifyTitle,
            artist: 'Kendrick Lamar, SZA',
            duration: 232,
            source: 'spotify',
          }),
        ],
        'all the star'
      )

      expect(ranked[0]?.id).toBe('spotify-kendrick')
    })
  })
})


