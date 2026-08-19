'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { useSession } from 'next-auth/react'
import {
  History,
  Play,
  Trash2,
  Search,
  Sparkles,
  Music,
  Clock,
  Flame,
  Trophy,
  Medal,
  Calendar,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'
import { TrackListSkeleton } from '@/components/common/SkeletonLoader'
import { useListGlideIndicator } from '@/components/common/useGlideIndicator'
import { TopHistoryTrackItem } from '@/lib/listeningHistory'

interface HistoryEntry {
  id: string
  played_at: string
  track: Track
}

type HistoryTab = 'recent' | 'top'
type TopTimeframe = 'all' | '30days' | '7days'

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)

    if (diffSec < 30) return 'Vừa xong'
    if (diffMin < 60) return `${diffMin} phút trước`
    if (diffHour < 24) return `${diffHour} giờ trước`
    if (diffDay === 1) return `Hôm qua lúc ${date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
    if (diffDay < 7) return `${diffDay} ngày trước`

    return date.toLocaleDateString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateString
  }
}

let cachedHistory: HistoryEntry[] = []
let cachedTopMap: Record<TopTimeframe, TopHistoryTrackItem[]> = {
  all: [],
  '30days': [],
  '7days': [],
}
let cachedTotalPlays: Record<TopTimeframe, number> = {
  all: 0,
  '30days': 0,
  '7days': 0,
}

export default function HistoryPage() {
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const { playTrack, currentTrack, isPlaying } = usePlayer()

  const [activeTab, setActiveTab] = useState<HistoryTab>('recent')
  const [timeframe, setTimeframe] = useState<TopTimeframe>('all')

  // Recent History State
  const [historyItems, setHistoryItems] = useState<HistoryEntry[]>(cachedHistory)
  const [recentLoading, setRecentLoading] = useState(cachedHistory.length === 0)
  const [clearing, setClearing] = useState(false)

  // Top Tracks State
  const [topItems, setTopItems] = useState<TopHistoryTrackItem[]>(cachedTopMap[timeframe])
  const [totalPlays, setTotalPlays] = useState<number>(cachedTotalPlays[timeframe])
  const [topLoading, setTopLoading] = useState(cachedTopMap[timeframe].length === 0)

  const [searchQuery, setSearchQuery] = useState('')

  const {
    containerRef: historyContainerRef,
    indicator: historyIndicator,
    handleItemMouseEnter: handleHistoryMouseEnter,
    handleContainerMouseLeave: handleHistoryMouseLeave,
  } = useListGlideIndicator(60)

  // 1. Fetch Recent History
  const fetchRecentHistory = useCallback(async (silent = false) => {
    if (!silent && cachedHistory.length === 0) {
      setRecentLoading(true)
    }
    try {
      const res = await fetch('/api/history/list?limit=100')
      if (res.ok) {
        const { items } = await res.json()
        const validEntries: HistoryEntry[] = (items ?? []).flatMap((item: any) => {
          const tr = item.track
          if (!tr) return []
          let source: Track['source'] = tr.source || 'local'
          let youtube_id = tr.youtube_id
          const fp = tr.file_path || ''

          if (fp.includes('youtube.com') || fp.includes('youtu.be') || tr.id?.startsWith?.('yt-')) {
            source = 'youtube'
            if (!youtube_id) {
              const match = fp.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/|^yt-)([a-zA-Z0-9_-]{11})/)
              if (match) youtube_id = match[1]
              else if (tr.id?.startsWith?.('yt-')) youtube_id = tr.id.replace('yt-', '')
            }
          } else if (fp.includes('spotify.com') || tr.id?.startsWith?.('spotify-')) {
            source = 'spotify'
          } else if (fp.includes('itunes.apple.com') || tr.id?.startsWith?.('itunes-')) {
            source = 'itunes'
          } else if (fp.includes('audius.co') || tr.id?.startsWith?.('audius-')) {
            source = 'audius'
          }

          return [
            {
              id: item.id,
              played_at: item.played_at,
              track: {
                ...tr,
                source,
                youtube_id,
                artist: tr.artist || null,
                album: tr.album || null,
              },
            },
          ]
        })

        cachedHistory = validEntries
        setHistoryItems(validEntries)
      } else {
        setHistoryItems([])
      }
    } catch (err) {
      console.error('Fetch history error:', err)
      setHistoryItems([])
    } finally {
      setRecentLoading(false)
    }
  }, [])

  // 2. Fetch Top Tracks
  const fetchTopTracks = useCallback(async (selectedTimeframe: TopTimeframe, silent = false) => {
    if (!silent && cachedTopMap[selectedTimeframe].length === 0) {
      setTopLoading(true)
    }
    try {
      const res = await fetch(`/api/history/top?timeframe=${selectedTimeframe}&limit=50`)
      if (res.ok) {
        const { items, totalPlays: total } = await res.json()
        const validItems: TopHistoryTrackItem[] = (items ?? []).map((item: any) => ({
          track: {
            ...item.track,
            artist: item.track.artist || null,
            album: item.track.album || null,
          },
          playCount: item.playCount || 1,
          lastPlayedAt: item.lastPlayedAt || item.played_at,
        }))

        cachedTopMap[selectedTimeframe] = validItems
        cachedTotalPlays[selectedTimeframe] = total || 0
        setTopItems(validItems)
        setTotalPlays(total || 0)
      } else {
        setTopItems([])
      }
    } catch (err) {
      console.error('Fetch top tracks error:', err)
      setTopItems([])
    } finally {
      setTopLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRecentHistory()
    fetchTopTracks(timeframe, true)

    const channel = supabase
      .channel('history-page-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'listening_history' },
        () => {
          fetchRecentHistory(true)
          fetchTopTracks(timeframe, true)
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchRecentHistory, fetchTopTracks, timeframe, supabase])

  const handleTimeframeChange = (tf: TopTimeframe) => {
    setTimeframe(tf)
    if (cachedTopMap[tf].length > 0) {
      setTopItems(cachedTopMap[tf])
      setTotalPlays(cachedTotalPlays[tf])
    }
    fetchTopTracks(tf)
  }

  const handleClearAllHistory = async () => {
    if (historyItems.length === 0) return
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử nghe nhạc không?')) return

    setClearing(true)
    try {
      const res = await fetch('/api/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true }),
      })
      if (res.ok) {
        cachedHistory = []
        cachedTopMap = { all: [], '30days': [], '7days': [] }
        setHistoryItems([])
        setTopItems([])
        setTotalPlays(0)
      } else {
        alert('Lỗi xóa lịch sử nghe!')
      }
    } catch (err) {
      alert('Lỗi xóa lịch sử nghe!')
    } finally {
      setClearing(false)
    }
  }

  const handleRemoveSingleItem = async (e: React.MouseEvent, historyId: string) => {
    e.stopPropagation()
    try {
      const res = await fetch('/api/history/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ historyId }),
      })
      if (res.ok) {
        setHistoryItems((prev) => prev.filter((item) => item.id !== historyId))
        fetchTopTracks(timeframe, true)
      }
    } catch (err) {
      console.warn('Remove single history item error:', err)
    }
  }

  const handlePlayAllRecent = () => {
    const allTracks = filteredRecentItems.map((item) => item.track)
    if (allTracks.length > 0) {
      playTrack(allTracks[0], allTracks)
    }
  }

  const handlePlayAllTop = () => {
    const allTracks = filteredTopItems.map((item) => item.track)
    if (allTracks.length > 0) {
      playTrack(allTracks[0], allTracks)
    }
  }

  // Filtered lists
  const filteredRecentItems = historyItems.filter((item) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    const titleMatch = item.track.title?.toLowerCase().includes(q)
    const artistMatch = item.track.artist?.toLowerCase().includes(q)
    return titleMatch || artistMatch
  })

  const filteredTopItems = topItems.filter((item) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    const titleMatch = item.track.title?.toLowerCase().includes(q)
    const artistMatch = item.track.artist?.toLowerCase().includes(q)
    return titleMatch || artistMatch
  })

  const currentLoading = activeTab === 'recent' ? recentLoading : topLoading

  return (
    <div className="p-2.5 sm:p-4 md:p-6 lg:p-7 flex flex-col gap-3 sm:gap-4 md:gap-5 max-w-7xl mx-auto w-full pb-36 lg:pb-12 select-none">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] p-3 sm:p-4 md:p-5 bg-[#0d1017] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-2.5 sm:gap-3.5">
          <div
            style={{
              backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
              borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
              color: 'var(--spotify-glow, #22d3ee)',
            }}
            className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl border flex items-center justify-center shrink-0 shadow-md"
          >
            {activeTab === 'recent' ? (
              <History className="w-5 h-5 sm:w-6 sm:h-6" />
            ) : (
              <Flame className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400 fill-orange-400/20" />
            )}
          </div>

          <div className="flex flex-col gap-0.5">
            <h1 className="text-lg sm:text-xl md:text-2xl font-extrabold text-white tracking-tight">
              {activeTab === 'recent' ? 'Lịch sử nghe nhạc' : 'Bài hát nghe nhiều nhất'}
            </h1>
            <p className="text-[11px] sm:text-xs text-slate-400">
              {activeTab === 'recent'
                ? 'Danh sách bài hát bạn đã nghe gần đây theo thứ tự thời gian'
                : 'Bảng xếp hạng các bài hát bạn yêu thích và nghe lặp lại nhiều nhất'}
            </p>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          {activeTab === 'recent' && historyItems.length > 0 && (
            <>
              <button
                onClick={handlePlayAllRecent}
                style={{
                  background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                  boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                }}
                className="text-black font-bold px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full flex items-center gap-1.5 text-xs transition-all hover:brightness-110 active:scale-95 border border-white/20"
              >
                <Play className="w-3.5 h-3.5 fill-current text-black" />
                <span>Phát tất cả</span>
              </button>

              <button
                onClick={handleClearAllHistory}
                disabled={clearing}
                className="bg-white/5 hover:bg-red-500/10 text-slate-300 hover:text-red-400 border border-white/10 font-semibold px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-full flex items-center gap-1.5 text-xs transition-colors disabled:opacity-50"
                title="Xóa tất cả lịch sử"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Xóa lịch sử</span>
              </button>
            </>
          )}

          {activeTab === 'top' && topItems.length > 0 && (
            <button
              onClick={handlePlayAllTop}
              style={{
                background: 'linear-gradient(135deg, #f59e0b, #ea580c)',
                boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)',
              }}
              className="text-black font-bold px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-full flex items-center gap-1.5 text-xs transition-all hover:brightness-110 active:scale-95 border border-white/20"
            >
              <Play className="w-3.5 h-3.5 fill-current text-black" />
              <span>Phát tất cả Top</span>
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 bg-white/[0.04] p-1 rounded-xl border border-white/[0.08]">
          <button
            onClick={() => setActiveTab('recent')}
            style={
              activeTab === 'recent'
                ? {
                    backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.2))',
                    borderColor: 'var(--spotify-glow, #22d3ee)',
                    color: 'var(--spotify-glow, #22d3ee)',
                    boxShadow: '0 0 12px var(--theme-glow-shadow)',
                  }
                : undefined
            }
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all ${
              activeTab === 'recent'
                ? 'border shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Gần đây</span>
            {historyItems.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 text-slate-300 font-mono">
                {historyItems.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('top')}
            style={
              activeTab === 'top'
                ? {
                    backgroundColor: 'rgba(245, 158, 11, 0.18)',
                    borderColor: '#f59e0b',
                    color: '#fbbf24',
                    boxShadow: '0 0 12px rgba(245, 158, 11, 0.3)',
                  }
                : undefined
            }
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all ${
              activeTab === 'top'
                ? 'border shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-orange-400" />
            <span>Nghe nhiều nhất</span>
            {topItems.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-orange-500/20 text-orange-300 font-mono">
                {topItems.length}
              </span>
            )}
          </button>
        </div>

        {/* Timeframe Selector (Only for Top Tab) */}
        {activeTab === 'top' && (
          <div className="flex items-center gap-1.5 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06]">
            {(
              [
                { id: 'all', label: 'Tất cả' },
                { id: '30days', label: '30 ngày qua' },
                { id: '7days', label: '7 ngày qua' },
              ] as const
            ).map((tf) => (
              <button
                key={tf.id}
                onClick={() => handleTimeframeChange(tf.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all ${
                  timeframe === tf.id
                    ? 'bg-white/15 text-white shadow-sm border border-white/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Search & Filter Bar */}
      {((activeTab === 'recent' && historyItems.length > 0) ||
        (activeTab === 'top' && topItems.length > 0)) && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeTab === 'recent'
                  ? 'Tìm kiếm bài hát trong lịch sử...'
                  : 'Tìm kiếm bài hát trong Top...'
              }
              className="w-full glass-input rounded-xl pl-10 pr-4 py-2.5 text-xs text-white outline-none"
            />
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
            {activeTab === 'recent' ? (
              <span>Đã nghe {historyItems.length} lượt</span>
            ) : (
              <span>
                Tổng cộng {totalPlays} lượt phát • {topItems.length} bài hát
              </span>
            )}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      {currentLoading ? (
        <div className="flex flex-col gap-4">
          <div className="w-48 h-6 bg-slate-800 rounded-lg animate-pulse" />
          <TrackListSkeleton count={8} />
        </div>
      ) : activeTab === 'recent' ? (
        /* TAB 1: RECENT HISTORY */
        filteredRecentItems.length > 0 ? (
          <div className="glass-panel rounded-3xl p-2.5 sm:p-4 md:p-6 border border-white/10 overflow-hidden">
            <div
              ref={historyContainerRef}
              onMouseLeave={handleHistoryMouseLeave}
              className="flex flex-col gap-1 relative"
            >
              <div
                className="track-glide-indicator"
                style={{
                  transform: `translateY(${historyIndicator.top}px) scaleY(${historyIndicator.scaleY})`,
                  height: `${historyIndicator.height}px`,
                  opacity: historyIndicator.opacity,
                }}
              />
              {filteredRecentItems.map((item, idx) => {
                const track = item.track
                const isCurrentPlaying = currentTrack?.id === track.id && isPlaying

                return (
                  <div
                    key={item.id}
                    onClick={() => playTrack(track, filteredRecentItems.map((i) => i.track))}
                    onMouseEnter={handleHistoryMouseEnter}
                    className="history-track-row song-row recent-row flex items-center justify-between p-2.5 sm:p-3 rounded-xl transition-all group gap-2.5 sm:gap-4 cursor-pointer relative z-[1]"
                  >
                    <div className="flex items-center gap-2.5 sm:gap-4 flex-1 min-w-0">
                      <span className="text-xs font-mono text-slate-500 w-5 sm:w-6 text-right shrink-0">
                        {idx + 1}
                      </span>

                      {/* Play / Cover Thumbnail */}
                      <div
                        onClick={() => playTrack(track, filteredRecentItems.map((i) => i.track))}
                        className="row-thumb w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center shrink-0 cursor-pointer relative overflow-hidden group/thumb"
                      >
                        {track.cover_url ? (
                          <img
                            src={track.cover_url}
                            alt={track.title}
                            className="w-full h-full object-cover rounded-xl"
                          />
                        ) : (
                          <Music className="w-5 h-5 text-slate-400" />
                        )}

                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity rounded-xl">
                          <Play className="w-5 h-5 text-white fill-current" />
                        </div>
                      </div>

                      {/* Track Info */}
                      <div className="flex flex-col truncate flex-1 min-w-0">
                        <p
                          onClick={() => playTrack(track, filteredRecentItems.map((i) => i.track))}
                          style={isCurrentPlaying ? { color: 'var(--spotify-glow, #22d3ee)' } : undefined}
                          className={`text-xs sm:text-sm font-bold truncate cursor-pointer hover:underline ${
                            isCurrentPlaying ? '' : 'text-white'
                          }`}
                        >
                          {track.title}
                        </p>
                        <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                          {track.artist || 'Nghệ sĩ chưa xác định'}
                        </p>
                      </div>
                    </div>

                    {/* Time Ago Badge & Delete Action */}
                    <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                      <div className="hidden xs:flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-400 font-mono bg-white/5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full border border-white/5">
                        <Clock style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-3 h-3" />
                        <span>{formatRelativeTime(item.played_at)}</span>
                      </div>

                      <button
                        onClick={(e) => handleRemoveSingleItem(e, item.id)}
                        className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-1.5 sm:p-2 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded-xl transition-all"
                        title="Xóa mục này khỏi lịch sử"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="glass-panel p-12 rounded-3xl text-center border border-white/10 flex flex-col items-center gap-4 my-8">
            <div
              style={{
                backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                color: 'var(--spotify-glow, #22d3ee)',
                boxShadow: '0 10px 25px var(--theme-glow-shadow, rgba(6,182,212,0.15))',
              }}
              className="w-16 h-16 rounded-2xl flex items-center justify-center border"
            >
              <History className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Chưa Có Lịch Sử Nghe Nhạc</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Hãy chọn bài hát bạn thích và thưởng thức âm nhạc. Lịch sử các bài hát đã nghe sẽ xuất hiện tại đây.
              </p>
            </div>
          </div>
        )
      ) : (
        /* TAB 2: TOP MOST PLAYED TRACKS */
        filteredTopItems.length > 0 ? (
          <div className="glass-panel rounded-3xl p-2.5 sm:p-4 md:p-6 border border-white/10 overflow-hidden">
            <div
              ref={historyContainerRef}
              onMouseLeave={handleHistoryMouseLeave}
              className="flex flex-col gap-1 relative"
            >
              <div
                className="track-glide-indicator"
                style={{
                  transform: `translateY(${historyIndicator.top}px) scaleY(${historyIndicator.scaleY})`,
                  height: `${historyIndicator.height}px`,
                  opacity: historyIndicator.opacity,
                }}
              />
              {filteredTopItems.map((item, idx) => {
                const track = item.track
                const isCurrentPlaying = currentTrack?.id === track.id && isPlaying
                const rank = idx + 1

                return (
                  <div
                    key={`${track.id}-${idx}`}
                    onClick={() => playTrack(track, filteredTopItems.map((i) => i.track))}
                    onMouseEnter={handleHistoryMouseEnter}
                    className="history-track-row song-row top-track-row flex items-center justify-between p-2.5 sm:p-3 rounded-xl transition-all group gap-2.5 sm:gap-4 cursor-pointer relative z-[1]"
                  >
                    <div className="flex items-center gap-2.5 sm:gap-4 flex-1 min-w-0">
                      {/* Rank Indicator */}
                      <div className="w-7 sm:w-8 flex items-center justify-center shrink-0">
                        {rank === 1 ? (
                          <span
                            className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center justify-center text-xs font-black shadow-[0_0_12px_rgba(245,158,11,0.35)]"
                            title="Top 1 Quán Quân"
                          >
                            <Trophy className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                          </span>
                        ) : rank === 2 ? (
                          <span
                            className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-slate-300/20 text-slate-200 border border-slate-300/40 flex items-center justify-center text-xs font-black shadow-[0_0_10px_rgba(203,213,225,0.25)]"
                            title="Top 2 Á Quân"
                          >
                            <Medal className="w-3.5 h-3.5 text-slate-300" />
                          </span>
                        ) : rank === 3 ? (
                          <span
                            className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-amber-700/20 text-amber-400 border border-amber-700/40 flex items-center justify-center text-xs font-black shadow-[0_0_10px_rgba(180,83,9,0.25)]"
                            title="Top 3 Quý Quân"
                          >
                            <Medal className="w-3.5 h-3.5 text-amber-500" />
                          </span>
                        ) : (
                          <span className="text-xs font-mono font-bold text-slate-500">
                            #{rank}
                          </span>
                        )}
                      </div>

                      {/* Play / Cover Thumbnail */}
                      <div
                        onClick={() => playTrack(track, filteredTopItems.map((i) => i.track))}
                        className="row-thumb w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center shrink-0 cursor-pointer relative overflow-hidden group/thumb"
                      >
                        {track.cover_url ? (
                          <img
                            src={track.cover_url}
                            alt={track.title}
                            className="w-full h-full object-cover rounded-xl"
                          />
                        ) : (
                          <Music className="w-5 h-5 text-slate-400" />
                        )}

                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity rounded-xl">
                          <Play className="w-5 h-5 text-white fill-current" />
                        </div>
                      </div>

                      {/* Track Info */}
                      <div className="flex flex-col truncate flex-1 min-w-0">
                        <p
                          onClick={() => playTrack(track, filteredTopItems.map((i) => i.track))}
                          style={isCurrentPlaying ? { color: 'var(--spotify-glow, #22d3ee)' } : undefined}
                          className={`text-xs sm:text-sm font-bold truncate cursor-pointer hover:underline ${
                            isCurrentPlaying ? '' : 'text-white'
                          }`}
                        >
                          {track.title}
                        </p>
                        <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                          {track.artist || 'Nghệ sĩ chưa xác định'}
                        </p>
                      </div>
                    </div>

                    {/* Play Count Pill & Last Played Badge */}
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      {/* Play Count Badge */}
                      <div
                        style={{
                          backgroundColor:
                            rank === 1
                              ? 'rgba(245, 158, 11, 0.18)'
                              : 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                          borderColor:
                            rank === 1
                              ? 'rgba(245, 158, 11, 0.4)'
                              : 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                          color: rank === 1 ? '#fbbf24' : 'var(--spotify-glow, #22d3ee)',
                        }}
                        className="flex items-center gap-1.5 text-[11px] sm:text-xs font-extrabold px-2.5 sm:px-3 py-1 rounded-full border shadow-sm"
                        title={`Đã nghe ${item.playCount} lần`}
                      >
                        <Flame
                          className={`w-3.5 h-3.5 ${
                            rank === 1 ? 'text-amber-400 fill-amber-400' : 'text-orange-400'
                          }`}
                        />
                        <span>{item.playCount} lượt nghe</span>
                      </div>

                      {/* Last listened relative time */}
                      {item.lastPlayedAt && (
                        <div className="hidden md:flex items-center gap-1.5 text-[10px] text-slate-400 font-mono bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{formatRelativeTime(item.lastPlayedAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="glass-panel p-12 rounded-3xl text-center border border-white/10 flex flex-col items-center gap-4 my-8">
            <div
              style={{
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                borderColor: 'rgba(245, 158, 11, 0.3)',
                color: '#fbbf24',
                boxShadow: '0 10px 25px rgba(245, 158, 11, 0.15)',
              }}
              className="w-16 h-16 rounded-2xl flex items-center justify-center border"
            >
              <Flame className="w-8 h-8 text-orange-400" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white mb-1">Chưa Có Dữ Liệu Nghe Nhiều Nhất</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Hãy nghe thêm các bài hát yêu thích của bạn để xây dựng bảng xếp hạng Top bài hát nghe nhiều nhất.
              </p>
            </div>
          </div>
        )
      )}
    </div>
  )
}
