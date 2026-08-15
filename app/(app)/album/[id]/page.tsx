'use client'

import React, { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { TrackRow } from '@/components/track/TrackRow'
import { TrackListSkeleton, HeroCardSkeleton } from '@/components/common/SkeletonLoader'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { useSession } from 'next-auth/react'
import { addTrackToPlaylist } from '@/lib/trackPersistence'
import { getValidUserId } from '@/lib/accessControl'
import { stripAlbumIdPrefix } from '@/lib/albumId'
import { toast } from '@/components/ui/ToastContext'
import { Play, DiscAlbum, Calendar, Music, Shuffle, Disc } from 'lucide-react'

interface AlbumDetail {
  id: string
  name: string
  artist: string
  cover_url: string | null
  release_date: string
  total_tracks: number
  album_type: string
  tracks: Track[]
}

export default function AlbumDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: albumId } = use(params)
  const router = useRouter()
  const supabase = createClient()
  const { playTrack, currentTrack, isPlaying, isShuffle, toggleShuffle } = usePlayer()
  const { playlists } = usePlaylists()
  const { data: session } = useSession()

  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [loading, setLoading] = useState(true)

  const handleAddToPlaylist = async (playlistId: string, track: Track) => {
    const result = await addTrackToPlaylist(playlistId, track)
    toast(result.message, result.success ? 'success' : 'error', track.title)
  }

  useEffect(() => {
    async function loadAlbum() {
      setLoading(true)

      try {
        const cleanId = stripAlbumIdPrefix(albumId)
        const idVariants = Array.from(new Set([albumId, cleanId, `deezer-${cleanId}`, `itunes-${cleanId}`]))

        // 1. Try Supabase DB cache first
        const { data: cachedList } = await supabase
          .from('spotify_albums')
          .select('*, tracks:tracks!spotify_album_id(*)')
          .in('id', idVariants)
          .limit(1)

        const cached = cachedList && cachedList.length > 0 ? cachedList[0] : null

        if (
          cached &&
          cached.tracks &&
          Array.isArray(cached.tracks) &&
          cached.tracks.length > 0 &&
          cached.tracks.length >= (cached.total_tracks || 1)
        ) {
          cached.tracks.sort((a: any, b: any) => {
            if ((a.disc_number || 1) !== (b.disc_number || 1)) {
              return (a.disc_number || 1) - (b.disc_number || 1)
            }
            return (a.track_number || 1) - (b.track_number || 1)
          })

          setAlbum({
            ...cached,
            tracks: cached.tracks.map((t: any) => ({
              ...t,
              album: cached.name || t.album,
              spotify_album_id: cached.id || t.spotify_album_id,
              cover_url: t.cover_url || cached.cover_url || null,
              source: t.source || 'spotify',
            })),
          })
          setLoading(false)
          return
        }

        // 2. Fetch from server API route (/api/albums/[id])
        const res = await fetch(`/api/albums/${encodeURIComponent(albumId)}`)
        if (res.ok) {
          const data = await res.json()
          if (data && Array.isArray(data.tracks)) {
            setAlbum({
              ...data,
              tracks: data.tracks.map((t: any) => ({
                ...t,
                album: data.name || t.album,
                spotify_album_id: data.id || t.spotify_album_id,
                cover_url: t.cover_url || data.cover_url || null,
              })),
            })
            setLoading(false)
            return
          }
        }
      } catch (err) {
        console.error('Failed to load album:', err)
      } finally {
        setLoading(false)
      }
    }

    loadAlbum()
  }, [albumId])

  if (loading) {
    return (
      <div className="p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto w-full">
        <HeroCardSkeleton />
        <div className="flex flex-col gap-4">
          <div className="w-48 h-6 bg-slate-800 rounded-lg animate-pulse" />
          <TrackListSkeleton count={8} />
        </div>
      </div>
    )
  }

  if (!album) {
    return (
      <div className="p-8 text-center py-16 text-slate-400">
        <p className="text-lg font-bold text-white">Không tìm thấy Album</p>
        <p className="text-xs mt-1">Album này không tồn tại hoặc đã bị gỡ bỏ.</p>
      </div>
    )
  }

  // Check if album contains multiple discs
  const hasMultipleDiscs = album.tracks.some((t) => (t.disc_number || 1) > 1)

  // Group tracks by disc number for multi-disc display
  const discMap = new Map<number, Track[]>()
  album.tracks.forEach((track) => {
    const discNum = track.disc_number || 1
    if (!discMap.has(discNum)) {
      discMap.set(discNum, [])
    }
    discMap.get(discNum)!.push(track)
  })
  const sortedDiscs = Array.from(discMap.entries()).sort(([a], [b]) => a - b)

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col gap-4 sm:gap-6 lg:gap-8 max-w-7xl mx-auto w-full pb-36 lg:pb-8 select-none">
      {/* Album Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] p-4 sm:p-6 lg:p-8 bg-[#0c1017] flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8">
        {/* Cover Art */}
        <div className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 bg-slate-900 rounded-2xl flex items-center justify-center shrink-0 border border-white/10 shadow-2xl overflow-hidden relative group">
          {album.cover_url ? (
            <img src={album.cover_url} alt={album.name} className="w-full h-full object-cover" />
          ) : (
            <DiscAlbum className="w-16 h-16 text-cyan-400/80" />
          )}
          <div className="absolute top-2 left-2 px-2.5 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-cyan-300 uppercase tracking-wider">
            {album.album_type === 'single' ? 'Single / EP' : 'Album'}
          </div>
        </div>

        {/* Album Meta */}
        <div className="flex-1 flex flex-col gap-2.5 min-w-0">
          <p className="text-[11px] font-mono text-cyan-400 uppercase tracking-widest flex items-center gap-1.5">
            <Disc className="w-3.5 h-3.5" />
            <span>BỘ SƯU TẬP ALBUM</span>
          </p>

        <h1 className="text-xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight leading-tight">
            {album.name}
          </h1>

          <p className="text-sm font-semibold text-slate-300">
            {album.artist}
          </p>

          <div className="flex items-center gap-3 text-xs font-mono text-slate-400 mt-1">
            {album.release_date && (
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                {album.release_date}
              </span>
            )}
            {album.release_date && <span>•</span>}
            <span className="flex items-center gap-1">
              <Music className="w-3.5 h-3.5 text-slate-500" />
              {album.total_tracks} bài hát
            </span>
          </div>
        </div>
      </div>

      {/* Toolbar Controls */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-4">
        {album.tracks.length > 0 && (
          <>
            <button
              onClick={() => playTrack(album.tracks[0], album.tracks)}
              className="bg-[var(--primary-spotify,#06b6d4)] text-black font-extrabold px-6 py-3 rounded-full flex items-center gap-2 shadow-xl shadow-cyan-500/20 hover:scale-105 transition-all text-xs"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Phát Album</span>
            </button>

            <button
              onClick={() => {
                if (!isShuffle) toggleShuffle()
                const randomIdx = Math.floor(Math.random() * album.tracks.length)
                playTrack(album.tracks[randomIdx], album.tracks, randomIdx)
              }}
              className={`font-bold px-4 py-3 rounded-full flex items-center gap-2 text-xs transition-all border ${
                isShuffle
                  ? 'bg-[var(--primary-spotify)]/20 text-[var(--primary-spotify)] border-[var(--primary-spotify)]/40 shadow-lg'
                  : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
              }`}
            >
              <Shuffle className="w-4 h-4" />
              <span>Phát Ngẫu Nhiên</span>
            </button>
          </>
        )}
      </div>

      {/* Track List (Supports Multi-Disc Headers) */}
      <div className="flex flex-col gap-6">
        {sortedDiscs.map(([discNum, discTracks]) => (
          <div key={discNum} className="flex flex-col gap-2">
            {hasMultipleDiscs && (
              <div className="flex items-center gap-2 px-3 py-1 text-xs font-mono text-cyan-400 uppercase tracking-widest border-b border-white/[0.08] mb-1">
                <Disc className="w-3.5 h-3.5" />
                <span>Đĩa {discNum} (Disc {discNum})</span>
              </div>
            )}

            <div className="flex flex-col gap-1">
              {discTracks.map((track, idx) => {
                const isCurrent = currentTrack?.id === track.id
                const isPlayingThis = isCurrent && isPlaying
                return (
                  <TrackRow
                    key={track.id || `track-${discNum}-${idx}`}
                    track={track}
                    index={idx}
                    isCurrent={isCurrent}
                    isPlayingThis={isPlayingThis}
                    playlistTracks={album.tracks}
                    userPlaylists={playlists}
                    onAddToPlaylist={handleAddToPlaylist}
                    onPlayClick={() => playTrack(track, album.tracks)}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
