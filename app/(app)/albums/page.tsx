'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { Disc, Search, Play, Music, Loader2 } from 'lucide-react'

interface AlbumGroup {
  name: string
  artist: string
  cover_url: string | null
  tracks: Track[]
  totalDuration: number
}

export default function AlbumsPage() {
  const supabase = createClient()
  const { playTrack } = usePlayer()

  const [albums, setAlbums] = useState<AlbumGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const fetchAlbums = async () => {
      setLoading(true)
      try {
        const { data: rawTracks, error } = await supabase
          .from('tracks')
          .select('*')
          .order('created_at', { ascending: false })

        if (!error && rawTracks) {
          const grouped: Record<string, AlbumGroup> = {}

          rawTracks.forEach((t: Track) => {
            const albumName = (t.album || 'Single & Remixes').trim()
            if (!grouped[albumName]) {
              grouped[albumName] = {
                name: albumName,
                artist: t.artist || 'Nghệ sĩ chưa xác định',
                cover_url: t.cover_url || null,
                tracks: [],
                totalDuration: 0,
              }
            }

            grouped[albumName].tracks.push(t)
            grouped[albumName].totalDuration += t.duration || 0

            if (!grouped[albumName].cover_url && t.cover_url) {
              grouped[albumName].cover_url = t.cover_url
            }
          })

          setAlbums(Object.values(grouped))
        }
      } catch (err) {
        console.error('Fetch albums error:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchAlbums()
  }, [])

  const filteredAlbums = albums.filter((a) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return a.name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)
  })

  return (
    <div className="p-4 sm:p-6 md:p-8 flex flex-col gap-6 md:gap-8 max-w-7xl mx-auto w-full pb-32 md:pb-8 select-none">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] p-6 md:p-8 bg-[#0d1017] flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
        <div className="flex items-center gap-4">
          <div
            style={{
              backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
              borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
              color: 'var(--spotify-glow, #22d3ee)',
            }}
            className="w-14 h-14 rounded-2xl border flex items-center justify-center shrink-0 shadow-md"
          >
            <Disc className="w-7 h-7" />
          </div>

          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Thư viện Album</h1>
            <p className="text-xs text-slate-400">
              Tổng hợp tất cả các bộ Album nhạc đặc sắc trong kho lưu trữ
            </p>
          </div>
        </div>

        <span className="text-xs font-mono text-slate-400 bg-white/5 border border-white/10 px-3.5 py-1.5 rounded-full">
          {albums.length} Album
        </span>
      </div>

      {/* Search Bar */}
      {albums.length > 0 && (
        <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm Album hoặc Nghệ sĩ..."
              className="w-full glass-input rounded-xl pl-10 pr-4 py-2.5 text-xs text-white outline-none"
            />
          </div>
        </div>
      )}

      {/* Main Albums Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="bg-white/[0.02] border border-white/[0.04] p-3.5 rounded-2xl animate-pulse flex flex-col gap-2.5">
              <div className="aspect-square bg-slate-800 rounded-xl" />
              <div className="h-3.5 bg-slate-700 rounded w-3/4" />
              <div className="h-2.5 bg-slate-800 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : filteredAlbums.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {filteredAlbums.map((album) => (
            <div
              key={album.name}
              className="bg-white/[0.02] hover:bg-white/[0.06] p-3.5 rounded-2xl flex flex-col gap-3 group transition-all duration-300 border border-white/[0.04] hover:border-[var(--spotify-glow)]/40 shadow-sm relative"
            >
              {/* Cover Art Thumbnail */}
              <Link href={`/album/${encodeURIComponent(album.name)}`} className="aspect-square bg-slate-800 rounded-xl overflow-hidden relative border border-white/10 flex items-center justify-center">
                {album.cover_url ? (
                  <img
                    src={album.cover_url}
                    alt={album.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                ) : (
                  <Disc style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-10 h-10 opacity-70 group-hover:scale-110 transition-transform duration-300" />
                )}

                {/* Track count badge */}
                <div className="absolute top-2 right-2 z-10">
                  <span
                    style={{ backgroundColor: 'var(--primary-spotify, #06b6d4)' }}
                    className="text-[9px] font-black uppercase tracking-wider text-black px-1.5 py-0.5 rounded shadow font-mono"
                  >
                    {album.tracks.length} bài
                  </span>
                </div>

                {/* Play button overlay */}
                <div
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    playTrack(album.tracks[0], album.tracks)
                  }}
                  className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-300"
                >
                  <div
                    style={{
                      background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                      boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.4))',
                    }}
                    className="w-11 h-11 rounded-full text-black flex items-center justify-center border border-white/20 transform group-hover:scale-100 scale-75 transition-all duration-300 cursor-pointer"
                  >
                    <Play className="w-5 h-5 fill-current text-black ml-0.5" />
                  </div>
                </div>
              </Link>

              {/* Info */}
              <div className="flex flex-col min-w-0">
                <Link
                  href={`/album/${encodeURIComponent(album.name)}`}
                  className="text-xs font-bold text-white truncate group-hover:text-[var(--spotify-glow,#22d3ee)] transition-colors"
                >
                  {album.name}
                </Link>
                <p className="text-[10px] text-slate-400 truncate mt-0.5">
                  {album.artist}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-panel p-12 rounded-3xl text-center border border-white/10 flex flex-col items-center gap-4 my-8">
          <div
            style={{
              backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
              borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
              color: 'var(--spotify-glow, #22d3ee)',
            }}
            className="w-16 h-16 rounded-2xl flex items-center justify-center border"
          >
            <Disc className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Chưa Có Album Nào</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Hãy upload bài hát hoặc liên kết với Google Drive để tự động tạo danh sách Album nhạc.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
