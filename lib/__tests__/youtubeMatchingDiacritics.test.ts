import { describe, it, expect } from 'vitest'
import { findBestYouTubeMatch } from '../youtube'
import { Track } from '@/types'

describe('YouTube Matching: Vietnamese Diacritics & Unaccented Matching', () => {
  it('matches target with diacritics against unaccented YouTube candidate', () => {
    const candidates: Track[] = [
      {
        id: 'yt-1',
        title: 'Chung Ta Cua Tuong Lai - Son Tung M-TP (Official Audio)',
        artist: 'Son Tung M-TP - Topic',
        duration: 250,
        youtube_id: 'vid-audio-1',
      },
      {
        id: 'yt-2',
        title: 'Chung Ta Cua Tuong Lai Cover',
        artist: 'Cover Channel',
        duration: 250,
        youtube_id: 'vid-cover-2',
      },
    ]

    const match = findBestYouTubeMatch(
      candidates,
      'Chúng Ta Của Tương Lai',
      'Sơn Tùng M-TP',
      250
    )

    expect(match).not.toBeNull()
    expect(match?.youtube_id).toBe('vid-audio-1')
  })

  it('handles Đ/đ conversion (e.g. Đừng Làm Trái Tim Anh Đau -> Dung Lam Trai Tim Anh Dau)', () => {
    const candidates: Track[] = [
      {
        id: 'yt-1',
        title: 'Dung Lam Trai Tim Anh Dau - Son Tung M-TP (Official MV)',
        artist: 'Sơn Tùng M-TP Official',
        duration: 330,
        youtube_id: 'vid-dung-lam-trai-tim',
      },
    ]

    const match = findBestYouTubeMatch(
      candidates,
      'Đừng Làm Trái Tim Anh Đau',
      'Sơn Tùng M-TP',
      330
    )

    expect(match).not.toBeNull()
    expect(match?.youtube_id).toBe('vid-dung-lam-trai-tim')
  })

  it('matches unaccented target against candidate with diacritics (reverse case)', () => {
    const candidates: Track[] = [
      {
        id: 'yt-1',
        title: 'Chúng Ta Của Hiện Tại - Sơn Tùng M-TP (Official Music Video)',
        artist: 'Sơn Tùng M-TP Official',
        duration: 300,
        youtube_id: 'vid-hien-tai',
      },
    ]

    const match = findBestYouTubeMatch(
      candidates,
      'Chung Ta Cua Hien Tai',
      'Son Tung M-TP',
      300
    )

    expect(match).not.toBeNull()
    expect(match?.youtube_id).toBe('vid-hien-tai')
  })

  it('matches "Để Mị Nói Cho Mà Nghe" (multiple tones and đ)', () => {
    const candidates: Track[] = [
      {
        id: 'yt-1',
        title: 'De Mi Noi Cho Ma Nghe - Hoang Thuy Linh',
        artist: 'Hoang Thuy Linh Official',
        duration: 200,
        youtube_id: 'vid-de-mi',
      },
    ]

    const match = findBestYouTubeMatch(
      candidates,
      'Để Mị Nói Cho Mà Nghe',
      'Hoàng Thùy Linh',
      200
    )

    expect(match).not.toBeNull()
    expect(match?.youtube_id).toBe('vid-de-mi')
  })
})
