'use client'

import React, { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SpotifyAlbumItem } from '@/lib/spotify'
import { Track } from '@/types'
import { usePlayerControls } from '@/components/player/PlayerContext'
import { DiscAlbum, Sparkles, Music, Play, Search, X, Loader2 } from 'lucide-react'
import { HeroCardSkeleton } from '@/components/common/SkeletonLoader'
import { MediaCard } from '@/components/common/MediaCard'
import { useGridGlideIndicator } from '@/components/common/useGlideIndicator'

interface AlbumCardProps {
  album: SpotifyAlbumItem
  index?: number
}

function AlbumCard({ album, index = 0 }: AlbumCardProps) {
  const router = useRouter()
  const { playTrack } = usePlayerControls()
  const albumDetailCacheRef = useRef<Map<string, { detail: { tracks: Track[] } | null; at: number }> | null>(null)
  if (!albumDetailCacheRef.current) {
    albumDetailCacheRef.current = new Map()
  }

  const releaseYear = album.release_date ? album.release_date.split('-')[0] : ''
  const metaParts: string[] = []
  if (releaseYear) metaParts.push(releaseYear)
  if (album.total_tracks > 0) metaParts.push(`${album.total_tracks} bài`)
  const metaText = metaParts.join(' • ')

  const handlePlayAlbum = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      const cached = albumDetailCacheRef.current!.get(album.id)
      const detail =
        cached && Date.now() - cached.at < 10 * 60 * 1000
          ? cached.detail
          : await fetch(`/api/albums/${album.id}`).then((r) => (r.ok ? r.json() : null))
      if (detail && Array.isArray(detail.tracks) && detail.tracks.length > 0) {
        albumDetailCacheRef.current!.set(album.id, { detail, at: Date.now() })
        playTrack(detail.tracks[0], detail.tracks)
      } else {
        router.push(`/album/${album.id}`)
      }
    } catch {
      router.push(`/album/${album.id}`)
    }
  }

  return (
    <MediaCard
      id={album.id}
      title={album.name}
      subtitle={album.artist}
      coverUrl={album.cover_url}
      type={album.album_type === 'single' ? 'single' : 'album'}
      badgeLabel={album.album_type === 'single' ? 'Single / EP' : 'Album'}
      metaText={metaText}
      href={`/album/${album.id}`}
      onPlay={handlePlayAlbum}
      index={index}
      fallbackIcon="album"
    />
  )
}


let cachedListenedAlbums: SpotifyAlbumItem[] = []
let cachedNewReleases: SpotifyAlbumItem[] = []
let albumsLastFetchedAt = 0
const ALBUMS_CACHE_TTL = 15 * 60 * 1000 // 15 mins

export default function AlbumsPage() {
  const supabase = createClient()
  const searchParams = useSearchParams()
  const [listenedAlbums, setListenedAlbums] = useState<SpotifyAlbumItem[]>(cachedListenedAlbums)
  const [newReleases, setNewReleases] = useState<SpotifyAlbumItem[]>(cachedNewReleases)
  const [loading, setLoading] = useState<boolean>(cachedListenedAlbums.length === 0 && cachedNewReleases.length === 0)

  const searchGrid = useGridGlideIndicator()
  const listenedGrid = useGridGlideIndicator()
  const newReleasesGrid = useGridGlideIndicator()

  // Search state
  const [albumQuery, setAlbumQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SpotifyAlbumItem[]>([])
  const [searching, setSearching] = useState(false)

  // Read URL query parameter ?q=... when navigating from PlayerBar or TrackRow
  useEffect(() => {
    const q = searchParams.get('q') || searchParams.get('search')
    if (q) {
      setAlbumQuery((prev) => (prev !== q ? q : prev))
    }
  }, [searchParams])

  useEffect(() => {
    async function loadAlbumsData() {
      const isCacheFresh =
        cachedListenedAlbums.length > 0 &&
        cachedNewReleases.length > 0 &&
        Date.now() - albumsLastFetchedAt < ALBUMS_CACHE_TTL
      if (!isCacheFresh) {
        if (cachedListenedAlbums.length === 0) setLoading(true)
      } else {
        setLoading(false)
        return
      }

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
          cachedListenedAlbums = uniqueAlbums
        }
      } catch (err) {
        console.warn('Error fetching listened albums from Supabase:', err)
      }

      // Source B: Discover New Releases from Deezer & Spotify via server route
      try {
        const res = await fetch('/api/albums/new-releases')
        if (res.ok) {
          const releases = await res.json()
          if (Array.isArray(releases)) {
            setNewReleases(releases)
            cachedNewReleases = releases
          }
        }
      } catch (err) {
        console.warn('Error fetching new releases from API route:', err)
      }

      albumsLastFetchedAt = Date.now()
      setLoading(false)
    }

    loadAlbumsData()
  }, [supabase])

  // Live album search effect (debounced 400ms) with AbortController
  useEffect(() => {
    if (!albumQuery.trim()) {
      setSearchResults((prev) => (prev.length > 0 ? [] : prev))
      setSearching((prev) => (prev ? false : prev))
      return
    }

    const controller = new AbortController()
    const currentQuery = albumQuery.trim()

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/albums/search?q=${encodeURIComponent(currentQuery)}`, {
          signal: controller.signal,
        })
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data) && albumQuery.trim() === currentQuery) {
            setSearchResults(data)
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') {
          console.warn('Album search fetch error:', e)
        }
      } finally {
        if (!controller.signal.aborted) {
          setSearching(false)
        }
      }
    }, 400)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [albumQuery])

  return (
    <div className="px-2.5 py-3 sm:px-4 sm:py-3.5 md:px-6 md:py-4 lg:px-7 lg:py-5 flex flex-col gap-3 sm:gap-4 md:gap-5 max-w-7xl mx-auto w-full pb-36 lg:pb-12 select-none">
      {/* Header Banner */}
      <div className="hero-banner relative overflow-hidden rounded-2xl border border-white/[0.08] p-3 sm:p-4 md:p-5 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div
            style={{
              backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
              borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
              color: 'var(--spotify-glow, #22d3ee)',
            }}
            className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-xl sm:rounded-2xl border flex items-center justify-center shadow-lg shrink-0"
          >
            <DiscAlbum className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7" />
          </div>
          <div>
            <div style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono uppercase tracking-widest mb-0.5 sm:mb-1">
              <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>BỘ SƯU TẬP ALBUM NỔI BẬT</span>
            </div>
            <h1 className="text-lg sm:text-2xl md:text-3xl font-extrabold text-white tracking-tight">
              Thư Viện Albums
            </h1>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 max-w-lg line-clamp-2 sm:line-clamp-none">
              Khám phá và tìm kiếm hơn 60+ album phát hành mới nhất trên toàn thế giới từ Deezer, Spotify & iTunes.
            </p>
          </div>
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
          className="w-full bg-[#0d111a] border border-white/10 focus:border-[var(--primary-spotify,#06b6d4)]/60 focus:bg-[#111724] rounded-full pl-11 pr-10 py-2 sm:py-2.5 text-xs text-white placeholder-slate-400 outline-none transition-all shadow-inner"
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
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Kết quả tìm kiếm cho:
              </span>
              <span className="text-xs font-bold text-cyan-400 font-mono">
                &ldquo;{albumQuery}&rdquo;
              </span>
            </div>
            <span className="text-xs font-mono text-slate-500">
              {searchResults.length} albums
            </span>
          </div>

          {searching ? (
            <div className="flex flex-col gap-4">
              <HeroCardSkeleton />
            </div>
          ) : searchResults.length > 0 ? (
            <div
              ref={searchGrid.containerRef}
              onMouseLeave={searchGrid.handleContainerMouseLeave}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 xs:gap-3.5 sm:gap-4 lg:gap-5 relative"
            >
              <div
                className="grid-glide-indicator"
                style={{
                  transform: `translate3d(${searchGrid.indicator.left}px, ${searchGrid.indicator.top}px, 0) scale(${searchGrid.indicator.scaleX}, ${searchGrid.indicator.scaleY})`,
                  width: `${searchGrid.indicator.width}px`,
                  height: `${searchGrid.indicator.height}px`,
                  opacity: searchGrid.indicator.opacity,
                }}
              />
              {searchResults.map((album, idx) => (
                <div
                  key={album.id}
                  onMouseEnter={searchGrid.handleItemMouseEnter}
                  className="relative z-[1] h-full"
                >
                  <AlbumCard album={album} index={idx} />
                </div>
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
        <div className="flex flex-col gap-8 sm:gap-10">
          {/* Section A: Listened Albums */}
          {listenedAlbums.length > 0 && (
            <div className="flex flex-col gap-3.5 sm:gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-2 h-5 bg-cyan-400 rounded-full" />
                  <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
                    Album Đã Nghe
                  </h2>
                </div>
                <span className="text-xs font-mono text-slate-500">
                  {listenedAlbums.length} albums
                </span>
              </div>

              <div
                ref={listenedGrid.containerRef}
                onMouseLeave={listenedGrid.handleContainerMouseLeave}
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 xs:gap-3.5 sm:gap-4 lg:gap-5 relative"
              >
                <div
                  className="grid-glide-indicator"
                  style={{
                    transform: `translate3d(${listenedGrid.indicator.left}px, ${listenedGrid.indicator.top}px, 0) scale(${listenedGrid.indicator.scaleX}, ${listenedGrid.indicator.scaleY})`,
                    width: `${listenedGrid.indicator.width}px`,
                    height: `${listenedGrid.indicator.height}px`,
                    opacity: listenedGrid.indicator.opacity,
                  }}
                />
                {listenedAlbums.map((album, idx) => (
                  <div
                    key={album.id}
                    onMouseEnter={listenedGrid.handleItemMouseEnter}
                    className="relative z-[1] h-full"
                  >
                    <AlbumCard album={album} index={idx} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section B: New Releases & Top Discovery */}
          <div className="flex flex-col gap-3.5 sm:gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-5 bg-pink-500 rounded-full" />
                <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
                  Khám Phá Album Mới (Top Releases)
                </h2>
              </div>
              <span className="text-xs font-mono text-slate-500">
                {newReleases.length} Albums • 3 Nền Tảng
              </span>
            </div>

            {newReleases.length > 0 ? (
              <div
                ref={newReleasesGrid.containerRef}
                onMouseLeave={newReleasesGrid.handleContainerMouseLeave}
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 xs:gap-3.5 sm:gap-4 lg:gap-5 relative"
              >
                <div
                  className="grid-glide-indicator"
                  style={{
                    transform: `translate3d(${newReleasesGrid.indicator.left}px, ${newReleasesGrid.indicator.top}px, 0) scale(${newReleasesGrid.indicator.scaleX}, ${newReleasesGrid.indicator.scaleY})`,
                    width: `${newReleasesGrid.indicator.width}px`,
                    height: `${newReleasesGrid.indicator.height}px`,
                    opacity: newReleasesGrid.indicator.opacity,
                  }}
                />
                {newReleases.map((album, idx) => (
                  <div
                    key={album.id}
                    onMouseEnter={newReleasesGrid.handleItemMouseEnter}
                    className="relative z-[1] h-full"
                  >
                    <AlbumCard album={album} index={idx} />
                  </div>
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
