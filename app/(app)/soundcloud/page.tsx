'use client'

import React, { useState, useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT, SPRING_UI } from '@/lib/motion'
import { useTheme } from '@/components/theme/ThemeContext'
import {
  Cloud,
  Search,
  Play,
  Disc,
  X,
  Loader2,
  ChevronDown,
  ArrowLeft,
  BookmarkPlus,
  TrendingUp,
} from 'lucide-react'
import { Track, SoundCloudPlaylist } from '@/types'
import { usePlayerControls } from '@/components/player/PlayerContext'
import { TrackList } from '@/components/track/TrackList'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { addTrackToPlaylist } from '@/lib/trackPersistence'
import { toast } from '@/components/ui/ToastContext'
import { TrackListSkeleton, MediaCardGridSkeleton } from '@/components/common/SkeletonLoader'
import { ImportSoundCloudModal } from '@/components/playlist/ImportSoundCloudModal'
import { MediaCard } from '@/components/common/MediaCard'

const GENRE_TABS = [
  { id: 'all-music', label: 'Tất cả', query: 'vietnam hit' },
  { id: 'indie', label: 'Indie', query: 'indie vietnam' },
  { id: 'remix', label: 'Việt Mix / Remix', query: 'vietnamese remix 2025' },
  { id: 'vinahouse', label: 'Vinahouse / EDM', query: 'vinahouse edm' },
  { id: 'lofi', label: 'Lofi & Chill', query: 'lofi chill viet nam' },
  { id: 'vpop', label: 'V-Pop Nhạc Trẻ', query: 'vpop hit 2025' },
  { id: 'mashup', label: 'Mashup & Bootleg', query: 'mashup vietnamese' },
  { id: 'phonk', label: 'Phonk & Bass', query: 'drift phonk bass' },
]

export default function SoundCloudPage() {
  const { playTrack } = usePlayerControls()
  const { playlists: userPlaylists, refreshPlaylists } = usePlaylists()
  const { themeStyle } = useTheme()
  const reduced = useReducedMotion()
  const isMinimalFlat = themeStyle === 'minimal-flat'

  const [activeTab, setActiveTab] = useState<string>('all-music')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [debouncedQuery, setDebouncedQuery] = useState<string>('')

  // Tracks State
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [loadingMore, setLoadingMore] = useState<boolean>(false)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [offset, setOffset] = useState<number>(0)

  // Playlists State
  const [playlists, setPlaylists] = useState<SoundCloudPlaylist[]>([])
  const [loadingPlaylists, setLoadingPlaylists] = useState<boolean>(true)
  const [selectedPlaylist, setSelectedPlaylist] = useState<SoundCloudPlaylist | null>(null)
  const [loadingPlaylistTracks, setLoadingPlaylistTracks] = useState<boolean>(false)

  // Import Modal State
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false)
  const [importInitialPlaylist, setImportInitialPlaylist] = useState<SoundCloudPlaylist | null>(null)
  const [importInitialTracks, setImportInitialTracks] = useState<Track[]>([])

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Handle Search Input Debounce
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setSearchQuery(val)

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(val.trim())
      setOffset(0)
      setSelectedPlaylist(null)
    }, 450)
  }

  const handleClearSearch = () => {
    setSearchQuery('')
    setDebouncedQuery('')
    setOffset(0)
    setSelectedPlaylist(null)
  }

  // Fetch Playlists & Tracks on Tab or Search change
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadingPlaylists(true)
    setOffset(0)
    setSelectedPlaylist(null)

    const fetchData = async () => {
      try {
        let currentQuery = ''
        if (debouncedQuery) {
          currentQuery = debouncedQuery
        } else {
          const currentTabObj = GENRE_TABS.find((t) => t.id === activeTab) || GENRE_TABS[0]
          currentQuery = currentTabObj.query
        }

        // Parallel fetch for Playlists and Tracks
        const [tracksRes, playlistsRes] = await Promise.allSettled([
          fetch(`/api/soundcloud/search?q=${encodeURIComponent(currentQuery)}&limit=50&offset=0`),
          fetch(`/api/soundcloud/playlists?q=${encodeURIComponent(currentQuery)}&limit=8`),
        ])

        if (!cancelled) {
          // Process Tracks
          if (tracksRes.status === 'fulfilled' && tracksRes.value.ok) {
            const trackData = await tracksRes.value.json()
            const fetched = trackData.tracks || []
            setTracks(fetched)
            setHasMore(fetched.length >= 20)
          } else {
            setTracks([])
            setHasMore(false)
          }

          // Process Playlists
          if (playlistsRes.status === 'fulfilled' && playlistsRes.value.ok) {
            const playlistData = await playlistsRes.value.json()
            setPlaylists(playlistData.playlists || [])
          } else {
            setPlaylists([])
          }
        }
      } catch (err) {
        console.error('[SoundCloudPage] Fetch error:', err)
        if (!cancelled) {
          setTracks([])
          setPlaylists([])
          setHasMore(false)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setLoadingPlaylists(false)
        }
      }
    }

    fetchData()

    return () => {
      cancelled = true
    }
  }, [activeTab, debouncedQuery])

  // Select and load a specific Playlist
  const handleSelectPlaylist = async (pl: SoundCloudPlaylist) => {
    setSelectedPlaylist(pl)
    setLoadingPlaylistTracks(true)

    try {
      const res = await fetch(`/api/soundcloud/playlists?id=${pl.id}`)
      if (res.ok) {
        const data = await res.json()
        if (data.tracks && data.tracks.length > 0) {
          setTracks(data.tracks)
          setHasMore(false)
        }
      }
    } catch (err) {
      console.error('[SoundCloudPage] Failed to load playlist tracks:', err)
    } finally {
      setLoadingPlaylistTracks(false)
    }
  }

  // Quick Play a Playlist
  const handlePlayPlaylist = async (e: React.MouseEvent | React.KeyboardEvent | undefined, pl: SoundCloudPlaylist) => {
    e?.stopPropagation()
    try {
      const res = await fetch(`/api/soundcloud/playlists?id=${pl.id}`)
      if (res.ok) {
        const data = await res.json()
        if (data.tracks && data.tracks.length > 0) {
          setSelectedPlaylist(pl)
          setTracks(data.tracks)
          setHasMore(false)
          playTrack(data.tracks[0], data.tracks)
        }
      }
    } catch (err) {
      console.error('[SoundCloudPage] Quick play playlist error:', err)
    }
  }

  // Clear selected playlist to return to general list
  const handleBackToExplore = () => {
    setSelectedPlaylist(null)
    setLoading(true)
    setOffset(0)

    const currentTabObj = GENRE_TABS.find((t) => t.id === activeTab) || GENRE_TABS[0]
    const currentQuery = debouncedQuery || currentTabObj.query

    fetch(`/api/soundcloud/search?q=${encodeURIComponent(currentQuery)}&limit=50&offset=0`)
      .then((res) => (res.ok ? res.json() : { tracks: [] }))
      .then((data) => {
        setTracks(data.tracks || [])
        setHasMore((data.tracks || []).length >= 20)
      })
      .catch(() => {
        setTracks([])
      })
      .finally(() => {
        setLoading(false)
      })
  }

  // Load More Handler for general tracks
  const handleLoadMore = async () => {
    if (loadingMore || !hasMore || selectedPlaylist) return
    setLoadingMore(true)
    const nextOffset = offset + 50

    try {
      let endpoint = ''
      if (debouncedQuery) {
        endpoint = `/api/soundcloud/search?q=${encodeURIComponent(debouncedQuery)}&limit=50&offset=${nextOffset}`
      } else {
        const currentTabObj = GENRE_TABS.find((t) => t.id === activeTab) || GENRE_TABS[0]
        endpoint = `/api/soundcloud/search?q=${encodeURIComponent(currentTabObj.query)}&limit=50&offset=${nextOffset}`
      }

      const res = await fetch(endpoint)
      if (res.ok) {
        const data = await res.json()
        const newTracks = data.tracks || []
        if (newTracks.length > 0) {
          setTracks((prev) => {
            const existingIds = new Set(prev.map((t) => t.id))
            const dedupedNew = newTracks.filter((t: Track) => !existingIds.has(t.id))
            return [...prev, ...dedupedNew]
          })
          setOffset(nextOffset)
          setHasMore(newTracks.length >= 20)
        } else {
          setHasMore(false)
        }
      } else {
        setHasMore(false)
      }
    } catch (err) {
      console.error('[SoundCloudPage] Load more error:', err)
    } finally {
      setLoadingMore(false)
    }
  }

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks)
    }
  }

  const handleAddToPlaylist = async (playlistId: string, track: Track) => {
    const result = await addTrackToPlaylist(playlistId, track)
    if (result.success) {
      toast(result.message || 'Đã thêm bài hát vào playlist!', 'success')
      refreshPlaylists()
    } else {
      toast(result.message || 'Lỗi thêm vào playlist', 'error')
    }
  }

  const handleTrackUpdated = (trackId: string, updates: Partial<Track>) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t))
    )
  }

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col gap-5 sm:gap-7 max-w-7xl mx-auto w-full pb-36 lg:pb-8 select-none">
      {/* SoundCloud Hero Banner */}
      <div className="hero-banner soundcloud-hero relative overflow-hidden rounded-2xl border border-[#ff5500]/25 p-5 sm:p-7 bg-gradient-to-br from-[#ff5500]/12 via-[#141114] to-[#0a0d14]">
        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
          <div className="flex items-center gap-4 sm:gap-5 min-w-0 flex-1">
            <div className="soundcloud-cloud-icon w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-gradient-to-br from-[#ff7700] to-[#ff3300] flex items-center justify-center text-white shrink-0 border border-white/15">
              <Cloud className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />
            </div>

            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl md:text-3xl font-display font-bold text-white tracking-tight truncate">
                SoundCloud
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 max-w-xl">
                Khám phá Top Playlists, bài hát thịnh hành, bản remix và EDM từ SoundCloud.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Search Input Bar */}
      <div className="relative w-full">
        <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Dán link SoundCloud (bài hát / playlist / cá nhân) hoặc nhập tên bài hát, playlist, nghệ sĩ..."
          className="w-full bg-white/[0.04] hover:bg-white/[0.07] focus:bg-white/[0.09] border border-white/10 focus:border-[var(--spotify-glow,#22d3ee)] focus:ring-1 focus:ring-[var(--spotify-glow,#22d3ee)]/40 rounded-2xl pl-11 pr-10 py-3 text-xs sm:text-sm text-white placeholder-slate-400 outline-none transition-colors"
        />
        {searchQuery && (
          <button
            onClick={handleClearSearch}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 rounded-full hover:bg-white/10 active:scale-95 cursor-pointer transition-[transform,color,background-color] duration-150 ease-[var(--ease-out)]"
            title="Xóa tìm kiếm"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Genre / Tag Filter Chips */}
      {!debouncedQuery && !selectedPlaylist && (
        <div className="flex items-center gap-2 overflow-x-auto lg:overflow-x-visible lg:flex-wrap no-scrollbar py-1 shrink-0">
          {GENRE_TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`sc-genre-chip ${isActive ? 'sc-genre-chip--active' : ''} relative px-3.5 py-2 text-xs whitespace-nowrap active:scale-[0.97] transition-[transform,color,background-color,border-color] duration-150 ease-[var(--ease-out)] shrink-0 border flex items-center gap-1.5 cursor-pointer ${
                  isMinimalFlat
                    ? isActive
                      ? 'rounded-[10px] border-transparent bg-transparent text-[var(--accent-strong,#E8A94F)] font-semibold'
                      : 'rounded-[10px] bg-[#1D1720] border-[rgba(244,236,230,0.08)] text-[#B9AC9C] hover:bg-[rgba(244,236,230,0.06)] hover:text-[#F4ECE1] font-bold'
                    : isActive
                    ? 'rounded-full border-transparent bg-transparent text-white font-bold'
                    : 'rounded-full bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border-white/10 hover:border-white/20 font-bold'
                }`}
              >
                {isActive && (
                  <motion.span
                    layoutId="sc-genre-pill"
                    transition={reduced ? { duration: 0.14 } : SPRING_UI}
                    className={`absolute inset-0 pointer-events-none ${
                      isMinimalFlat
                        ? 'rounded-[10px] bg-[#E8A94F]/15 border border-[#E8A94F]/45'
                        : 'rounded-full bg-gradient-to-r from-[#ff5500] to-[#ff3300]'
                    }`}
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* SECTION 1: Top Playlists & Sets from SoundCloud */}
      {!selectedPlaylist && (
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-[var(--spotify-glow,#22d3ee)]/15 text-[var(--spotify-glow,#22d3ee)] border border-[var(--spotify-glow,#22d3ee)]/30">
                <Disc className="w-4 h-4" />
              </div>
              <h2 className="text-base sm:text-lg font-black text-white tracking-tight">
                Top Playlists & Sets
              </h2>
            </div>
            {playlists.length > 0 && (
              <span className="text-xs text-slate-400 font-medium tabular-nums">
                {playlists.length} playlists đề xuất
              </span>
            )}
          </div>

          {loadingPlaylists ? (
            <MediaCardGridSkeleton count={6} />
          ) : playlists.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 xs:gap-3.5 sm:gap-4 relative">
              {playlists.map((pl, idx) => (
                <div key={pl.id} className="h-full">
                  <MediaCard
                    id={String(pl.id)}
                    title={pl.title}
                    subtitle={pl.user?.username || 'SoundCloud Creator'}
                    coverUrl={pl.artwork_url}
                    type="playlist"
                    badgeLabel="SoundCloud"
                    metaText={`${pl.track_count} bài`}
                    onClick={() => handleSelectPlaylist(pl)}
                    onPlay={(e) => handlePlayPlaylist(e, pl)}
                    index={idx}
                    fallbackIcon="playlist"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-white/[0.02] border border-white/5 text-center text-xs text-slate-500">
              Không có playlist đề xuất cho thể loại này.
            </div>
          )}
        </div>
      )}

      {/* Selected Playlist Header Banner */}
      <AnimatePresence mode="wait">
        {selectedPlaylist && (
          <motion.div
            key={selectedPlaylist.id}
            initial={reduced ? { opacity: 0 } : { opacity: 0, transform: 'translate3d(0, -6px, 0) scale(0.985)' }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, transform: 'translate3d(0, -6px, 0) scale(0.985)' }}
            transition={{ duration: reduced ? 0.14 : 0.2, ease: EASE_OUT }}
            className="glass-panel p-4 sm:p-6 rounded-2xl border border-[#ff5500]/30 bg-gradient-to-r from-[#ff5500]/12 via-white/[0.02] to-transparent flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          >
            <div className="flex items-center gap-4 min-w-0 flex-1">
              <button
                onClick={handleBackToExplore}
                className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white active:scale-[0.97] transition-[transform,filter,background-color,border-color,color] duration-150 ease-[var(--ease-out)] shrink-0 cursor-pointer"
                title="Quay lại danh sách tổng"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-slate-900 border border-white/10 overflow-hidden shrink-0">
                {selectedPlaylist.artwork_url ? (
                  <img
                    src={selectedPlaylist.artwork_url}
                    alt={selectedPlaylist.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[#ff5500]/20 text-[#ff7700]">
                    <Disc className="w-7 h-7" />
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-[#ff5500]/20 text-[#ff7700] border border-[#ff5500]/30 shrink-0">
                    Playlist
                  </span>
                  <span className="text-xs text-slate-400 truncate">
                    {selectedPlaylist.user?.username}
                  </span>
                </div>
                <h2 className="text-base sm:text-xl font-black text-white truncate">
                  {selectedPlaylist.title}
                </h2>
                <span className="text-xs text-slate-400 tabular-nums">
                  {tracks.length} bài hát
                </span>
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-2 shrink-0 self-end sm:self-center">
              {tracks.length > 0 && (
                <>
                  <button
                    onClick={handlePlayAll}
                    className="px-4 py-2 rounded-full font-bold text-xs text-white flex items-center gap-2 bg-gradient-to-r from-[#ff7700] to-[#ff3300] hover:brightness-110 active:scale-[0.97] transition-[transform,filter,background-color,border-color,color] duration-150 ease-[var(--ease-out)] cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Phát Playlist</span>
                  </button>
                  <button
                    onClick={() => {
                      setImportInitialPlaylist(selectedPlaylist)
                      setImportInitialTracks(tracks)
                      setIsImportModalOpen(true)
                    }}
                    className="px-4 py-2 rounded-full font-bold text-xs text-black flex items-center gap-1.5 bg-[var(--primary-spotify,#06b6d4)] hover:brightness-110 active:scale-[0.97] transition-[transform,filter,background-color,border-color,color] duration-150 ease-[var(--ease-out)] cursor-pointer"
                    title="Tạo và lưu playlist này vào thư viện cá nhân của bạn"
                  >
                    <BookmarkPlus className="w-3.5 h-3.5" />
                    <span>Lưu vào Thư viện</span>
                  </button>
                </>
              )}
              <button
                onClick={handleBackToExplore}
                className="px-3.5 py-2 rounded-full font-bold text-xs text-slate-300 bg-white/10 hover:bg-white/20 active:scale-[0.97] transition-[transform,filter,background-color,border-color,color] duration-150 ease-[var(--ease-out)] cursor-pointer"
              >
                Đóng Playlist
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SECTION 2: Top Tracks List */}
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[var(--spotify-glow,#22d3ee)]/15 text-[var(--spotify-glow,#22d3ee)] border border-[var(--spotify-glow,#22d3ee)]/30">
              <TrendingUp className="w-4 h-4" />
            </div>
            <h2 className="text-base sm:text-lg font-black text-white tracking-tight">
              {selectedPlaylist
                ? `Danh sách bài hát trong Playlist (${tracks.length})`
                : debouncedQuery
                ? debouncedQuery.includes('soundcloud.com') ||
                  debouncedQuery.includes('http://') ||
                  debouncedQuery.includes('https://')
                  ? 'Kết quả tìm kiếm'
                  : `Kết quả bài hát cho "${debouncedQuery}"`
                : 'Top Bài Hát Thịnh Hành'}
            </h2>
          </div>
          {!selectedPlaylist && tracks.length > 0 && (
            <span className="text-xs text-slate-400 font-medium tabular-nums">
              {tracks.length} bài hát
            </span>
          )}
        </div>

        {loading || loadingPlaylistTracks ? (
          <div className="flex flex-col gap-3">
            <TrackListSkeleton count={8} />
          </div>
        ) : tracks.length > 0 ? (
          <div className="flex flex-col gap-4">
            <TrackList
              tracks={tracks}
              userPlaylists={userPlaylists}
              onAddToPlaylist={handleAddToPlaylist}
              onTrackUpdated={handleTrackUpdated}
              isSearchResult={Boolean(debouncedQuery && !selectedPlaylist)}
            />

            {/* Load More / Pagination Bar */}
            {!selectedPlaylist && (
              <div className="pt-4 mt-2 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
                <span className="font-medium tabular-nums">
                  Đang hiển thị <strong className="text-white font-bold">{tracks.length}</strong> bài hát
                </span>

                {hasMore ? (
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-5 py-2.5 rounded-xl font-bold text-xs text-white bg-white/[0.06] hover:bg-[var(--spotify-glow,#22d3ee)]/15 border border-white/10 hover:border-[var(--spotify-glow,#22d3ee)]/40 flex items-center gap-2 active:scale-[0.97] transition-[transform,filter,background-color,border-color,color] duration-150 ease-[var(--ease-out)] disabled:opacity-50 hover:text-[var(--spotify-glow,#22d3ee)] cursor-pointer"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[var(--spotify-glow,#22d3ee)]" />
                        <span>Đang tải thêm...</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                        <span>Tải thêm 50 bài hát khác</span>
                      </>
                    )}
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-500">Đã hiển thị toàn bộ kết quả</span>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Empty State */
          <div className="glass-panel p-12 rounded-2xl text-center border border-white/10 flex flex-col items-center gap-4 my-6">
            <div className="w-16 h-16 rounded-2xl bg-[#ff5500]/15 border border-[#ff5500]/30 flex items-center justify-center text-[#ff7700]">
              <Cloud className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-1">
                {debouncedQuery ? 'Không tìm thấy bài hát phù hợp' : 'Chưa có bài hát'}
              </h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                {debouncedQuery
                  ? 'Hãy thử tìm kiếm với từ khóa khác hoặc kiểm tra lại tên bài hát/nghệ sĩ.'
                  : 'Hãy chọn một thể loại khác hoặc nhập từ khóa tìm kiếm.'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Import SoundCloud Modal */}
      <ImportSoundCloudModal
        isOpen={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false)
          setImportInitialPlaylist(null)
          setImportInitialTracks([])
        }}
        initialPlaylist={importInitialPlaylist}
        initialTracks={importInitialTracks}
      />
    </div>
  )
}
