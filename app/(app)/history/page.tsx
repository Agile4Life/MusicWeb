'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { getValidUserId } from '@/lib/accessControl'
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

export default function HistoryPage() {
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const { playTrack, currentTrack, isPlaying } = usePlayer()

  const [historyItems, setHistoryItems] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [clearing, setClearing] = useState(false)

  const fetchHistory = useCallback(async () => {
    setLoading(true)
    try {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      const activeUser = currentUser || (nextAuthSession?.user ? {
        id: nextAuthSession.user.email,
        email: nextAuthSession.user.email,
      } : null)

      const userId = activeUser ? getValidUserId(activeUser) : null

      if (!userId) {
        setHistoryItems([])
        setLoading(false)
        return
      }

      const { data, error } = await supabase
        .from('listening_history')
        .select('id, played_at, tracks:track_id(*)')
        .eq('user_id', userId)
        .order('played_at', { ascending: false })
        .limit(100)

      if (!error && data) {
        const validEntries: HistoryEntry[] = data
          .filter((item: any) => item.tracks && typeof item.tracks === 'object')
          .map((item: any) => {
            const tr = item.tracks
            let source = tr.source || 'local'
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

            return {
              id: item.id,
              played_at: item.played_at,
              track: {
                ...tr,
                source,
                youtube_id,
                artist: tr.artist || null,
                album: tr.album || null,
              },
            }
          })

        setHistoryItems(validEntries)
      }
    } catch (err) {
      console.error('Fetch history error:', err)
    } finally {
      setLoading(false)
    }
  }, [nextAuthSession, supabase])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  const handleClearAllHistory = async () => {
    if (historyItems.length === 0) return
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử nghe nhạc không?')) return

    setClearing(true)
    try {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      const activeUser = currentUser || (nextAuthSession?.user ? {
        id: nextAuthSession.user.email,
        email: nextAuthSession.user.email,
      } : null)

      const userId = activeUser ? getValidUserId(activeUser) : null
      if (userId) {
        await supabase.from('listening_history').delete().eq('user_id', userId)
        setHistoryItems([])
      }
    } catch (err) {
      alert('Lỗi xóa lịch sử nghe!')
    } finally {
      setClearing(false)
    }
  }

  const handleRemoveSingleItem = async (historyId: string) => {
    const { error } = await supabase.from('listening_history').delete().eq('id', historyId)
    if (!error) {
      setHistoryItems((prev) => prev.filter((item) => item.id !== historyId))
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
    <div className="p-3.5 sm:p-6 md:p-8 flex flex-col gap-4 sm:gap-6 md:gap-8 max-w-7xl mx-auto w-full pb-36 md:pb-8 select-none">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] p-4 sm:p-6 md:p-8 bg-[#0d1017] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <div
            style={{
              backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
              borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
              color: 'var(--spotify-glow, #22d3ee)',
            }}
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl border flex items-center justify-center shrink-0 shadow-md"
          >
            <History className="w-6 h-6 sm:w-7 sm:h-7" />
          </div>

          <div className="flex flex-col gap-1">
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">Lịch sử nghe nhạc</h1>
            <p className="text-xs text-slate-400">
              Danh sách bài hát bạn đã nghe gần đây
            </p>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-3 shrink-0">
          {historyItems.length > 0 && (
            <>
              <button
                onClick={handlePlayAllHistory}
                style={{
                  background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                  boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                }}
                className="text-black font-bold px-4 py-2 sm:px-5 sm:py-2.5 rounded-full flex items-center gap-2 text-xs transition-all hover:brightness-110 active:scale-95 border border-white/20"
              >
                <Play className="w-4 h-4 fill-current text-black" />
                <span>Phát tất cả</span>
              </button>

              <button
                onClick={handleClearAllHistory}
                disabled={clearing}
                className="bg-white/5 hover:bg-red-500/10 text-slate-300 hover:text-red-400 border border-white/10 font-semibold px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-full flex items-center gap-2 text-xs transition-colors disabled:opacity-50"
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
          <div className="flex flex-col divide-y divide-white/5">
            {filteredItems.map((item, idx) => {
              const track = item.track
              const isCurrentPlaying = currentTrack?.id === track.id && isPlaying

              return (
                <div
                  key={item.id}
                  onClick={() => playTrack(track, filteredItems.map((i) => i.track))}
                  className="flex items-center justify-between p-2.5 sm:p-3 rounded-2xl hover:bg-white/5 transition-all group gap-2.5 sm:gap-4 cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 sm:gap-4 flex-1 min-w-0">
                    <span className="text-xs font-mono text-slate-500 w-5 sm:w-6 text-right shrink-0">
                      {idx + 1}
                    </span>

                    {/* Play / Cover Thumbnail */}
                    <div
                      onClick={() => playTrack(track, filteredItems.map((i) => i.track))}
                      className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center shrink-0 cursor-pointer relative overflow-hidden group/thumb"
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
                      onClick={() => handleRemoveSingleItem(item.id)}
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
