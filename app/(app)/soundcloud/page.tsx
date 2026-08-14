'use client'

import React, { useState, useEffect, useRef } from 'react'
import {
  Cloud,
  Search,
  Play,
  Pause,
  Sparkles,
  Flame,
  Radio,
  Music,
  Clock,
  Disc,
  X,
  ExternalLink,
  Loader2,
  ChevronDown,
} from 'lucide-react'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { TrackListSkeleton } from '@/components/common/SkeletonLoader'
import { formatDuration } from '@/lib/utils'

const GENRE_TABS = [
  { id: 'all-music', label: 'Tất cả', query: 'vietnam hit' },
  { id: 'remix', label: '🔥 Việt Mix / Remix', query: 'vietnamese remix 2025' },
  { id: 'vinahouse', label: '⚡ Vinahouse / EDM', query: 'vinahouse edm' },
  { id: 'lofi', label: '☕ Lofi & Chill', query: 'lofi chill viet nam' },
  { id: 'vpop', label: '🎤 V-Pop Nhạc Trẻ', query: 'vpop hit 2025' },
  { id: 'mashup', label: '🎧 Mashup & Bootleg', query: 'mashup vietnamese' },
  { id: 'phonk', label: '🏎️ Phonk & Bass', query: 'drift phonk bass' },
]

export default function SoundCloudPage() {
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer()

  const [activeTab, setActiveTab] = useState<string>('all-music')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [debouncedQuery, setDebouncedQuery] = useState<string>('')
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [loadingMore, setLoadingMore] = useState<boolean>(false)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [offset, setOffset] = useState<number>(0)
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Handle Search Input Debounce
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setSearchQuery(val)

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(val.trim())
      setOffset(0)
    }, 450)
  }

  const handleClearSearch = () => {
    setSearchQuery('')
    setDebouncedQuery('')
    setOffset(0)
  }

  // Fetch Tracks on tab or search query change
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setOffset(0)

    const fetchTracks = async () => {
      try {
        let endpoint = ''
        if (debouncedQuery) {
          endpoint = `/api/soundcloud/search?q=${encodeURIComponent(debouncedQuery)}&limit=50&offset=0`
        } else {
          const currentTabObj = GENRE_TABS.find((t) => t.id === activeTab) || GENRE_TABS[0]
          endpoint = `/api/soundcloud/search?q=${encodeURIComponent(currentTabObj.query)}&limit=50&offset=0`
        }

        const res = await fetch(endpoint)
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) {
            const fetched = data.tracks || []
            setTracks(fetched)
            setHasMore(fetched.length >= 20)
          }
        }
      } catch (err) {
        console.error('[SoundCloudPage] Fetch error:', err)
        if (!cancelled) {
          setTracks([])
          setHasMore(false)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchTracks()

    return () => {
      cancelled = true
    }
  }, [activeTab, debouncedQuery])

  // Load More Handler
  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return
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

  const handleTrackClick = (track: Track) => {
    if (currentTrack?.id === track.id) {
      togglePlay()
    } else {
      playTrack(track, tracks)
    }
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
                Khám phá và nghe hàng triệu bài hát, bản remix độc quyền, EDM, podcast từ SoundCloud với chất lượng âm thanh nguyên bản.
              </p>
            </div>
          </div>

          {/* Top Actions */}
          {tracks.length > 0 && (
            <button
              onClick={handlePlayAll}
              className="px-5 py-2.5 rounded-full font-bold text-xs sm:text-sm text-white flex items-center gap-2 transition-all hover:scale-105 active:scale-95 shadow-lg shrink-0 border border-white/20 bg-gradient-to-r from-[#ff7700] to-[#ff3300] shadow-[0_4px_18px_rgba(255,85,0,0.35)]"
            >
              <Play className="w-4 h-4 fill-current text-white" />
              <span>Phát tất cả ({tracks.length} bài)</span>
            </button>
          )}
        </div>
      </div>

      {/* 🔍 Search Input Bar */}
      <div className="relative w-full">
        <Search className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
        <input
          type="text"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Dán link SoundCloud (bài hát / playlist) hoặc nhập tên bài hát, nghệ sĩ..."
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
      {!debouncedQuery && (
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 shrink-0 -mx-1 px-1">
          {GENRE_TABS.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 shrink-0 border ${
                  isActive
                    ? 'bg-[#ff5500] text-white border-transparent shadow-[0_4px_14px_rgba(255,85,0,0.4)] scale-105'
                    : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border-white/10 hover:border-white/20'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      )}

      {/* 🎵 Tracks Grid / List */}
      {loading ? (
        <div className="flex flex-col gap-3">
          <TrackListSkeleton count={8} />
        </div>
      ) : tracks.length > 0 ? (
        <div className="glass-panel rounded-3xl p-3 sm:p-6 border border-white/10 overflow-hidden">
          <div className="flex flex-col divide-y divide-white/5">
            {tracks.map((track, idx) => {
              const isCurrent = currentTrack?.id === track.id
              const isCurrentlyPlaying = isCurrent && isPlaying

              return (
                <div
                  key={track.id}
                  onClick={() => handleTrackClick(track)}
                  className={`flex items-center justify-between p-2.5 sm:p-3 rounded-2xl transition-all group gap-3 cursor-pointer ${
                    isCurrent ? 'bg-[#ff5500]/10 border border-[#ff5500]/25' : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                    <span className="text-xs font-mono text-slate-500 w-5 text-right shrink-0">
                      {idx + 1}
                    </span>

                    {/* Thumbnail & Play overlay */}
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-slate-800 border border-white/10 overflow-hidden shrink-0 relative flex items-center justify-center">
                      {track.cover_url ? (
                        <img
                          src={track.cover_url}
                          alt={track.title}
                          className="w-full h-full object-cover rounded-xl"
                        />
                      ) : (
                        <Music className="w-5 h-5 text-slate-500" />
                      )}

                      <div
                        className={`absolute inset-0 bg-black/60 flex items-center justify-center transition-opacity rounded-xl ${
                          isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        {isCurrentlyPlaying ? (
                          <Pause className="w-5 h-5 text-[#ff7700] fill-current" />
                        ) : (
                          <Play className="w-5 h-5 text-white fill-current ml-0.5" />
                        )}
                      </div>
                    </div>

                    {/* Track Info & SoundCloud Tag */}
                    <div className="flex flex-col truncate flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p
                          className={`text-xs sm:text-sm font-bold truncate ${
                            isCurrent ? 'text-[#ff7700]' : 'text-white group-hover:text-[#ff7700]'
                          }`}
                        >
                          {track.title}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 mt-0.5">
                        {/* Distinct SoundCloud Orange Pill Badge */}
                        <span className="px-1.5 py-0.2 text-[9px] font-black uppercase rounded bg-[#ff5500]/20 text-[#ff7700] border border-[#ff5500]/40 shrink-0">
                          SoundCloud
                        </span>
                        <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                          {track.artist || 'Nghệ sĩ SoundCloud'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Metadata / Duration / Open Link */}
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-mono text-slate-400">
                      {formatDuration(track.duration)}
                    </span>

                    {track.soundcloud_permalink_url && (
                      <a
                        href={track.soundcloud_permalink_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 text-slate-500 hover:text-[#ff7700] rounded-lg hover:bg-white/10 transition-colors opacity-0 sm:group-hover:opacity-100"
                        title="Mở trên SoundCloud"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 📥 Load More / Pagination Bar */}
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
  )
}
