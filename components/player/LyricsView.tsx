'use client'

import React, { useEffect, useState, useRef } from 'react'
import { usePlayer } from './PlayerContext'
import { fetchLyricsFromLrclib, LrclibResponse } from '@/lib/lrclib'
import { parseLrc, parsePlainLyrics, findActiveLyricIndex, LyricLine } from '@/lib/lrcParser'
import { Disc, Music, Search, RefreshCw, Sparkles, Mic2, AlertCircle } from 'lucide-react'

interface LyricsViewProps {
  onClose?: () => void
  isModal?: boolean
}

export function LyricsView({ onClose, isModal = false }: LyricsViewProps) {
  const { currentTrack, currentTime, seek, isPlaying } = usePlayer()

  const [loading, setLoading] = useState(false)
  const [lyricsData, setLyricsData] = useState<LrclibResponse | null>(null)
  const [parsedLyrics, setParsedLyrics] = useState<LyricLine[]>([])
  const [isSynced, setIsSynced] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [manualQuery, setManualQuery] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const activeLineRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const isUserScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 1. Fetch lyrics when currentTrack changes
  useEffect(() => {
    if (!currentTrack) {
      setLyricsData(null)
      setParsedLyrics([])
      setIsSynced(false)
      return
    }

    // Reset manual query & search mode
    setManualQuery(`${currentTrack.title} ${currentTrack.artist || ''}`.trim())
    setShowSearch(false)
    setErrorMessage(null)

    loadLyricsForTrack(currentTrack.title, currentTrack.artist, currentTrack.duration)
  }, [currentTrack?.id])

  const loadLyricsForTrack = async (title: string, artist?: string | null, duration?: number | null) => {
    setLoading(true)
    setErrorMessage(null)

    try {
      const data = await fetchLyricsFromLrclib({ title, artist, duration })

      if (data) {
        setLyricsData(data)
        if (data.syncedLyrics && data.syncedLyrics.trim().length > 0) {
          const parsed = parseLrc(data.syncedLyrics)
          setParsedLyrics(parsed)
          setIsSynced(true)
        } else if (data.plainLyrics && data.plainLyrics.trim().length > 0) {
          const parsed = parsePlainLyrics(data.plainLyrics)
          setParsedLyrics(parsed)
          setIsSynced(false)
        } else {
          setParsedLyrics([])
          setIsSynced(false)
        }
      } else {
        setLyricsData(null)
        setParsedLyrics([])
        setIsSynced(false)
      }
    } catch (err: any) {
      console.error('Error fetching lyrics:', err)
      setErrorMessage('Khởi tạo lời bài hát thất bại. Vui lòng thử lại.')
    } finally {
      setLoading(false)
    }
  }

  // Handle manual search
  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!manualQuery.trim()) return
    loadLyricsForTrack(manualQuery.trim())
  }

  // 2. Track active line index based on currentTime
  useEffect(() => {
    if (!isSynced || parsedLyrics.length === 0) return

    const idx = findActiveLyricIndex(parsedLyrics, currentTime)
    if (idx !== activeIndex) {
      setActiveIndex(idx)
    }
  }, [currentTime, parsedLyrics, isSynced])

  // 3. Smooth auto-scroll to active line
  useEffect(() => {
    if (!isSynced || activeIndex < 0 || !activeLineRef.current || !scrollContainerRef.current) return

    // If user is actively scrolling manually, pause auto-scroll briefly
    if (isUserScrollingRef.current) return

    const container = scrollContainerRef.current
    const activeEl = activeLineRef.current

    const containerHeight = container.clientHeight
    const activeTop = activeEl.offsetTop
    const activeHeight = activeEl.clientHeight

    const targetScrollTop = activeTop - containerHeight / 2 + activeHeight / 2

    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: 'smooth',
    })
  }, [activeIndex, isSynced])

  // Handle user scroll detection
  const handleScroll = () => {
    isUserScrollingRef.current = true
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)

    // Resume auto-scroll after 3 seconds of scroll inactivity
    scrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingRef.current = false
    }, 3000)
  }

  const handleLineClick = (line: LyricLine) => {
    if (line.time >= 0) {
      seek(line.time)
      isUserScrollingRef.current = false
    }
  }

  if (!currentTrack) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center select-none">
        <Disc className="w-16 h-16 text-slate-600 mb-4 animate-spin-slow" />
        <h3 className="text-lg font-bold text-slate-200">Chưa có bài hát đang phát</h3>
        <p className="text-xs text-slate-500 mt-1">Hãy chọn một bài hát từ thư viện để xem lời bài hát</p>
      </div>
    )
  }

  return (
    <div className={`relative w-full h-full flex flex-col overflow-hidden select-none bg-[#07080c] ${isModal ? 'p-4 md:p-8' : 'p-4 md:p-6'}`}>
      {/* 🌟 Dynamic Blurred Album Cover Background */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        {currentTrack.cover_url ? (
          <img
            src={currentTrack.cover_url}
            alt=""
            className="w-full h-full object-cover blur-3xl scale-125 opacity-25 filter brightness-50"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-emerald-950/40 via-[#0a0c14] to-purple-950/30 blur-2xl" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07080c] via-[#07080c]/80 to-[#07080c]/60" />
      </div>

      {/* 🔝 Lyrics Header & Controls */}
      <div className="relative z-10 flex items-center justify-between gap-4 pb-4 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden shadow-lg">
            {currentTrack.cover_url ? (
              <img src={currentTrack.cover_url} alt={currentTrack.title} className="w-full h-full object-cover" />
            ) : (
              <Mic2 className="w-6 h-6 text-[var(--primary-spotify)]" />
            )}
          </div>
          <div className="truncate flex flex-col">
            <h2 className="text-base md:text-lg font-bold text-white truncate flex items-center gap-2">
              <span>{currentTrack.title}</span>
              {isSynced && (
                <span className="text-[10px] uppercase font-mono font-extrabold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                  ✨ Synced Karaoke
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400 truncate">
              {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
              {currentTrack.album ? ` • ${currentTrack.album}` : ''}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setShowSearch(!showSearch)}
            className={`p-2 rounded-xl border transition-all text-xs font-semibold flex items-center gap-1.5 ${
              showSearch
                ? 'bg-[var(--primary-spotify)] text-black border-[var(--primary-spotify)]'
                : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
            }`}
            title="Tìm lời bài hát thủ công"
          >
            <Search className="w-4 h-4" />
            <span className="hidden sm:inline">Tìm lời khác</span>
          </button>

          <button
            onClick={() => loadLyricsForTrack(currentTrack.title, currentTrack.artist, currentTrack.duration)}
            disabled={loading}
            className="p-2 bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white rounded-xl border border-white/10 transition-colors"
            title="Tải lại lời bài hát"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 🔍 Manual Search Box overlay */}
      {showSearch && (
        <form
          onSubmit={handleManualSearch}
          className="relative z-20 my-3 p-3 bg-[#121522]/95 backdrop-blur-xl border border-white/15 rounded-2xl flex items-center gap-2 shadow-2xl animate-in slide-in-from-top-2 duration-200"
        >
          <Search className="w-4 h-4 text-slate-400 ml-1" />
          <input
            type="text"
            value={manualQuery}
            onChange={(e) => setManualQuery(e.target.value)}
            placeholder="Nhập tên bài hát hoặc ca sĩ để tìm kiếm trên LRCLIB..."
            className="flex-1 bg-transparent text-sm text-white focus:outline-none placeholder-slate-500 font-medium"
          />
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-1.5 bg-[var(--primary-spotify)] text-black text-xs font-bold rounded-xl hover:scale-105 transition-transform"
          >
            {loading ? 'Đang tìm...' : 'Tìm kiếm'}
          </button>
        </form>
      )}

      {/* 📜 Lyrics Main Content Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto my-4 pr-2 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20"
      >
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16">
            <RefreshCw className="w-8 h-8 text-[var(--primary-spotify)] animate-spin mb-3" />
            <p className="text-sm font-semibold text-slate-300">Đang tìm lời bài hát từ LRCLIB...</p>
          </div>
        ) : parsedLyrics.length > 0 ? (
          <div className="flex flex-col gap-6 py-12 md:py-24 text-center sm:text-left max-w-3xl mx-auto">
            {parsedLyrics.map((line, index) => {
              const isActive = index === activeIndex
              const isPast = index < activeIndex

              return (
                <div
                  key={index}
                  ref={isActive ? activeLineRef : null}
                  onClick={() => handleLineClick(line)}
                  className={`group transition-all duration-300 cursor-pointer rounded-2xl p-3 sm:px-6 sm:py-3.5 select-none ${
                    isActive
                      ? 'scale-105 sm:scale-105 bg-white/10 backdrop-blur-xl border border-emerald-500/30 text-white font-extrabold text-lg sm:text-2xl md:text-3xl shadow-xl shadow-emerald-950/50'
                      : isPast
                      ? 'text-slate-500 hover:text-slate-300 text-sm sm:text-lg md:text-xl font-medium'
                      : 'text-slate-400 hover:text-slate-200 text-sm sm:text-lg md:text-xl font-medium'
                  }`}
                >
                  <p
                    className={`transition-colors leading-relaxed ${
                      isActive
                        ? 'text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-white to-cyan-300 drop-shadow-[0_0_20px_rgba(16,185,129,0.5)]'
                        : ''
                    }`}
                  >
                    {line.text}
                  </p>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16 text-center">
            <AlertCircle className="w-12 h-12 text-slate-600 mb-3" />
            <h4 className="text-base font-bold text-slate-300 mb-1">Không tìm thấy lời bài hát</h4>
            <p className="text-xs text-slate-500 max-w-sm mb-4">
              Bài hát này chưa có dữ liệu trên thư viện LRCLIB hoặc tên bài hát chưa chính xác.
            </p>
            <button
              onClick={() => setShowSearch(true)}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-xl border border-white/10 transition-all flex items-center gap-2"
            >
              <Search className="w-4 h-4" />
              Thử tìm kiếm tên khác
            </button>
          </div>
        )}
      </div>

      {/* 📢 Footer Credit */}
      <div className="relative z-10 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-500 font-mono shrink-0">
        <span className="flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          <span>Dữ liệu lyrics từ LRCLIB (Mã nguồn mở)</span>
        </span>
        {isSynced && <span className="text-emerald-400/80">Nhấn vào từng câu hát để phát đoạn đó</span>}
      </div>
    </div>
  )
}
