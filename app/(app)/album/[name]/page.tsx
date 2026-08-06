'use client'

import React, { useEffect, useState, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { TrackList } from '@/components/track/TrackList'
import { TrackListSkeleton } from '@/components/common/SkeletonLoader'
import { Disc, Play, Shuffle, ArrowLeft, Globe } from 'lucide-react'
import Link from 'next/link'

function formatTotalDuration(seconds: number): string {
  const min = Math.floor(seconds / 60)
  const hours = Math.floor(min / 60)
  const remMin = min % 60

  if (hours > 0) {
    return `${hours} giờ ${remMin} phút`
  }
  return `${min} phút ${Math.floor(seconds % 60)} giây`
}

export default function AlbumDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const resolvedParams = use(params)
  const albumName = decodeURIComponent(resolvedParams.name)

  const { playTrack, isShuffle, toggleShuffle } = usePlayer()

  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [albumMeta, setAlbumMeta] = useState<{ artist: string; cover_url: string | null }>({
    artist: 'Nghệ sĩ chưa xác định',
    cover_url: null,
  })

  useEffect(() => {
    const fetchOfficialAlbumTracklist = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/album-tracks?name=${encodeURIComponent(albumName)}`)
        if (res.ok) {
          const data = await res.json()
          setTracks(data.tracks || [])
          setAlbumMeta({
            artist: data.artist || data.tracks?.[0]?.artist || 'Nghệ sĩ chưa xác định',
            cover_url: data.cover_url || data.tracks?.find((t: Track) => t.cover_url)?.cover_url || null,
          })
        }
      } catch (err) {
        console.error('Fetch official album tracklist error:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchOfficialAlbumTracklist()
  }, [albumName])

  const primaryCover = albumMeta.cover_url || tracks.find((t) => t.cover_url)?.cover_url || null
  const artistName = albumMeta.artist || tracks[0]?.artist || 'Nghệ sĩ chưa xác định'
  const totalSeconds = tracks.reduce((acc, t) => acc + (t.duration || 0), 0)

  return (
    <div className="p-4 sm:p-6 md:p-8 flex flex-col gap-6 md:gap-8 max-w-7xl mx-auto w-full pb-32 md:pb-8 select-none">
      {/* Back Button */}
      <div>
        <Link
          href="/albums"
          className="inline-flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 px-3.5 py-1.5 rounded-full border border-white/10 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Quay lại Thư viện Album</span>
        </Link>
      </div>

      {/* Album Detail Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-white/[0.08] p-6 sm:p-8 md:p-10 bg-[#0d1017] flex flex-col sm:flex-row items-center sm:items-end gap-6 md:gap-8 shadow-2xl">
        {/* Background Ambient Glow */}
        {primaryCover && (
          <div
            style={{ backgroundImage: `url(${primaryCover})` }}
            className="absolute inset-0 bg-cover bg-center opacity-15 blur-3xl scale-125 pointer-events-none"
          />
        )}

        {/* Album Artwork Cover */}
        <div className="w-40 h-40 sm:w-48 sm:h-48 md:w-56 md:h-56 rounded-2xl bg-slate-800 border border-white/15 overflow-hidden shrink-0 shadow-2xl relative flex items-center justify-center group z-10">
          {primaryCover ? (
            <img src={primaryCover} alt={albumName} className="w-full h-full object-cover" />
          ) : (
            <Disc style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-16 h-16 opacity-70" />
          )}
        </div>

        {/* Info & Action Buttons */}
        <div className="flex flex-col gap-3 min-w-0 flex-1 text-center sm:text-left z-10">
          <div className="flex items-center justify-center sm:justify-start gap-2">
            <span
              style={{ backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))', color: 'var(--spotify-glow, #22d3ee)' }}
              className="text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full border border-[var(--theme-glow-shadow)] font-mono flex items-center gap-1.5"
            >
              <Globe className="w-3 h-3" />
              <span>OFFICIAL ALBUM</span>
            </span>
          </div>

          <h1 className="text-2xl sm:text-3xl md:text-5xl font-black text-white tracking-tight leading-tight drop-shadow-md">
            {albumName}
          </h1>

          <div className="flex items-center justify-center sm:justify-start gap-2 text-xs md:text-sm font-semibold text-slate-300">
            <span className="font-bold text-white">{artistName}</span>
            <span>•</span>
            <span className="text-slate-400">{tracks.length} bài hát</span>
            {totalSeconds > 0 && (
              <>
                <span>•</span>
                <span className="text-slate-400 font-mono">{formatTotalDuration(totalSeconds)}</span>
              </>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-center sm:justify-start gap-3 mt-3">
            {tracks.length > 0 && (
              <>
                <button
                  onClick={() => playTrack(tracks[0], tracks)}
                  style={{
                    background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                    boxShadow: '0 4px 16px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                  }}
                  className="text-black font-extrabold px-6 py-3 rounded-full flex items-center gap-2 text-xs sm:text-sm transition-all hover:brightness-110 active:scale-95 border border-white/20"
                >
                  <Play className="w-4.5 h-4.5 fill-current text-black" />
                  <span>Phát Album</span>
                </button>

                <button
                  onClick={() => {
                    const randomIndex = Math.floor(Math.random() * tracks.length)
                    if (!isShuffle) toggleShuffle()
                    playTrack(tracks[randomIndex], tracks, randomIndex)
                  }}
                  className="bg-white/5 hover:bg-white/10 text-white border border-white/15 font-bold px-5 py-3 rounded-full flex items-center gap-2 text-xs sm:text-sm transition-all hover:scale-105"
                >
                  <Shuffle className="w-4 h-4" />
                  <span>Phát ngẫu nhiên</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Album Tracks Section */}
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-extrabold text-white flex items-center justify-between">
          <span>Danh sách bài hát chính thức trong Album</span>
          <span className="text-xs font-mono font-normal text-slate-400">Hiển thị {tracks.length} bài hát</span>
        </h2>

        {loading ? <TrackListSkeleton count={8} /> : <TrackList tracks={tracks} />}
      </div>
    </div>
  )
}
