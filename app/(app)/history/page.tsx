'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { getValidUserId, getAllValidUserIds } from '@/lib/accessControl'
import { useSession } from 'next-auth/react'
import {
  History,
  Play,
  Trash2,
  Search,
  Sparkles,
  Music,
  Clock,
  RefreshCw,
  AlertCircle,
} from 'lucide-react'
import { TrackListSkeleton } from '@/components/common/SkeletonLoader'
import { useListGlideIndicator } from '@/components/common/useGlideIndicator'

import { fetchListeningHistory } from '@/lib/listeningHistory'

interface HistoryEntry {
  id: string
  played_at: string
  track: Track
}

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
let historyFetchedAt = 0

export default function HistoryPage() {
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const { playTrack, currentTrack, isPlaying } = usePlayer()

  const [historyItems, setHistoryItems] = useState<HistoryEntry[]>(cachedHistory)
  const [loading, setLoading] = useState(cachedHistory.length === 0)
  const [searchQuery, setSearchQuery] = useState('')
  const [clearing, setClearing] = useState(false)

  const {
    containerRef: historyContainerRef,
    indicator: historyIndicator,
    handleItemMouseEnter: handleHistoryMouseEnter,
    handleContainerMouseLeave: handleHistoryMouseLeave,
  } = useListGlideIndicator(60)

  const fetchHistory = useCallback(async (silent = false) => {
    if (!silent && cachedHistory.length === 0) {
      setLoading(true)
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
        historyFetchedAt = Date.now()
        setHistoryItems(validEntries)
      } else {
        setHistoryItems([])
      }
    } catch (err) {
      console.error('Fetch history error:', err)
      setHistoryItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory()

    const channel = supabase
      .channel('history-page-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'listening_history' },
        () => {
          fetchHistory()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchHistory, supabase])

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
        setHistoryItems([])
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
      }
    } catch (err) {
      console.warn('Remove single history item error:', err)
    }
  }

  const handlePlayAllHistory = () => {
    const allTracks = filteredItems.map((item) => item.track)
    if (allTracks.length > 0) {
      playTrack(allTracks[0], allTracks)
    }
  }

  const filteredItems = historyItems.filter((item) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    const titleMatch = item.track.title?.toLowerCase().includes(q)
    const artistMatch = item.track.artist?.toLowerCase().includes(q)
    return titleMatch || artistMatch
  })

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
            <History className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>

          <div className="flex flex-col gap-0.5">
            <h1 className="text-lg sm:text-xl md:text-2xl font-extrabold text-white tracking-tight">Lịch sử nghe nhạc</h1>
            <p className="text-[11px] sm:text-xs text-slate-400">
              Danh sách bài hát bạn đã nghe gần đây
            </p>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-2.5 shrink-0">
          {historyItems.length > 0 && (
            <>
              <button
                onClick={handlePlayAllHistory}
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
        </div>
      </div>

      {/* Search & Filter Bar */}
      {historyItems.length > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm bài hát trong lịch sử..."
              className="w-full glass-input rounded-xl pl-10 pr-4 py-2.5 text-xs text-white outline-none"
            />
          </div>

          <span className="text-xs font-mono text-slate-400">
            Đã nghe {historyItems.length} lượt
          </span>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="flex flex-col gap-4">
          <div className="w-48 h-6 bg-slate-800 rounded-lg animate-pulse" />
          <TrackListSkeleton count={8} />
        </div>
      ) : filteredItems.length > 0 ? (
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
            {filteredItems.map((item, idx) => {
              const track = item.track
              const isCurrentPlaying = currentTrack?.id === track.id && isPlaying

              return (
                <div
                  key={item.id}
                  onClick={() => playTrack(track, filteredItems.map((i) => i.track))}
                  onMouseEnter={handleHistoryMouseEnter}
                  className="history-track-row song-row recent-row flex items-center justify-between p-2.5 sm:p-3 rounded-xl transition-all group gap-2.5 sm:gap-4 cursor-pointer relative z-[1]"
                >
                  <div className="flex items-center gap-2.5 sm:gap-4 flex-1 min-w-0">
                    <span className="text-xs font-mono text-slate-500 w-5 sm:w-6 text-right shrink-0">
                      {idx + 1}
                    </span>

                    {/* Play / Cover Thumbnail */}
                    <div
                      onClick={() => playTrack(track, filteredItems.map((i) => i.track))}
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
                        onClick={() => playTrack(track, filteredItems.map((i) => i.track))}
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
      )}
    </div>
  )
}
