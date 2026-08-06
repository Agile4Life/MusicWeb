'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { Disc, Search, Play, Cloud, Globe } from 'lucide-react'

export interface RealOfficialAlbum {
  id: string
  name: string
  artist: string
  cover_url: string | null
  trackCount: number
  releaseDate?: string
  source: 'spotify' | 'itunes' | 'local' | 'youtube' | 'audius'
}

export default function AlbumsPage() {
  const supabase = createClient()
  const { playTrack } = usePlayer()

  const [albums, setAlbums] = useState<RealOfficialAlbum[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'spotify' | 'itunes' | 'drive'>('all')

  useEffect(() => {
    const fetchOfficialAlbums = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/albums')
        if (res.ok) {
          const data = await res.json()
          setAlbums(data.albums || [])
        }
      } catch (err) {
        console.error('Fetch official albums error:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchOfficialAlbums()
  }, [])

  const filteredAlbums = albums.filter((album) => {
    // Source filter
    if (sourceFilter === 'spotify' && album.source !== 'spotify') return false
    if (sourceFilter === 'itunes' && album.source !== 'itunes') return false
    if (sourceFilter === 'drive' && album.source !== 'local') return false

    // Search query filter
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return album.name.toLowerCase().includes(q) || album.artist.toLowerCase().includes(q)
  })

  const playOfficialAlbum = async (album: RealOfficialAlbum) => {
    try {
      // Fetch official tracks for this album
      const res = await fetch(`/api/search?q=${encodeURIComponent(album.name)}`)
      if (res.ok) {
        const data = await res.json()
        const tracks = [
          ...(data.spotify || []),
          ...(data.itunes || []),
          ...(data.local || []),
          ...(data.youtube || []),
        ]
        if (tracks.length > 0) {
          playTrack(tracks[0], tracks)
        }
      }
    } catch (err) {
      console.warn('Play official album error:', err)
    }
  }

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
            <h1 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
              <span>Thư Viện Album Chính Thức</span>
              <Globe className="w-5 h-5 text-[var(--spotify-glow,#22d3ee)] animate-pulse" />
            </h1>
            <p className="text-xs text-slate-400">
              Tổng hợp tất cả các Album âm nhạc chính thức từ Spotify Global, iTunes Charts & Kho nhạc cá nhân
            </p>
          </div>
        </div>

        <span className="text-xs font-mono text-slate-400 bg-white/5 border border-white/10 px-3.5 py-1.5 rounded-full">
          {albums.length} Album Chính Thức
        </span>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-4">
        {/* Source Filter Tabs */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar touch-pan-x pr-2 py-0.5">
          <button
            onClick={() => setSourceFilter('all')}
            style={
              sourceFilter === 'all'
                ? {
                    background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                    boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                  }
                : undefined
            }
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
              sourceFilter === 'all'
                ? 'text-black font-extrabold border border-white/20'
                : 'bg-white/5 text-slate-400 hover:text-white border border-white/10 hover:bg-white/10'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Tất Cả Album ({albums.length})</span>
          </button>

          <button
            onClick={() => setSourceFilter('spotify')}
            style={
              sourceFilter === 'spotify'
                ? {
                    background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                    boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                  }
                : undefined
            }
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
              sourceFilter === 'spotify'
                ? 'text-black font-extrabold border border-white/20'
                : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30'
            }`}
          >
            <span>Spotify Global Albums</span>
          </button>

          <button
            onClick={() => setSourceFilter('itunes')}
            style={
              sourceFilter === 'itunes'
                ? {
                    background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                    boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                  }
                : undefined
            }
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
              sourceFilter === 'itunes'
                ? 'text-black font-extrabold border border-white/20'
                : 'bg-pink-500/10 text-pink-300 hover:bg-pink-500/20 border border-pink-500/30'
            }`}
          >
            <span>iTunes Top Albums</span>
          </button>

          <button
            onClick={() => setSourceFilter('drive')}
            style={
              sourceFilter === 'drive'
                ? {
                    background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                    boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                  }
                : undefined
            }
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 ${
              sourceFilter === 'drive'
                ? 'text-black font-extrabold border border-white/20'
                : 'bg-white/5 text-slate-400 hover:text-white border border-white/10 hover:bg-white/10'
            }`}
          >
            <Cloud className="w-3.5 h-3.5" />
            <span>Drive / Cá Nhân</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-72 shrink-0">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm Album hoặc Nghệ sĩ..."
            className="w-full glass-input rounded-xl pl-10 pr-4 py-2.5 text-xs text-white outline-none"
          />
        </div>
      </div>

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
              key={album.id || album.name}
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

                {/* Source Badge */}
                <div className="absolute top-2 right-2 z-10">
                  {album.source === 'spotify' && (
                    <span className="text-[8px] font-mono font-bold uppercase tracking-wider bg-emerald-500/90 text-black px-1.5 py-0.5 rounded shadow">
                      Spotify
                    </span>
                  )}
                  {album.source === 'itunes' && (
                    <span className="text-[8px] font-mono font-bold uppercase tracking-wider bg-pink-500/90 text-white px-1.5 py-0.5 rounded shadow">
                      iTunes
                    </span>
                  )}
                  {album.source === 'local' && (
                    <span className="text-[8px] font-mono font-bold uppercase tracking-wider bg-cyan-500 text-black px-1.5 py-0.5 rounded shadow">
                      Drive
                    </span>
                  )}
                </div>

                {/* Play button overlay */}
                <div
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    playOfficialAlbum(album)
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
                <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                  <span className="truncate">{album.artist}</span>
                  <span className="font-mono text-slate-500 shrink-0 ml-1">{album.trackCount} bài</span>
                </div>
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
            <h3 className="text-lg font-bold text-white mb-1">Không Tìm Thấy Album Phù Hợp</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Thử chọn bộ lọc khác hoặc nhập từ khóa tìm kiếm Album mới.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
