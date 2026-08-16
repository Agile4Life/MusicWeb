'use client'

import React, { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { TrackRow } from '@/components/track/TrackRow'
import { TrackListSkeleton, HeroCardSkeleton } from '@/components/common/SkeletonLoader'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { addTrackToPlaylist } from '@/lib/trackPersistence'
import { toast } from '@/components/ui/ToastContext'
import { deduplicateQueueTracks } from '@/lib/utils'
import { useListGlideIndicator } from '@/components/common/useGlideIndicator'
import {
  Play,
  Shuffle,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Music,
  Users,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Eye,
  Clock,
} from 'lucide-react'

interface ArtistInfo {
  id: string | number
  name: string
  picture_xl: string | null
  picture_big: string | null
  nb_fan: number
}

function formatFanCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

export default function ArtistPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const artistName = searchParams.get('name') || ''

  const { playTrack, currentTrack, isPlaying, isShuffle, toggleShuffle } = usePlayer()
  const { playlists } = usePlaylists()
  const {
    containerRef: listContainerRef,
    indicator: trackIndicator,
    handleItemMouseEnter: handleRowMouseEnter,
    handleContainerMouseLeave: handleListMouseLeave,
  } = useListGlideIndicator(52)

  const [artist, setArtist] = useState<ArtistInfo | null>(null)
  const [topTracks, setTopTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const INITIAL_COUNT = 5

  const handleAddToPlaylist = async (playlistId: string, track: Track) => {
    const result = await addTrackToPlaylist(playlistId, track)
    toast(result.message, result.success ? 'success' : 'error', track.title)
  }

  useEffect(() => {
    if (!artistName) {
      setLoading(false)
      setError('Không có tên nghệ sĩ')
      return
    }

    let isCancelled = false

    async function fetchArtist() {
      setLoading(true)
      setError(null)
      setShowAll(false)

      try {
        const res = await fetch(`/api/artist?name=${encodeURIComponent(artistName)}`)

        if (isCancelled) return

        if (!res.ok) {
          if (res.status === 404) {
            setError('Không tìm thấy nghệ sĩ')
          } else {
            setError('Đã xảy ra lỗi khi tải thông tin nghệ sĩ')
          }
          setLoading(false)
          return
        }

        const data = await res.json()
        if (isCancelled) return

        setArtist(data.artist)
        setTopTracks(data.topTracks || [])
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to load artist:', err)
          setError('Đã xảy ra lỗi khi tải thông tin nghệ sĩ')
        }
      } finally {
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    fetchArtist()

    return () => {
      isCancelled = true
    }
  }, [artistName])

  const displayTracks = showAll ? topTracks : topTracks.slice(0, INITIAL_COUNT)

  const handlePlayAll = () => {
    if (topTracks.length === 0) return
    const dedupedQueue = deduplicateQueueTracks(topTracks)
    playTrack(dedupedQueue[0], dedupedQueue, 0)
  }

  const handleShufflePlay = () => {
    if (topTracks.length === 0) return
    const dedupedQueue = deduplicateQueueTracks(topTracks)
    const randomIndex = Math.floor(Math.random() * dedupedQueue.length)
    if (!isShuffle) toggleShuffle()
    playTrack(dedupedQueue[randomIndex], dedupedQueue, randomIndex)
  }

  // Loading state
  if (loading) {
    return (
      <div className="p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto w-full">
        <HeroCardSkeleton />
        <TrackListSkeleton count={5} />
      </div>
    )
  }

  // Error/empty state
  if (error || !artist) {
    return (
      <div className="p-6 md:p-8 flex flex-col items-center justify-center gap-6 text-center min-h-[60vh]">
        <div className="w-20 h-20 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
          <AlertTriangle className="w-10 h-10 text-slate-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white mb-2">
            {error || 'Không tìm thấy nghệ sĩ'}
          </h2>
          <p className="text-sm text-slate-400">
            {artistName
              ? `Không tìm thấy thông tin cho "${artistName}"`
              : 'Vui lòng chọn một nghệ sĩ từ player'}
          </p>
        </div>
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-semibold border border-white/10 transition-all"
        >
          <ChevronLeft className="w-4 h-4" />
          Quay lại
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 lg:p-8 flex flex-col gap-6 md:gap-8 max-w-7xl mx-auto w-full">
      {/* Hero Section */}
      <div className="artist-hero relative flex flex-col sm:flex-row items-center sm:items-end gap-5 sm:gap-7 p-6 sm:p-8 rounded-2xl overflow-hidden">
        {/* Gradient Backdrop */}
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--primary-spotify,#06b6d4)]/20 via-[#07090e]/80 to-[#0f0b16] z-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07090e] via-transparent to-transparent z-0" />

        {/* Artist Avatar */}
        <div className="artist-avatar relative z-10 w-32 h-32 sm:w-36 sm:h-36 md:w-44 md:h-44 rounded-full overflow-hidden shrink-0 border-2 border-white/15 shadow-2xl">
          {artist.picture_xl || artist.picture_big ? (
            <img
              src={artist.picture_xl || artist.picture_big || ''}
              alt={artist.name}
              className="w-full h-full object-cover"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[var(--primary-spotify,#06b6d4)]/30 to-white/5 flex items-center justify-center">
              <Music className="w-16 h-16 text-slate-500" />
            </div>
          )}
        </div>

        {/* Artist Info */}
        <div className="relative z-10 flex flex-col items-center sm:items-start gap-3 pb-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-[var(--primary-spotify,#06b6d4)]/15 text-[var(--spotify-glow,#22d3ee)] border border-[var(--primary-spotify,#06b6d4)]/30 backdrop-blur-md shadow-sm">
              <CheckCircle2 className="w-3.5 h-3.5 text-[var(--spotify-glow,#22d3ee)] shrink-0" />
              Nghệ sĩ được xác minh
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black text-white leading-tight text-center sm:text-left">
            {artist.name}
          </h1>

          {/* Stats */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-sm text-slate-400">
            {artist.nb_fan > 0 && (
              <div className="flex items-center gap-1.5">
                <Users className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                <span className="font-semibold text-slate-200">
                  {formatFanCount(artist.nb_fan)} người hâm mộ
                </span>
              </div>
            )}
            {topTracks.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Music className="w-4 h-4 text-slate-400" />
                <span className="font-medium text-slate-300">{topTracks.length} bài hát phổ biến</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          {topTracks.length > 0 && (
            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={handlePlayAll}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold text-black transition-all hover:scale-105 hover:brightness-110 active:scale-95 border border-white/20 shadow-lg"
                style={{
                  background:
                    'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                  boxShadow:
                    '0 4px 16px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                }}
              >
                <Play className="w-4 h-4 fill-current" />
                Phát tất cả
              </button>
              <button
                onClick={handleShufflePlay}
                className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold text-slate-200 bg-white/10 hover:bg-white/15 transition-all hover:scale-105 active:scale-95 border border-white/10"
              >
                <Shuffle className="w-4 h-4" />
                Phát ngẫu nhiên
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Top Tracks Section */}
      {topTracks.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2 px-1">
            <Music className="w-4.5 h-4.5" style={{ color: 'var(--spotify-glow, #22d3ee)' }} />
            Bài hát phổ biến
          </h2>

          {/* Table Column Headers */}
          <div className="flex items-center justify-between px-3 md:px-4 py-2 text-xs font-semibold text-gray-400 border-b border-white/[0.08] mb-1 select-none">
            <div className="flex items-center gap-2.5 sm:gap-3 flex-1 min-w-0 pr-4">
              <span className="w-7 sm:w-8 text-center shrink-0 font-mono text-slate-400">#</span>
              <span className="text-[11px] font-mono tracking-wider font-semibold text-slate-400">TIÊU ĐỀ</span>
            </div>

            <div className="hidden md:block w-40 lg:w-52 xl:w-64 shrink-0 text-left text-[11px] font-mono tracking-wider font-semibold text-slate-400 px-2">
              ALBUM
            </div>

            <div className="hidden sm:flex items-center justify-end gap-1.5 w-24 md:w-28 shrink-0 text-[10px] font-mono uppercase text-slate-500 px-2" title="Lượt xem trên YouTube">
              <Eye className="w-3.5 h-3.5 text-slate-500" />
              <span>LƯỢT XEM</span>
            </div>

            <div className="w-14 sm:w-16 flex items-center justify-end shrink-0" title="Thời lượng">
              <Clock className="w-4 h-4 text-slate-400" />
            </div>

            <div className="w-10 shrink-0" />
          </div>

          <div
            ref={listContainerRef}
            onMouseLeave={handleListMouseLeave}
            className="flex flex-col gap-1 relative"
          >
            <div
              className="track-glide-indicator"
              style={{
                transform: `translateY(${trackIndicator.top}px) scaleY(${trackIndicator.scaleY})`,
                height: `${trackIndicator.height}px`,
                opacity: trackIndicator.opacity,
              }}
            />
            {displayTracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                isCurrent={currentTrack?.id === track.id}
                isPlayingThis={currentTrack?.id === track.id && isPlaying}
                onMouseEnterRow={handleRowMouseEnter}
                onPlayClick={() => {
                  const dedupedQueue = deduplicateQueueTracks(
                    showAll ? topTracks : topTracks.slice(0, INITIAL_COUNT)
                  )
                  const queueIndex = dedupedQueue.findIndex((t) => t.id === track.id)
                  playTrack(track, dedupedQueue, queueIndex >= 0 ? queueIndex : index)
                }}
                userPlaylists={playlists}
                onAddToPlaylist={(playlistId) => handleAddToPlaylist(playlistId, track)}
                playlistTracks={showAll ? topTracks : topTracks.slice(0, INITIAL_COUNT)}
              />
            ))}
          </div>

          {/* See More / Collapse Button */}
          {topTracks.length > INITIAL_COUNT && (
            <button
              onClick={() => setShowAll(!showAll)}
              className="flex items-center justify-center gap-2 mx-auto mt-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all active:scale-95"
            >
              {showAll ? (
                <>
                  <ChevronUp className="w-4 h-4" />
                  Thu gọn
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" />
                  Xem thêm
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* No tracks state */}
      {topTracks.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
          <Music className="w-12 h-12 text-slate-600" />
          <p className="text-sm text-slate-400">
            Không tìm thấy bài hát phổ biến cho nghệ sĩ này
          </p>
        </div>
      )}
    </div>
  )
}
