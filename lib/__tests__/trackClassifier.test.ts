import { describe, it, expect } from 'vitest'
import {
  classifyTrack,
  getGenreCompatibility,
  getStyleCompatibilityScore,
  isTrackStyleCompatible,
  buildStyleCoherentQueue,
} from '../trackClassifier'
import type { Track } from '@/types'

function makeMockTrack(overrides: Partial<Track>): Track {
  return {
    id: overrides.id || 'track-1',
    user_id: 'user-1',
    title: overrides.title || 'Untitled',
    artist: overrides.artist ?? 'Unknown Artist',
    album: overrides.album ?? null,
    genre: overrides.genre ?? null,
    duration: overrides.duration ?? 200,
    file_path: overrides.file_path ?? '',
    cover_url: overrides.cover_url ?? null,
    created_at: new Date().toISOString(),
    source: overrides.source,
  }
}

describe('trackClassifier — Multi-Signal Region & Genre Classification', () => {
  describe('Region detection', () => {
    it('correctly identifies Vietnamese tracks even when title is English or unaccented', () => {
      const monoTrack = classifyTrack({
        title: 'Waiting For You',
        artist: 'MONO',
      })
      expect(monoTrack.region).toBe('vn')
      expect(monoTrack.regionConfidence).toBe('high')

      const hthTrack = classifyTrack({
        title: 'Exit Sign',
        artist: 'HIEUTHUHAI',
      })
      expect(hthTrack.region).toBe('vn')
      expect(hthTrack.genre).toBe('rap')

      const unaccentedVn = classifyTrack({
        title: 'Anh Nho Em Nhieu Lam',
        artist: 'Indie Singer',
      })
      expect(unaccentedVn.region).toBe('vn')
    })

    it('correctly identifies K-Pop tracks with Hangul or English artist/title', () => {
      const illit = classifyTrack({
        title: 'Magnetic',
        artist: 'ILLIT',
      })
      expect(illit.region).toBe('kr')

      const hangulTrack = classifyTrack({
        title: '봄날 (Spring Day)',
        artist: '방탄소년단',
      })
      expect(hangulTrack.region).toBe('kr')
    })

    it('correctly identifies J-Pop and C-Pop tracks', () => {
      const jpop = classifyTrack({
        title: 'アイドル (Idol)',
        artist: 'YOASOBI',
      })
      expect(jpop.region).toBe('jp')

      const cpopArtist = classifyTrack({
        title: 'Mojito',
        artist: 'Jay Chou',
      })
      expect(cpopArtist.region).toBe('cn')

      const cpopKeyword = classifyTrack({
        title: 'Nhạc Hoa Douyin Hot Nhất',
        artist: 'Various Artists',
      })
      expect(cpopKeyword.region).toBe('cn')
    })

    it('correctly identifies US-UK tracks', () => {
      const usuk = classifyTrack({
        title: 'Blinding Lights',
        artist: 'The Weeknd',
      })
      expect(usuk.region).toBe('us')
      expect(usuk.regionConfidence).toBe('high')
    })

    it('uses nhaccuatui source signal when artist is unknown Vietnamese name', () => {
      const nctTrack = classifyTrack({
        id: 'nct-12345',
        title: 'Love Song',
        artist: 'Ca Si Moi',
        source: 'nhaccuatui',
      })
      expect(nctTrack.region).toBe('vn')
    })
  })

  describe('Genre detection & Compatibility Matrix', () => {
    it('detects artist default genre when title has no explicit genre keyword', () => {
      const ballad = classifyTrack({
        title: 'Nơi Tình Yêu Bắt Đầu',
        artist: 'Bùi Anh Tuấn',
      })
      expect(ballad.genre).toBe('ballad')

      const indie = classifyTrack({
        title: 'Bước Qua Nhau',
        artist: 'Vũ.',
      })
      expect(indie.genre).toBe('indie')

      const rap = classifyTrack({
        title: 'Chìm Sâu',
        artist: 'RPT MCK',
      })
      expect(rap.genre).toBe('rap')
    })

    it('overrides genre to remix when title contains remix/vinahouse keywords', () => {
      const remix = classifyTrack({
        title: 'Nơi Tình Yêu Bắt Đầu (Vinahouse Remix)',
        artist: 'Bùi Anh Tuấn',
      })
      expect(remix.genre).toBe('remix')
      expect(remix.subGenres).toContain('ballad')
    })

    it('enforces strict genre compatibility matrix (Ballad blocks Remix & Rap)', () => {
      expect(getGenreCompatibility('ballad', 'ballad')).toBe(1.0)
      expect(getGenreCompatibility('ballad', 'indie')).toBeGreaterThanOrEqual(0.75)
      expect(getGenreCompatibility('ballad', 'remix')).toBe(0)
      expect(getGenreCompatibility('ballad', 'rap')).toBe(0)
      expect(getGenreCompatibility('remix', 'ballad')).toBe(0)
    })

    it('blocks cross-region tracks and incompatible genres in isTrackStyleCompatible', () => {
      const vnBallad = { title: 'Hẹn Một Mai', artist: 'Bùi Anh Tuấn' }
      const vnIndie = { title: 'Lạ Lùng', artist: 'Vũ.' }
      const vnRemix = { title: 'Cắt Đôi Nỗi Sầu (Vinahouse Remix)', artist: 'Tăng Duy Tân' }
      const usPop = { title: 'Cruel Summer', artist: 'Taylor Swift' }
      const krPop = { title: 'Super Shy', artist: 'NewJeans' }

      expect(isTrackStyleCompatible(vnBallad, vnIndie)).toBe(true)
      expect(isTrackStyleCompatible(vnBallad, vnRemix)).toBe(false)
      expect(isTrackStyleCompatible(vnBallad, usPop)).toBe(false)
      expect(isTrackStyleCompatible(vnBallad, krPop)).toBe(false)
      expect(getStyleCompatibilityScore(vnBallad, vnIndie)).toBeGreaterThan(0.7)
      expect(getStyleCompatibilityScore(vnBallad, usPop)).toBe(0)
    })
  })

  describe('buildStyleCoherentQueue', () => {
    it('places seed track first, filters out mismatched regions/genres, and sorts by compatibility', () => {
      const seed = makeMockTrack({ id: 'vn-ballad-1', title: 'Hẹn Một Mai', artist: 'Bùi Anh Tuấn' })
      const usTrack = makeMockTrack({ id: 'us-1', title: 'Starboy', artist: 'The Weeknd' })
      const vnRemix = makeMockTrack({ id: 'vn-remix-1', title: 'Bay Lắc (Vinahouse Remix)', artist: 'DJ Việt' })
      const vnIndie = makeMockTrack({ id: 'vn-indie-1', title: 'Lạ Lùng', artist: 'Vũ.' })
      const vnBallad2 = makeMockTrack({ id: 'vn-ballad-2', title: 'Chiều Hôm Ấy', artist: 'JayKii' })
      const krTrack = makeMockTrack({ id: 'kr-1', title: 'Ditto', artist: 'NewJeans' })

      const pool = [usTrack, vnRemix, vnIndie, seed, krTrack, vnBallad2]
      const coherent = buildStyleCoherentQueue(seed, pool)

      expect(coherent[0].id).toBe('vn-ballad-1')
      const ids = coherent.map((t) => t.id)
      expect(ids).toContain('vn-ballad-2')
      expect(ids).toContain('vn-indie-1')
      expect(ids).not.toContain('us-1')
      expect(ids).not.toContain('vn-remix-1')
      expect(ids).not.toContain('kr-1')
      // Exact genre match (ballad) should rank ahead of secondary match (indie)
      expect(ids.indexOf('vn-ballad-2')).toBeLessThan(ids.indexOf('vn-indie-1'))
    })
  })
})

