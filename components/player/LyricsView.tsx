'use client'

import React, { useEffect, useState, useRef } from 'react'
import { usePlayer, usePlaybackProgress } from './PlayerContext'
import { fetchLyricsFromLrclib, LrclibResponse } from '@/lib/lrclib'
import { parseLrc, parsePlainLyrics, findActiveLyricIndex, LyricLine } from '@/lib/lrcParser'
import {
  Headphones,
  RefreshCw,
  Sparkles,
  Mic2,
  AlertCircle,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Heart,
} from 'lucide-react'

interface LyricsViewProps {
  onClose?: () => void
  isModal?: boolean
}

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

const SYNC_CONFIDENCE_THRESHOLD_SEC = 4

function stripLrcTimestamps(lrcText: string): string {
  return lrcText
    .split('\n')
    .map((line) => line.replace(/\[\d{2,}:\d{2}(?:[\.\:]\d{2,3})?\]/g, '').trim())
    .filter((line) => line.length > 0 && !/^\[(ar|ti|al|by|offset|length):/i.test(line))
    .join('\n')
}

function decideLyricDisplayMode(
  videoDuration?: number | null,
  lrcResult?: { duration?: number; syncedLyrics?: string | null; plainLyrics?: string | null } | null
): { mode: 'synced' | 'plain' | 'none'; notice?: string } {
  if (!lrcResult || (!lrcResult.syncedLyrics && !lrcResult.plainLyrics)) {
    return { mode: 'none' }
  }

  const vDur = videoDuration && videoDuration > 0 ? videoDuration : 0
  const lrcDur = lrcResult.duration && lrcResult.duration > 0 ? lrcResult.duration : 0
  const diff = vDur > 0 && lrcDur > 0 ? Math.abs(vDur - lrcDur) : null

  if (lrcResult.syncedLyrics && lrcResult.syncedLyrics.trim().length > 0) {
    if (diff === null || diff <= SYNC_CONFIDENCE_THRESHOLD_SEC) {
      return { mode: 'synced' }
    } else {
      return {
        mode: 'plain',
        notice: `Lời bài hát hiển thị dạng tĩnh do thời lượng bản thu chênh lệch (~${Math.round(diff)}s)`,
      }
    }
  }

  if (lrcResult.plainLyrics && lrcResult.plainLyrics.trim().length > 0) {
    return { mode: 'plain' }
  }

  return { mode: 'none' }
}

export function LyricsView({ onClose, isModal = false }: LyricsViewProps) {
  const { currentTime, duration } = usePlaybackProgress()
  const {
    currentTrack,
    seek,
    isPlaying,
    togglePlay,
    nextTrack,
    prevTrack,
    isShuffle,
    toggleShuffle,
    repeatMode,
    toggleRepeat,
    volume,
    setVolume,
    toggleFavoriteCurrentTrack,
  } = usePlayer()

  const [prevVol, setPrevVol] = useState(0.8)
  const [loading, setLoading] = useState(false)
  const [lyricsData, setLyricsData] = useState<LrclibResponse | null>(null)
  const [parsedLyrics, setParsedLyrics] = useState<LyricLine[]>([])
  const [isSynced, setIsSynced] = useState(false)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [lyricOffset, setLyricOffset] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const activeLineRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const isUserScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleVolumeToggle = () => {
    if (volume > 0) {
      setPrevVol(volume)
      setVolume(0)
    } else {
      setVolume(prevVol || 0.8)
    }
  }

  // 1. Fetch lyrics when currentTrack changes
  useEffect(() => {
    if (!currentTrack) {
      setLyricsData(null)
      setParsedLyrics([])
      setIsSynced(false)
      setSyncNotice(null)
      setLyricOffset(0)
      return
    }

    setErrorMessage(null)
    setSyncNotice(null)
    setLyricOffset(0)
    loadLyricsForTrack(currentTrack.title, currentTrack.artist, currentTrack.duration)
  }, [currentTrack?.id])

  const loadLyricsForTrack = async (title: string, artist?: string | null, duration?: number | null) => {
    setLoading(true)
    setErrorMessage(null)
    setSyncNotice(null)

    try {
      const data = await fetchLyricsFromLrclib({ title, artist, duration })

      if (data) {
        setLyricsData(data)
        const decision = decideLyricDisplayMode(duration, data)

        if (decision.mode === 'synced') {
          const parsed = parseLrc(data.syncedLyrics!)
          setParsedLyrics(parsed)
          setIsSynced(true)
          setSyncNotice(null)
        } else if (decision.mode === 'plain') {
          const plainText = data.plainLyrics || (data.syncedLyrics ? stripLrcTimestamps(data.syncedLyrics) : '')
          const parsed = parsePlainLyrics(plainText)
          setParsedLyrics(parsed)
          setIsSynced(false)
          setSyncNotice(decision.notice || null)
        } else {
          setParsedLyrics([])
          setIsSynced(false)
          setSyncNotice(null)
        }
      } else {
        setLyricsData(null)
        setParsedLyrics([])
        setIsSynced(false)
        setSyncNotice(null)
      }
    } catch (err) {
      setErrorMessage('Không thể tải lời bài hát')
      setParsedLyrics([])
      setIsSynced(false)
      setSyncNotice(null)
    } finally {
      setLoading(false)
    }
  }

  // 2. Track playback time & update active lyric line
  useEffect(() => {
    if (!isSynced || parsedLyrics.length === 0) return

    const index = findActiveLyricIndex(parsedLyrics, currentTime, lyricOffset)
    if (index !== activeIndex) {
      setActiveIndex(index)
    }
  }, [currentTime, parsedLyrics, isSynced, activeIndex, lyricOffset])

  // 3. Smooth scroll active lyric into view
  useEffect(() => {
    if (activeIndex < 0 || !isSynced || isUserScrollingRef.current) return

    const container = scrollContainerRef.current
    const activeLine = activeLineRef.current

    if (container && activeLine) {
      const targetScroll = activeLine.offsetTop - container.clientHeight / 2 + activeLine.clientHeight / 2
      container.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth',
      })
    }
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
      <div className="h-full w-full flex flex-col items-center justify-center text-slate-400 p-8 text-center select-none bg-[#07080c]">
        <Headphones className="w-16 h-16 text-cyan-400/60 mb-4 animate-pulse" />
        <h3 className="text-lg font-bold text-slate-200">Chưa có bài hát đang phát</h3>
        <p className="text-xs text-slate-500 mt-1">Hãy chọn một bài hát từ thư viện để xem lời bài hát</p>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden select-none bg-[#07080c] touch-manipulation">
      {/* 🌟 Dynamic Blurred Album Cover Background */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        {currentTrack.cover_url ? (
          <img
            src={currentTrack.cover_url}
            alt=""
            className="w-full h-full object-cover blur-xl opacity-20 transform-gpu"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-emerald-950/30 via-[#0a0c14] to-purple-950/20" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#07080c] via-[#07080c]/85 to-[#07080c]/70" />
      </div>

      {/* 🔝 Lyrics Header */}
      <div className="relative z-10 flex items-center justify-between gap-4 p-4 md:px-6 md:py-4 border-b border-white/[0.08] shrink-0 bg-white/[0.02]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center shrink-0 overflow-hidden shadow-md">
            {currentTrack.cover_url ? (
              <img src={currentTrack.cover_url} alt={currentTrack.title} className="w-full h-full object-cover" />
            ) : (
              <Mic2 className="w-5 h-5 text-cyan-400" />
            )}
          </div>
          <div className="truncate flex flex-col">
            <h2 className="text-xs md:text-sm font-bold text-white truncate flex items-center gap-2">
              <span>{currentTrack.title}</span>
              {isSynced && (
                <span className="text-[9px] uppercase font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shrink-0">
                  Synced
                </span>
              )}
            </h2>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">
              {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
            </p>
          </div>
        </div>

        {/* Top Actions: Refresh & Optional Close button */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => loadLyricsForTrack(currentTrack.title, currentTrack.artist, currentTrack.duration)}
            disabled={loading}
            className="w-9 h-9 flex items-center justify-center bg-white/5 hover:bg-white/10 active:bg-white/15 text-slate-300 rounded-xl border border-white/10 transition-colors"
            title="Tải lại lời bài hát"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center bg-white/10 hover:bg-white/20 active:bg-white/25 text-white rounded-xl border border-white/10 transition-colors"
              title="Đóng lời bài hát"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 📜 Lyrics Main Content Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="relative z-10 flex-1 overflow-y-auto px-4 md:px-8 no-scrollbar"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 py-16">
            <RefreshCw className="w-8 h-8 text-[var(--primary-spotify,#06b6d4)] animate-spin mb-3" />
            <p className="text-sm font-semibold text-slate-300">Đang tải lời bài hát từ LRCLIB...</p>
          </div>
        ) : parsedLyrics.length > 0 ? (
          <div className="flex flex-col gap-4 py-12 md:py-20 text-center sm:text-left max-w-2xl mx-auto">
            {parsedLyrics.map((line, index) => {
              const isActive = index === activeIndex
              const isPast = index < activeIndex

              return (
                <div
                  key={index}
                  ref={isActive ? activeLineRef : null}
                  onClick={() => handleLineClick(line)}
                  className={`transition-all duration-300 ease-out cursor-pointer rounded-2xl p-3 sm:px-5 sm:py-3.5 select-none transform-gpu origin-center sm:origin-left active:scale-[0.97] ${
                    isActive
                      ? 'scale-[1.03] bg-white/[0.08] border border-cyan-500/30 text-white font-extrabold text-lg sm:text-xl md:text-2xl shadow-xl shadow-cyan-950/40 opacity-100'
                      : isPast
                      ? 'text-slate-400 font-bold text-base sm:text-lg md:text-xl opacity-40 hover:opacity-75'
                      : 'text-slate-300 font-bold text-base sm:text-lg md:text-xl opacity-50 hover:opacity-85'
                  }`}
                >
                  <p
                    className={`transition-colors leading-snug ${
                      isActive
                        ? 'text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-white to-teal-300 drop-shadow-[0_0_18px_rgba(6,182,212,0.65)]'
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
              Bài hát này chưa có dữ liệu trên thư viện LRCLIB hoặc chưa cập nhật.
            </p>
          </div>
        )}
      </div>

      {/* 🎵 BOTTOM PLAYER CONTROLS & SEEK BAR */}
      <div className="relative z-20 bg-[#090b10]/95 backdrop-blur-2xl border-t border-white/[0.08] px-4 md:px-6 py-3 flex items-center justify-between text-slate-300 select-none shrink-0 pb-safe">
        {/* Left: Track Metadata */}
        <div className="hidden sm:flex items-center gap-3 w-1/4 min-w-[180px]">
          <div className="w-10 h-10 bg-slate-800 rounded-xl overflow-hidden relative flex items-center justify-center border border-white/10 shadow-md shrink-0">
            {currentTrack.cover_url ? (
              <img
                src={currentTrack.cover_url}
                alt={currentTrack.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <Headphones className="w-4 h-4 text-cyan-400" />
            )}
          </div>

          <div className="truncate flex flex-col min-w-0">
            <p className="text-xs font-bold text-white truncate hover:text-[var(--spotify-glow)] transition-colors cursor-pointer">
              {currentTrack.title}
            </p>
            <p className="text-[10px] text-slate-400 truncate hover:text-slate-200 transition-colors cursor-pointer">
              {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
            </p>
          </div>

          <button
            onClick={toggleFavoriteCurrentTrack}
            className={`p-1.5 rounded-lg transition-all ml-1 shrink-0 ${
              currentTrack.is_favorite
                ? 'text-rose-500 bg-rose-500/15 border border-rose-500/30'
                : 'text-slate-400 hover:text-rose-400 hover:bg-white/5'
            }`}
            title={currentTrack.is_favorite ? 'Bỏ khỏi bài hát yêu thích' : 'Thêm vào bài hát yêu thích'}
          >
            <Heart
              className={`w-3.5 h-3.5 transition-all ${
                currentTrack.is_favorite ? 'fill-current drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]' : ''
              }`}
            />
          </button>
        </div>

        {/* Center: Playback Controls & Seekbar */}
        <div className="flex flex-col items-center gap-1.5 w-full sm:w-2/4 max-w-xl">
          <div className="flex items-center gap-4">
            <button
              onClick={toggleShuffle}
              style={
                isShuffle
                  ? {
                      color: 'var(--spotify-glow, #22d3ee)',
                      backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                      borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                    }
                  : undefined
              }
              className={`p-1.5 rounded-lg relative transition-all ${
                isShuffle ? 'border shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title={isShuffle ? 'Tắt phát ngẫu nhiên' : 'Bật phát ngẫu nhiên'}
            >
              <Shuffle className="w-4 h-4" />
              {isShuffle && (
                <span
                  style={{ backgroundColor: 'var(--spotify-glow, #22d3ee)' }}
                  className="w-1 h-1 rounded-full absolute -bottom-0.5 left-1/2 -translate-x-1/2"
                />
              )}
            </button>

            <button
              onClick={prevTrack}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-90"
              title="Bài trước"
            >
              <SkipBack className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={togglePlay}
              style={{
                background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
              }}
              className="w-10 h-10 rounded-full hover:brightness-110 active:scale-95 transition-all flex items-center justify-center text-black font-bold shrink-0 border border-white/20"
              title={isPlaying ? 'Tạm dừng' : 'Phát'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current text-black" />
              ) : (
                <Play className="w-4 h-4 fill-current text-black ml-0.5" />
              )}
            </button>

            <button
              onClick={nextTrack}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-full transition-all active:scale-90"
              title="Bài tiếp theo"
            >
              <SkipForward className="w-4.5 h-4.5" />
            </button>

            <button
              onClick={toggleRepeat}
              style={
                repeatMode !== 'off'
                  ? {
                      color: 'var(--spotify-glow, #22d3ee)',
                      backgroundColor: 'var(--theme-gradient-1, rgba(6,182,212,0.15))',
                      borderColor: 'var(--theme-glow-shadow, rgba(6,182,212,0.3))',
                    }
                  : undefined
              }
              className={`p-1.5 rounded-lg relative transition-all ${
                repeatMode !== 'off' ? 'border shadow-md' : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
              title={
                repeatMode === 'one'
                  ? 'Lặp lại 1 bài'
                  : repeatMode === 'all'
                  ? 'Lặp lại toàn bộ danh sách'
                  : 'Bật lặp lại bài hát'
              }
            >
              {repeatMode === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
              {repeatMode !== 'off' && (
                <span
                  style={{ backgroundColor: 'var(--spotify-glow, #22d3ee)' }}
                  className="w-1 h-1 rounded-full absolute -bottom-0.5 left-1/2 -translate-x-1/2"
                />
              )}
            </button>
          </div>

          <div className="w-full flex items-center gap-2.5 text-[11px] text-slate-400 font-mono">
            <span className="w-9 text-right shrink-0">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
              style={{
                background: `linear-gradient(to right, var(--primary-spotify,#06b6d4) ${(currentTime / (duration || 1)) * 100}%, rgba(255,255,255,0.12) ${(currentTime / (duration || 1)) * 100}%)`,
              }}
              className="flex-1 h-1.5 rounded-lg appearance-none cursor-pointer outline-none transition-all"
            />
            <span className="w-9 shrink-0">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Right: Volume Control Pill */}
        <div className="hidden sm:flex w-1/4 justify-end items-center">
          <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-full px-3 py-1.5">
            <button
              onClick={handleVolumeToggle}
              className="text-slate-400 hover:text-white transition-colors p-0.5"
              title={volume === 0 ? 'Mở tiếng' : 'Tắt tiếng'}
            >
              {volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              style={{
                background: `linear-gradient(to right, var(--primary-spotify,#06b6d4) ${volume * 100}%, rgba(255,255,255,0.12) ${volume * 100}%)`,
              }}
              className="w-16 md:w-20 h-1 rounded-lg appearance-none cursor-pointer outline-none transition-all"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
