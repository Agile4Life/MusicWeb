'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Cloud,
  Search,
  Play,
  Flame,
  Disc,
  X,
  Loader2,
  ChevronDown,
  ArrowLeft,
} from 'lucide-react'
import { Track, SoundCloudPlaylist } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { TrackList } from '@/components/track/TrackList'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { useSession } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import { getValidUserId } from '@/lib/accessControl'
import { addTrackToPlaylist } from '@/lib/trackPersistence'
import { toast } from '@/components/ui/ToastContext'
import { TrackListSkeleton } from '@/components/common/SkeletonLoader'

const GENRE_TABS = [
  { id: 'all-music', label: 'Tất cả', query: 'vietnam hit' },
  { id: 'indie', label: '🎸 Indie', query: 'indie vietnam', isHot: true },
  { id: 'remix', label: '🔥 Việt Mix / Remix', query: 'vietnamese remix 2025' },
  { id: 'vinahouse', label: '⚡ Vinahouse / EDM', query: 'vinahouse edm' },
  { id: 'lofi', label: '☕ Lofi & Chill', query: 'lofi chill viet nam' },
  { id: 'vpop', label: '🎤 V-Pop Nhạc Trẻ', query: 'vpop hit 2025' },
  { id: 'mashup', label: '🎧 Mashup & Bootleg', query: 'mashup vietnamese' },
  { id: 'phonk', label: '🏎️ Phonk & Bass', query: 'drift phonk bass' },
]

export default function SoundCloudPage() {
  const { playTrack } = usePlayer()
  const { playlists: userPlaylists, refreshPlaylists } = usePlaylists()
  const { userEmail } = useCurrentUser()
  const { data: nextAuthSession } = useSession()
  const supabase = useMemo(() => createClient(), [])

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
  const handlePlayPlaylist = async (e: React.MouseEvent, pl: SoundCloudPlaylist) => {
    e.stopPropagation()
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
    const activeEmail = userEmail || nextAuthSession?.user?.email
    const userId = activeEmail ? getValidUserId({ email: activeEmail }) : null
    if (!userId) {
      toast('Vui lòng đăng nhập để thêm bài hát vào playlist!', 'error')
      return
    }

    const result = await addTrackToPlaylist(supabase, playlistId, track, userId)
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
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col gap-5 sm:gap-7 max-w-7xl mx-auto w-full pb-36 lg:pb-12 select-none">
      {/* 🌟 SoundCloud Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-[#ff5500]/25 p-5 sm:p-8 bg-gradient-to-br from-[#ff5500]/20 via-[#161113] to-[#0a0d14] shadow-[0_16px_40px_rgba(0,0,0,0.6),0_0_30px_rgba(255,85,0,0.15)]">
        {/* Ambient Glow Orbs */}
        <div className="absolute -top-24 -right-24 w-80 h-80 bg-[#ff5500]/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 bg-[#ff7700]/15 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
          <div className="flex items-center gap-4 sm:gap-5">
            {/* SoundCloud Flame Cloud Icon */}
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-[#ff7700] to-[#ff3300] flex items-center justify-center text-white shadow-[0_8px_25px_rgba(255,85,0,0.4)] shrink-0 border border-white/20">
              <Cloud className="w-8 h-8 sm:w-9 sm:h-9 fill-current" />
            </div>

            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                  SoundCloud
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-full bg-[#ff5500]/20 text-[#ff7700] border border-[#ff5500]/40">
                  Full Audio
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-300 max-w-xl">
                Khám phá Top Playlists & Bài hát thịnh hành, bản remix độc quyền, EDM, Vinahouse từ SoundCloud với chất lượng âm thanh nguyên bản.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 🔍 Search Input Bar */}
      <div className="relative w-full">
        <Search className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Dán link SoundCloud (bài hát / playlist / cá nhân) hoặc nhập tên bài hát, playlist, nghệ sĩ..."
          className="w-full bg-white/[0.04] hover:bg-white/[0.07] focus:bg-white/[0.09] border border-white/10 focus:border-[#ff5500]/50 rounded-2xl pl-11 pr-10 py-3 text-xs sm:text-sm text-white placeholder-slate-400 outline-none transition-all shadow-inner"
        />
        {searchQuery && (
          <button
            onClick={handleClearSearch}
            className="absolute right-3.5 top-3 text-slate-400 hover:text-white p-0.5 rounded-full hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 🏷️ Genre / Tag Filter Chips */}
      {!debouncedQuery && !selectedPlaylist && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 shrink-0 -mx-1 px-1">
          {GENRE_TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 shrink-0 border flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-[#ff5500] text-white border-transparent shadow-[0_4px_14px_rgba(255,85,0,0.4)] scale-105'
                    : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border-white/10 hover:border-white/20'
                }`}
              >
                <span>{tab.label}</span>
                {tab.isHot && (
                  <span className="px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider rounded bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-sm animate-pulse leading-none">
                    HOT
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* 📀 SECTION 1: Top Playlists & Sets from SoundCloud */}
      {!selectedPlaylist && (
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-[#ff5500]/15 text-[#ff7700] border border-[#ff5500]/30">
                <Disc className="w-4 h-4" />
              </div>
              <h2 className="text-base sm:text-lg font-black text-white tracking-tight">
                Top Playlists & Sets
              </h2>
            </div>
            {playlists.length > 0 && (
              <span className="text-xs text-slate-400 font-medium">
                {playlists.length} playlists đề xuất
              </span>
            )}
          </div>

          {loadingPlaylists ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="animate-pulse bg-white/5 rounded-2xl p-3 flex flex-col gap-3">
                  <div className="w-full aspect-square rounded-xl bg-white/10" />
                  <div className="h-4 bg-white/10 rounded w-3/4" />
                  <div className="h-3 bg-white/5 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : playlists.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
              {playlists.map((pl) => (
                <div
                  key={pl.id}
                  onClick={() => handleSelectPlaylist(pl)}
                  className="glass-panel group relative rounded-2xl p-3 border border-white/10 hover:border-[#ff5500]/40 transition-all duration-300 hover:shadow-[0_10px_25px_rgba(255,85,0,0.15)] flex flex-col gap-2.5 cursor-pointer bg-white/[0.02] hover:bg-white/[0.05]"
                >
                  {/* Artwork Box */}
                  <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-slate-900 border border-white/10">
                    {pl.artwork_url ? (
                      <img
                        src={pl.artwork_url}
                        alt={pl.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#ff5500]/20 to-slate-900 text-slate-500">
                        <Disc className="w-10 h-10 text-[#ff7700]/50" />
                      </div>
                    )}

                    {/* Track count badge */}
                    <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-black bg-black/70 backdrop-blur-md text-white border border-white/20">
                      {pl.track_count} bài
                    </div>

                    {/* Quick Play Button on Hover */}
                    <button
                      onClick={(e) => handlePlayPlaylist(e, pl)}
                      className="absolute bottom-2.5 right-2.5 w-10 h-10 rounded-full bg-gradient-to-r from-[#ff7700] to-[#ff3300] text-white flex items-center justify-center shadow-lg transition-all duration-300 opacity-0 group-hover:opacity-100 hover:scale-110 active:scale-95 border border-white/20"
                      title="Phát playlist này"
                    >
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    </button>
                  </div>

                  {/* Playlist Metadata */}
                  <div className="flex flex-col min-w-0">
                    <h3 className="text-xs sm:text-sm font-bold text-white group-hover:text-[#ff7700] truncate transition-colors">
                      {pl.title}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] text-slate-400 truncate">
                        {pl.user?.username || 'SoundCloud Creator'}
                      </span>
                    </div>
                  </div>
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

      {/* 📌 Selected Playlist Header Banner (if viewing a specific playlist) */}
      {selectedPlaylist && (
        <div className="glass-panel p-4 sm:p-6 rounded-3xl border border-[#ff5500]/30 bg-gradient-to-r from-[#ff5500]/15 via-white/[0.02] to-transparent flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBackToExplore}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all hover:scale-105 active:scale-95"
              title="Quay lại danh sách tổng"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            {/* Thumbnail */}
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-slate-900 border border-white/10 overflow-hidden shrink-0">
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

            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.2 text-[9px] font-black uppercase rounded bg-[#ff5500]/20 text-[#ff7700] border border-[#ff5500]/40">
                  Playlist
                </span>
                <span className="text-xs text-slate-400">
                  {selectedPlaylist.user?.username}
                </span>
              </div>
              <h2 className="text-base sm:text-xl font-black text-white">
                {selectedPlaylist.title}
              </h2>
              <span className="text-xs text-slate-400">
                {tracks.length} bài hát Full Audio
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
            {tracks.length > 0 && (
              <button
                onClick={handlePlayAll}
                className="px-4 py-2 rounded-full font-bold text-xs text-white flex items-center gap-2 bg-gradient-to-r from-[#ff7700] to-[#ff3300] shadow-md hover:scale-105 active:scale-95 transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Phát Playlist</span>
              </button>
            )}
            <button
              onClick={handleBackToExplore}
              className="px-3.5 py-2 rounded-full font-bold text-xs text-slate-300 bg-white/10 hover:bg-white/20 transition-all"
            >
              Đóng Playlist
            </button>
          </div>
        </div>
      )}

      {/* 🎵 SECTION 2: Top Tracks List */}
      <div className="flex flex-col gap-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[#ff5500]/15 text-[#ff7700] border border-[#ff5500]/30">
              <Flame className="w-4 h-4" />
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
            <span className="text-xs text-slate-400 font-medium">
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
            />

            {/* 📥 Load More / Pagination Bar (Only when not in a specific playlist) */}
            {!selectedPlaylist && (
              <div className="pt-4 mt-2 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
                <span className="font-medium">
                  Đang hiển thị <strong className="text-white font-bold">{tracks.length}</strong> bài hát Full Audio
                </span>

                {hasMore ? (
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-5 py-2.5 rounded-xl font-bold text-xs text-white bg-white/[0.06] hover:bg-[#ff5500]/20 border border-white/10 hover:border-[#ff5500]/40 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 hover:text-[#ff7700]"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-[#ff7700]" />
                        <span>Đang tải thêm...</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 text-[#ff7700]" />
                        <span>Tải thêm 50 bài hát khác</span>
                      </>
                    )}
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-500 italic">Đã hiển thị toàn bộ kết quả</span>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Empty State */
          <div className="glass-panel p-12 rounded-3xl text-center border border-white/10 flex flex-col items-center gap-4 my-6">
            <div className="w-16 h-16 rounded-2xl bg-[#ff5500]/15 border border-[#ff5500]/30 flex items-center justify-center text-[#ff7700] shadow-[0_8px_20px_rgba(255,85,0,0.2)]">
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
    </div>
  )
}
