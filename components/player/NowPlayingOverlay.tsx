'use client'

import React, { useEffect, useState } from 'react'
import { usePlayer, usePlaybackProgress } from './PlayerContext'
import { NowPlayingStage } from './NowPlayingStage'
import { LyricsView } from './LyricsView'
import { MiniEqualizer } from './MiniEqualizer'
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
  Volume2,
  VolumeX,
  DiscAlbum,
  Mic2,
  Sparkles,
} from 'lucide-react'

export function NowPlayingOverlay() {
  const { currentTime, duration } = usePlaybackProgress()
  const {
    currentTrack,
    isPlaying,
    togglePlay,
    nextTrack,
    prevTrack,
    seek,
    volume,
    setVolume,
    isShuffle,
    toggleShuffle,
    repeatMode,
    toggleRepeat,
    toggleFavoriteCurrentTrack,
    isNowPlayingOpen,
    closeNowPlayingOverlay,
    frequencyData,
  } = usePlayer()

  const [mobileTab, setMobileTab] = useState<'cover' | 'lyrics'>('cover')
  const [isLiked, setIsLiked] = useState<boolean>(false)

  // Listen to Esc key to close overlay
  useEffect(() => {
    if (!isNowPlayingOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeNowPlayingOverlay()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isNowPlayingOpen, closeNowPlayingOverlay])

  if (!currentTrack) return null

  const handleFavoriteClick = async () => {
    setIsLiked((prev) => !prev)
    await toggleFavoriteCurrentTrack()
  }

  const handleVolumeToggle = () => {
    if (volume > 0) setVolume(0)
    else setVolume(0.8)
  }

  return (
    <div
      className={`now-playing-overlay fixed inset-0 z-[100] bg-[#07090e] text-white flex flex-col transition-transform duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] select-none ${
        isNowPlayingOpen ? 'open translate-y-0' : 'translate-y-full pointer-events-none'
      }`}
    >
      {/* 🔝 Unified Top Header (Full Width) */}
      <div className="relative z-30 flex items-center justify-between h-16 px-6 border-b border-white/[0.08] shrink-0 bg-black/40 backdrop-blur-xl">
        <button
          onClick={closeNowPlayingOverlay}
          className="p-2 text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-full transition-all active:scale-95 flex items-center gap-1.5 text-xs font-semibold"
          title="Thu nhỏ player (Esc)"
        >
          <ChevronDown className="w-5 h-5" />
          <span className="hidden sm:inline">Thu nhỏ</span>
        </button>

        {/* Mobile Tab Switcher (<1024px screens) */}
        <div className="flex lg:hidden items-center gap-1 p-1 bg-white/5 border border-white/10 rounded-xl">
          <button
            onClick={() => setMobileTab('cover')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              mobileTab === 'cover'
                ? 'bg-[var(--accent,#06b6d4)] text-black shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <DiscAlbum className="w-3.5 h-3.5" />
            <span>Ảnh bìa</span>
          </button>
          <button
            onClick={() => setMobileTab('lyrics')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              mobileTab === 'lyrics'
                ? 'bg-[var(--accent,#06b6d4)] text-black shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Mic2 className="w-3.5 h-3.5" />
            <span>Lời bài hát</span>
          </button>
        </div>

        {/* Right Header context badge */}
        <div className="hidden lg:flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 shadow-[0_0_12px_rgba(16,185,129,0.25)]">
            <Sparkles className="w-3 h-3 text-emerald-400" />
            SYNCED LYRICS
          </span>
        </div>
      </div>

      {/* 🎭 Main Stage Area */}
      <div className="flex-1 min-h-0 relative flex overflow-hidden bg-gradient-to-r from-[#07090e] via-[#07090e] to-[#0f0b16]">
        {/* Desktop View (>=1024px): 2 Columns (Seamless blend, no vertical seam line) */}
        <div className="hidden lg:flex w-full h-full">
          {/* Left Column (~55%): 3D Particles + Album Cover */}
          <div className="w-[55%] h-full relative bg-transparent">
            <NowPlayingStage
              analyserData={frequencyData}
              coverUrl={currentTrack.cover_url}
              title={currentTrack.title}
              artist={currentTrack.artist}
              isPlaying={isPlaying}
            />
          </div>

          {/* Right Column (~45%): Synchronized Lyrics */}
          <div className="w-[45%] h-full relative bg-transparent lyrics-panel-fade">
            <LyricsView isModal={false} showControls={false} showHeader={false} />
          </div>
        </div>

        {/* Mobile View (<1024px): 1 Column Tab Switcher */}
        <div className="flex lg:hidden w-full h-full">
          {mobileTab === 'cover' ? (
            <div className="w-full h-full relative">
              <NowPlayingStage
                analyserData={frequencyData}
                coverUrl={currentTrack.cover_url}
                title={currentTrack.title}
                artist={currentTrack.artist}
                isPlaying={isPlaying}
              />
            </div>
          ) : (
            <div className="w-full h-full relative">
              <LyricsView isModal={false} showControls={false} showHeader={false} />
            </div>
          )}
        </div>
      </div>

      {/* 🎛️ Bottom Control Bar (Full-width) */}
      <div className="relative z-30 px-6 py-4 bg-black/60 backdrop-blur-2xl border-t border-white/10 shrink-0 flex flex-col gap-3">
        {/* Progress Bar Flex Row (Unified Single Row) */}
        <div className="progress-row max-w-4xl mx-auto">
          <span className="progress-time text-right">
            {Math.floor(currentTime / 60)}:{(Math.floor(currentTime % 60) < 10 ? '0' : '') + Math.floor(currentTime % 60)}
          </span>
          <div className="progress-track-wrapper">
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, Math.max(0, (currentTime / (duration || currentTrack.duration || 1)) * 100))}%` }}
              />
              <div
                className="progress-thumb"
                style={{ left: `${Math.min(100, Math.max(0, (currentTime / (duration || currentTrack.duration || 1)) * 100))}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={duration || currentTrack.duration || 1}
              step={0.1}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              title="Kéo để tua nhạc"
            />
          </div>
          <span className="progress-time">
            {Math.floor((duration || currentTrack.duration || 0) / 60)}:{(Math.floor((duration || currentTrack.duration || 0) % 60) < 10 ? '0' : '') + Math.floor((duration || currentTrack.duration || 0) % 60)}
          </span>
        </div>

        {/* Playback Controls Row */}
        <div className="flex items-center justify-between w-full max-w-4xl mx-auto">
          {/* Left: Like button & Mini Equalizer */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleFavoriteClick}
              className={`like-btn p-2.5 rounded-full border border-white/10 transition-all ${
                isLiked ? 'liked bg-rose-500/20 text-rose-400 border-rose-500/30' : 'text-slate-400 hover:text-white bg-white/5'
              }`}
              title={isLiked ? 'Đã yêu thích' : 'Yêu thích bài hát'}
            >
              <Heart className={`w-5 h-5 ${isLiked ? 'fill-current' : ''}`} />
            </button>
            <MiniEqualizer isPlaying={isPlaying} />
          </div>

          {/* Center: Shuffle, Prev, Main Play (56px), Next, Repeat */}
          <div className="flex items-center gap-4">
            <button
              onClick={toggleShuffle}
              className={`p-2.5 rounded-full transition-all ${
                isShuffle ? 'text-[var(--accent,#06b6d4)] bg-white/10' : 'text-slate-400 hover:text-white'
              }`}
              title="Phát ngẫu nhiên"
            >
              <Shuffle className="w-5 h-5" />
            </button>

            <button
              onClick={prevTrack}
              className="p-2.5 text-slate-300 hover:text-white active:scale-90 transition-transform"
              title="Bài trước"
            >
              <SkipBack className="w-6 h-6" />
            </button>

            <button
              onClick={togglePlay}
              style={{
                background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--accent, #06b6d4))',
                boxShadow: '0 4px 20px var(--theme-glow-shadow, rgba(6,182,212,0.4))',
              }}
              className="w-14 h-14 rounded-full text-black flex items-center justify-center font-bold hover:brightness-110 active:scale-95 transition-all border border-white/20"
              title={isPlaying ? 'Tạm dừng' : 'Phát'}
            >
              {isPlaying ? (
                <Pause className="w-6 h-6 fill-current text-black" />
              ) : (
                <Play className="w-6 h-6 fill-current text-black ml-0.5" />
              )}
            </button>

            <button
              onClick={nextTrack}
              className="p-2.5 text-slate-300 hover:text-white active:scale-90 transition-transform"
              title="Bài kế tiếp"
            >
              <SkipForward className="w-6 h-6" />
            </button>

            <button
              onClick={toggleRepeat}
              className={`p-2.5 rounded-full transition-all ${
                repeatMode !== 'off' ? 'text-[var(--accent,#06b6d4)] bg-white/10' : 'text-slate-400 hover:text-white'
              }`}
              title="Lặp lại"
            >
              {repeatMode === 'one' ? <Repeat1 className="w-5 h-5" /> : <Repeat className="w-5 h-5" />}
            </button>
          </div>

          {/* Right: Volume Control (Matching Progress Bar Style) */}
          <div className="hidden sm:flex items-center gap-2">
            <button onClick={handleVolumeToggle} className="text-slate-400 hover:text-white p-0.5" title={volume === 0 ? 'Mở tiếng' : 'Tắt tiếng'}>
              {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <div className="volume-track-wrapper w-24">
              <div className="volume-track">
                <div className="volume-fill" style={{ width: `${volume * 100}%` }} />
                <div className="volume-thumb" style={{ left: `${volume * 100}%` }} />
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                title="Chỉnh âm lượng"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
