'use client'

import React, { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { fetchSpotifyAlbumMeta, fetchFullAlbumTracks } from '@/lib/spotify'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { TrackRow } from '@/components/track/TrackRow'
import { TrackListSkeleton, HeroCardSkeleton } from '@/components/common/SkeletonLoader'
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
  const { playTrack, isShuffle, toggleShuffle } = usePlayer()

  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadAlbum() {
      setLoading(true)

      try {
        // 1. Check Supabase cache FIRST
        const { data: cached } = await supabase
          .from('spotify_albums')
          .select('*, tracks:tracks!spotify_album_id(*)')
          .eq('id', albumId)
          .single()

        if (
          cached &&
          cached.tracks &&
          Array.isArray(cached.tracks) &&
          cached.tracks.length > 0 &&
          cached.tracks.length === cached.total_tracks
        ) {
          // Sort tracks by disc_number ascending, then track_number ascending
          cached.tracks.sort((a: any, b: any) => {
            if ((a.disc_number || 1) !== (b.disc_number || 1)) {
              return (a.disc_number || 1) - (b.disc_number || 1)
            }
            return (a.track_number || 1) - (b.track_number || 1)
          })

          setAlbum({
            ...cached,
            tracks: cached.tracks.map((t: any) => ({ ...t, source: 'spotify' })),
          })
          setLoading(false)
          return
        }

        // 2. If missing or incomplete tracks in cache, fetch directly from Spotify API
        const albumMeta = await fetchSpotifyAlbumMeta(albumId)
        if (!albumMeta) {
          setLoading(false)
          return
        }

        const spotifyTracks = await fetchFullAlbumTracks(albumId)
        const systemUserId = '00000000-0000-4000-a000-000000000001'

        const tracksToSave = spotifyTracks.map((item: any) => ({
          user_id: systemUserId,
          title: item.name,
          artist: item.artists?.map((a: any) => a.name).join(', ') || albumMeta.artist,
          album: albumMeta.name,
          spotify_album_id: albumMeta.id,
          disc_number: item.disc_number || 1,
          track_number: item.track_number || 1,
          duration: Math.round((item.duration_ms || 0) / 1000),
          file_path: item.external_urls?.spotify || item.preview_url || `spotify:${item.id}`,
          cover_url: albumMeta.cover_url,
          spotify_id: item.id,
        }))

        // Upsert album into spotify_albums table
        await supabase.from('spotify_albums').upsert({
          id: albumMeta.id,
          name: albumMeta.name,
          artist: albumMeta.artist,
          cover_url: albumMeta.cover_url,
          release_date: albumMeta.release_date,
          total_tracks: albumMeta.total_tracks || tracksToSave.length,
          album_type: albumMeta.album_type,
        })

        // Insert tracks into tracks table
        if (tracksToSave.length > 0) {
          try {
            await supabase.from('tracks').upsert(tracksToSave, {
              onConflict: 'user_id,title,artist',
              ignoreDuplicates: true,
            })
          } catch (upsertErr) {
            console.warn('Upsert tracks warning:', upsertErr)
          }
        }

        // Re-select saved tracks from DB to retrieve generated UUID primary keys
        const { data: dbTracks } = await supabase
          .from('tracks')
          .select('*')
          .eq('spotify_album_id', albumMeta.id)
          .order('disc_number', { ascending: true })
          .order('track_number', { ascending: true })

        const finalTracks: Track[] = (dbTracks && dbTracks.length === spotifyTracks.length ? dbTracks : tracksToSave).map((t: any) => ({
          ...t,
          source: 'spotify' as const,
        }))

        setAlbum({
          ...albumMeta,
          tracks: finalTracks,
        })
      } catch (err) {
        console.error('Failed to get or fetch album:', err)
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
    <div className="p-3.5 sm:p-6 md:p-8 flex flex-col gap-4 sm:gap-6 md:gap-8 max-w-7xl mx-auto w-full pb-36 md:pb-8 select-none">
      {/* Album Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] p-4 sm:p-6 md:p-8 bg-[#0c1017] flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-8">
        {/* Cover Art */}
        <div className="w-32 h-32 sm:w-40 sm:h-40 md:w-48 md:h-48 bg-slate-900 rounded-2xl flex items-center justify-center shrink-0 border border-white/10 shadow-2xl overflow-hidden relative group">
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
            <span>Spotify Album</span>
          </p>

          <h1 className="text-xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight">
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
              {discTracks.map((track, idx) => (
                <TrackRow
                  key={track.id || `track-${discNum}-${idx}`}
                  track={track}
                  index={idx}
                  playlistTracks={album.tracks}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
