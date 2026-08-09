'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SpotifyAlbumItem } from '@/lib/spotify'
import { DiscAlbum, Sparkles, Music, Play, Search, X, Loader2 } from 'lucide-react'
import { HeroCardSkeleton } from '@/components/common/SkeletonLoader'

interface AlbumCardProps {
  album: SpotifyAlbumItem
}

function AlbumCard({ album }: AlbumCardProps) {
  const releaseYear = album.release_date ? album.release_date.split('-')[0] : ''

  return (
    <Link
      href={`/album/${album.id}`}
      className="group relative bg-[#0e131f]/60 hover:bg-[#141b2d]/80 border border-white/[0.06] hover:border-cyan-500/30 rounded-2xl p-3.5 transition-all duration-300 flex flex-col gap-3 shadow-md hover:shadow-cyan-500/10 hover:-translate-y-1"
    >
      {/* Cover Image Container */}
      <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-slate-900 border border-white/10 shadow-inner">
        {album.cover_url ? (
          <img
            src={album.cover_url}
            alt={album.name}
            className="w-full h-full object-cover scale-[1.05] group-hover:scale-110 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-500">
            <DiscAlbum className="w-12 h-12" />
          </div>
        )}

        {/* Floating Album Type Badge */}
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-[10px] font-mono text-cyan-300 uppercase tracking-wider">
          {album.album_type === 'single' ? 'Single / EP' : 'Album'}
        </div>

        {/* Hover Overlay Play Button */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center backdrop-blur-[2px]">
          <div className="w-12 h-12 rounded-full bg-[var(--primary-spotify,#06b6d4)] text-black flex items-center justify-center shadow-xl shadow-cyan-500/30 transform group-hover:scale-110 transition-transform duration-200">
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1 min-w-0">
        <h3 className="text-xs font-bold text-white truncate group-hover:text-[var(--primary-spotify,#06b6d4)] transition-colors">
          {album.name}
        </h3>
        <p className="text-[11px] text-slate-400 truncate font-medium">
          {album.artist}
        </p>

        <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 mt-1">
          {releaseYear && <span>{releaseYear}</span>}
          {releaseYear && album.total_tracks > 0 && <span>•</span>}
          {album.total_tracks > 0 && <span>{album.total_tracks} bài</span>}
        </div>
      </div>
    </Link>
  )
}

export default function AlbumsPage() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const [listenedAlbums, setListenedAlbums] = useState<SpotifyAlbumItem[]>([])
  const [newReleases, setNewReleases] = useState<SpotifyAlbumItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState<'all' | 'albums' | 'singles'>('all')

  // Search state
  const [albumQuery, setAlbumQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SpotifyAlbumItem[]>([])
  const [searching, setSearching] = useState(false)

  // Read URL query parameter ?q=... when navigating from PlayerBar or TrackRow
  useEffect(() => {
    const q = searchParams.get('q') || searchParams.get('search')
    if (q) {
      setAlbumQuery(q)
    }
  }, [searchParams])

  useEffect(() => {
    async function loadAlbumsData() {
      setLoading(true)

      // Source A: User Listened Albums stored in Supabase
      try {
        const { data: myAlbums, error } = await supabase
          .from('spotify_albums')
          .select('*')
          .order('release_date', { ascending: false })
          .limit(30)

        if (!error && myAlbums) {
          const uniqueAlbums: SpotifyAlbumItem[] = []
          const seenKeys = new Set<string>()
          for (const alb of myAlbums) {
            const key = `${(alb.name || '').trim().toLowerCase()}::${(alb.artist || '').trim().toLowerCase()}`
            if (!seenKeys.has(key)) {
              seenKeys.add(key)
              uniqueAlbums.push(alb)
            }
          }
          setListenedAlbums(uniqueAlbums)
        }
      } catch (err) {
        console.warn('Error fetching listened albums from Supabase:', err)
      }

      // Source B: Discover New Releases from Deezer & Spotify via server route
      try {
        const res = await fetch('/api/albums/new-releases')
        if (res.ok) {
          const releases = await res.json()
          if (Array.isArray(releases)) setNewReleases(releases)
        }
      } catch (err) {
        console.warn('Error fetching new releases from API route:', err)
      }

      setLoading(false)
    }

    loadAlbumsData()
  }, [])

  // Live album search effect (debounced 400ms)
  useEffect(() => {
    if (!albumQuery.trim()) {
      setSearchResults([])
      setSearching(false)
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/albums/search?q=${encodeURIComponent(albumQuery.trim())}`)
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data)) {
            setSearchResults(data)
          }
        }
      } catch (e) {
        console.warn('Album search fetch error:', e)
      } finally {
        setSearching(false)
      }
    }, 400)

    return () => clearTimeout(timer)
  }, [albumQuery])

  const filterAlbums = (albums: SpotifyAlbumItem[]) => {
    if (activeFilter === 'albums') {
      return albums.filter((a) => a.album_type !== 'single')
    }
    if (activeFilter === 'singles') {
      return albums.filter((a) => a.album_type === 'single')
    }
    return albums
  }

  const filteredListened = filterAlbums(listenedAlbums)
  const filteredNew = filterAlbums(newReleases)
  const filteredSearch = filterAlbums(searchResults)

  return (
    <div className="p-3.5 sm:p-6 md:p-8 flex flex-col gap-5 sm:gap-8 max-w-7xl mx-auto w-full pb-36 md:pb-8 select-none">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] p-4 sm:p-6 md:p-8 bg-gradient-to-br from-[#0c121e] via-[#090e17] to-[#04060a] shadow-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-6">
        <div className="flex items-center gap-3.5 sm:gap-5">
          <div
            style={{
              backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
              borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
              color: 'var(--spotify-glow, #22d3ee)',
            }}
            className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl border flex items-center justify-center shadow-lg shrink-0"
          >
            <DiscAlbum className="w-6 h-6 sm:w-8 sm:h-8" />
          </div>
          <div>
            <div style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest mb-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>BỘ SƯU TẬP ALBUM NỔI BẬT</span>
            </div>
            <h1 className="text-xl sm:text-3xl font-extrabold text-white tracking-tight">
              Thư Viện Albums
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-md">
              Khám phá và tìm kiếm hơn 60+ album phát hành mới nhất trên toàn thế giới từ Deezer & Spotify.
            </p>
          </div>
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-1.5 p-1 bg-white/[0.04] border border-white/[0.08] rounded-2xl backdrop-blur-md shrink-0">
          <button
            onClick={() => setActiveFilter('all')}
            style={
              activeFilter === 'all'
                ? {
                    background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                    boxShadow: '0 4px 12px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                  }
                : undefined
            }
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeFilter === 'all'
                ? 'text-black shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Tất cả
          </button>
          <button
            onClick={() => setActiveFilter('albums')}
            style={
              activeFilter === 'albums'
                ? {
                    background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                    boxShadow: '0 4px 12px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                  }
                : undefined
            }
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeFilter === 'albums'
                ? 'text-black shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Albums
          </button>
          <button
            onClick={() => setActiveFilter('singles')}
            style={
              activeFilter === 'singles'
                ? {
                    background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                    boxShadow: '0 4px 12px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                  }
                : undefined
            }
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeFilter === 'singles'
                ? 'text-black shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Singles & EPs
          </button>
        </div>
      </div>

      {/* Album Search Input */}
      <div className="relative flex items-center w-full max-w-xl mx-auto">
        <Search className="w-4 h-4 text-slate-400 absolute left-4 pointer-events-none" />
        <input
          type="text"
          value={albumQuery}
          onChange={(e) => setAlbumQuery(e.target.value)}
          placeholder="Tìm kiếm Album theo tên đĩa nhạc, nghệ sĩ (Sơn Tùng, Taylor Swift, Coldplay...)"
          className="w-full bg-[#0d111a] border border-white/10 focus:border-[var(--primary-spotify,#06b6d4)]/60 focus:bg-[#111724] rounded-full pl-11 pr-10 py-2.5 text-xs text-white placeholder-slate-400 outline-none transition-all shadow-inner"
        />
        {searching ? (
          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin absolute right-3.5" />
        ) : albumQuery ? (
          <button
            onClick={() => setAlbumQuery('')}
            className="absolute right-3.5 p-0.5 text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-col gap-8">
          <HeroCardSkeleton />
          <HeroCardSkeleton />
        </div>
      ) : albumQuery.trim() ? (
        /* Search Results Mode */
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-2 h-5 bg-cyan-400 rounded-full" />
              <h2 className="text-lg font-bold text-white tracking-wide">
                Kết quả tìm kiếm cho &quot;{albumQuery}&quot;
              </h2>
            </div>
            <span className="text-xs font-mono text-slate-500">
              {filteredSearch.length} albums
            </span>
          </div>

          {searching ? (
            <div className="flex flex-col gap-4">
              <HeroCardSkeleton />
            </div>
          ) : filteredSearch.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-5">
              {filteredSearch.map((album) => (
                <AlbumCard key={album.id} album={album} />
              ))}
            </div>
          ) : (
            <div className="p-12 rounded-2xl bg-white/[0.02] border border-white/[0.05] text-center text-slate-400">
              <p className="text-sm font-bold text-white">Không tìm thấy album nào phù hợp</p>
              <p className="text-xs mt-1 text-slate-500">Hãy thử tìm với tên nghệ sĩ hoặc tên album khác</p>
            </div>
          )}
        </div>
      ) : (
        /* Normal Discovery Mode */
        <div className="flex flex-col gap-10">
          {/* Section A: Listened Albums */}
          {filteredListened.length > 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-5 bg-cyan-400 rounded-full" />
                  <h2 className="text-lg font-bold text-white tracking-wide">
                    Album Đã Nghe
                  </h2>
                </div>
                <span className="text-xs font-mono text-slate-500">
                  {filteredListened.length} albums
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-5">
                {filteredListened.map((album) => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            </div>
          )}

          {/* Section B: New Releases & Top Discovery */}
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-5 bg-pink-500 rounded-full" />
                <h2 className="text-lg font-bold text-white tracking-wide">
                  Khám Phá Album Mới (Top Releases)
                </h2>
              </div>
              <span className="text-xs font-mono text-slate-500">
                {filteredNew.length} Albums • Deezer Top Charts
              </span>
            </div>

            {filteredNew.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 sm:gap-5">
                {filteredNew.map((album) => (
                  <AlbumCard key={album.id} album={album} />
                ))}
              </div>
            ) : (
              <div className="p-8 rounded-2xl bg-white/[0.02] border border-white/[0.05] text-center text-slate-400">
                <p className="text-xs">Không tìm thấy album phù hợp.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
