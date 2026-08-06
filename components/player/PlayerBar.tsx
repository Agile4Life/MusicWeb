'use client'

import React, { useState } from 'react'
import { usePlayer } from './PlayerContext'
import { LyricsView } from './LyricsView'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Music,
  Headphones,
  ChevronDown,
  Maximize2,
  SlidersHorizontal,
  Mic2,
  X,
  Shuffle,
  Repeat,
  Repeat1,
  Heart,
} from 'lucide-react'

function formatTime(seconds: number) {
  if (isNaN(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export function PlayerBar() {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isShuffle,
    toggleShuffle,
    repeatMode,
    toggleRepeat,
    toggleFavoriteCurrentTrack,
    playbackError,
    togglePlay,
    seek,
    setVolume,
    nextTrack,
    prevTrack,
  } = usePlayer()

  const [prevVol, setPrevVol] = useState(0.8)
  const [showMobileFullPlayer, setShowMobileFullPlayer] = useState(false)
  const [showLyricsModal, setShowLyricsModal] = useState(false)

  const handleVolumeToggle = () => {
    if (volume > 0) {
      setPrevVol(volume)
      setVolume(0)
    } else {
      setVolume(prevVol || 0.8)
    }
  }

  if (!currentTrack) {
    return (
      <footer className="h-20 bg-[#07080d]/90 backdrop-blur-2xl border-t border-white/5 px-4 md:px-6 flex items-center justify-between text-slate-400 select-none z-30">
        <div className="flex items-center gap-3 w-full md:w-1/4 justify-center md:justify-start">
          <div className="w-10 h-10 md:w-12 md:h-12 bg-white/5 rounded-xl flex items-center justify-center text-slate-600 border border-white/5">
            <Music className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-300">Chưa chọn bài hát nào</p>
            <p className="text-[10px] text-slate-500">Chọn một bài hát từ thư viện để phát</p>
          </div>
        </div>

        {/* Desktop Controls Only when empty */}
        <div className="hidden md:flex flex-col items-center gap-1 w-2/4 max-w-xl">
          <div className="flex items-center gap-5 text-slate-600">
            <SkipBack className="w-4 h-4 cursor-not-allowed" />
            <button className="w-9 h-9 rounded-full bg-white/5 flex items-center justify-center text-slate-600 cursor-not-allowed border border-white/5">
              <Play className="w-4 h-4 fill-current ml-0.5" />
            </button>
            <SkipForward className="w-4 h-4 cursor-not-allowed" />
          </div>
          <div className="w-full flex items-center gap-2 text-[10px] text-slate-600 font-mono">
            <span>0:00</span>
            <div className="flex-1 h-1 bg-white/5 rounded-full" />
            <span>0:00</span>
          </div>
        </div>

        <div className="hidden md:flex w-1/4 justify-end items-center gap-2 text-slate-600">
          <Volume2 className="w-4 h-4 cursor-not-allowed" />
          <div className="w-20 h-1 bg-white/5 rounded-full" />
        </div>
      </footer>
    )
  }

  return (
    <>
      {/* 📱 MOBILE FLOATING MINI PLAYER BAR (Visible on < 768px, positioned right above mobile bottom nav) */}
      <div className="md:hidden fixed bottom-[68px] left-3 right-3 z-40 bg-gradient-to-r from-[#0d1322]/95 via-[#080d19]/95 to-[#0d1322]/95 backdrop-blur-2xl border border-cyan-500/30 rounded-2xl p-2.5 shadow-2xl shadow-cyan-950/40 select-none">
        <div className="flex items-center justify-between gap-3">
          {/* Tap to expand full mobile player */}
          <div
            onClick={() => setShowMobileFullPlayer(true)}
            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer active:opacity-80"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center overflow-hidden shrink-0 relative shadow-md">
              {currentTrack.cover_url ? (
                <img
                  src={currentTrack.cover_url}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Headphones className={`w-5 h-5 text-cyan-400 ${isPlaying ? 'animate-pulse' : ''}`} />
              )}
            </div>

            <div className="flex flex-col truncate flex-1 min-w-0">
              <span className="text-xs font-extrabold text-white truncate">{currentTrack.title}</span>
              <span className="text-[10px] font-medium text-slate-400 truncate">
                {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
              </span>
            </div>
          </div>

          {/* Quick Touch Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation()
                toggleFavoriteCurrentTrack()
              }}
              className="p-2 rounded-full text-slate-400 active:text-rose-400 transition-colors"
              title={currentTrack.is_favorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'}
            >
              <Heart
                className={`w-4 h-4 transition-all ${
                  currentTrack.is_favorite
                    ? 'text-rose-500 fill-current drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]'
                    : 'text-slate-400'
                }`}
              />
            </button>

            <button
              onClick={togglePlay}
              className="w-9 h-9 rounded-full bg-[var(--primary-spotify)] text-black flex items-center justify-center shadow-lg shadow-[var(--theme-glow-shadow)] active:scale-95 transition-transform"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>

            <button
              onClick={nextTrack}
              className="p-2 text-slate-300 active:text-white active:scale-95"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mini progress bar on top edge of mini player */}
        <div className="w-full h-0.5 bg-white/10 rounded-full mt-2 overflow-hidden">
          <div
            className="h-full bg-[var(--primary-spotify)] transition-all duration-300"
            style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* 📱 FULL-SCREEN MOBILE PLAYER OVERLAY MODAL */}
      {showMobileFullPlayer && (
        <div className="md:hidden fixed inset-0 z-50 bg-[#06080e]/98 backdrop-blur-3xl flex flex-col justify-between p-6 select-none animate-in slide-in-from-bottom duration-300 overflow-y-auto">
          {/* Header handle */}
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <button
              onClick={() => setShowMobileFullPlayer(false)}
              className="p-2.5 bg-white/5 active:bg-white/15 rounded-2xl text-slate-300 border border-white/10"
            >
              <ChevronDown className="w-6 h-6" />
            </button>

            <span className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
              <Headphones className="w-3.5 h-3.5 text-cyan-400" />
              MusicWeb Player
            </span>

            <button
              onClick={() => {
                setShowMobileFullPlayer(false)
                setShowLyricsModal(true)
              }}
              className="p-2.5 bg-cyan-500/10 active:bg-cyan-500/20 rounded-2xl text-cyan-300 border border-cyan-500/30"
              title="Xem lời bài hát"
            >
              <Mic2 className="w-5 h-5" />
            </button>
          </div>

          {/* Large Album Artwork with Ambient Glow */}
          <div className="flex-1 flex items-center justify-center my-6 relative">
            <div className="absolute inset-0 bg-cyan-500/10 blur-3xl rounded-full scale-75 pointer-events-none" />
            <div className="w-64 h-64 sm:w-72 sm:h-72 rounded-3xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/15 shadow-2xl shadow-cyan-950/50 flex items-center justify-center overflow-hidden relative p-1.5">
              {currentTrack.cover_url ? (
                <img
                  src={currentTrack.cover_url}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover rounded-2xl shadow-inner"
                />
              ) : (
                <div className="w-full h-full bg-[#080c14] rounded-2xl flex items-center justify-center text-cyan-400">
                  <Headphones className={`w-28 h-28 ${isPlaying ? 'animate-pulse' : ''}`} />
                </div>
              )}
            </div>
          </div>

          {/* Track Info Header */}
          <div className="flex items-center justify-between gap-3 mb-6">
            <div className="flex flex-col items-start gap-1 min-w-0 flex-1">
              <h2 className="text-xl font-black text-white truncate w-full">{currentTrack.title}</h2>
              <p className="text-sm font-bold text-slate-400 truncate w-full">
                {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
              </p>
            </div>
            <button
              onClick={toggleFavoriteCurrentTrack}
              className="p-3 rounded-2xl bg-white/5 active:bg-white/15 text-slate-400 border border-white/10 shrink-0"
              title={currentTrack.is_favorite ? 'Bỏ khỏi yêu thích' : 'Thêm vào yêu thích'}
            >
              <Heart
                className={`w-6 h-6 transition-all ${
                  currentTrack.is_favorite
                    ? 'text-rose-500 fill-current drop-shadow-[0_0_12px_rgba(244,63,94,0.8)]'
                    : 'text-slate-400'
                }`}
              />
            </button>
          </div>

          {/* Scrubber Slider */}
          <div className="flex flex-col gap-1.5 mb-8">
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[var(--primary-spotify)]"
            />
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Full Playback Controls */}
          <div className="flex items-center justify-between px-4 mb-8">
            <button
              onClick={toggleShuffle}
              className={`p-3 rounded-full transition-all ${
                isShuffle
                  ? 'text-[var(--primary-spotify)] bg-[var(--primary-spotify)]/20 border border-[var(--primary-spotify)]/40 shadow-lg'
                  : 'text-slate-400 hover:text-white bg-white/5'
              }`}
              title={isShuffle ? 'Tắt phát ngẫu nhiên' : 'Bật phát ngẫu nhiên'}
            >
              <Shuffle className="w-6 h-6" />
            </button>

            <button
              onClick={prevTrack}
              className="p-3 text-slate-300 hover:text-white active:scale-95 transition-transform"
            >
              <SkipBack className="w-8 h-8" />
            </button>

            <button
              onClick={togglePlay}
              className="w-16 h-16 rounded-full bg-[var(--primary-spotify)] text-black flex items-center justify-center shadow-xl shadow-[var(--theme-glow-shadow)] active:scale-95 transition-transform"
            >
              {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
            </button>

            <button
              onClick={nextTrack}
              className="p-3 text-slate-300 hover:text-white active:scale-95 transition-transform"
            >
              <SkipForward className="w-8 h-8" />
            </button>

            <button
              onClick={toggleRepeat}
              className={`p-3 rounded-full transition-all ${
                repeatMode !== 'off'
                  ? 'text-cyan-400 bg-cyan-500/20 border border-cyan-500/40 shadow-lg'
                  : 'text-slate-400 hover:text-white bg-white/5'
              }`}
              title={
                repeatMode === 'one'
                  ? 'Lặp lại 1 bài'
                  : repeatMode === 'all'
                  ? 'Lặp lại danh sách'
                  : 'Tắt lặp lại'
              }
            >
              {repeatMode === 'one' ? <Repeat1 className="w-6 h-6" /> : <Repeat className="w-6 h-6" />}
            </button>
          </div>

          {/* Volume Control Bar */}
          <div className="flex items-center gap-3 px-4 py-3 bg-white/5 rounded-2xl border border-white/10 mb-4">
            <button onClick={handleVolumeToggle} className="text-slate-400 hover:text-white">
              {volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[var(--primary-spotify)]"
            />
          </div>
        </div>
      )}

      {/* 💻 DESKTOP PLAYER BAR (Visible on >= 768px screens) */}
      <footer className="hidden md:flex h-20 bg-[#07080d]/90 backdrop-blur-2xl border-t border-white/10 px-6 items-center justify-between text-slate-300 select-none z-30 shadow-2xl">
        {/* Left: Track Metadata */}
        <div className="flex items-center gap-3.5 w-1/4 min-w-[200px]">
          <div className="relative group shrink-0">
            <div className="w-12 h-12 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl overflow-hidden relative flex items-center justify-center border border-white/10 shadow-md">
              {currentTrack.cover_url ? (
                <img
                  src={currentTrack.cover_url}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Headphones className={`w-6 h-6 text-cyan-400 ${isPlaying ? 'animate-pulse' : ''}`} />
              )}
            </div>
          </div>

          <div className="truncate flex flex-col flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-white truncate hover:underline cursor-pointer">
                {currentTrack.title}
              </p>
              {isPlaying && (
                <div className="flex items-end gap-0.5 h-3 shrink-0">
                  <span className="w-0.5 bg-[var(--primary-spotify)] rounded-full eq-bar-1" />
                  <span className="w-0.5 bg-[var(--primary-spotify)] rounded-full eq-bar-2" />
                  <span className="w-0.5 bg-[var(--primary-spotify)] rounded-full eq-bar-3" />
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 truncate hover:underline cursor-pointer">
              {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
            </p>
          </div>
        </div>

        {/* Center: Playback Controls & Seekbar */}
        <div className="flex flex-col items-center gap-1.5 w-2/4 max-w-xl">
          <div className="flex items-center gap-5">
            <button
              onClick={prevTrack}
              className="text-slate-400 hover:text-white transition-colors"
              title="Bài trước"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-[var(--primary-spotify)] hover:scale-105 active:scale-95 transition-all flex items-center justify-center text-black shadow-lg shadow-[var(--theme-glow-shadow)]"
              title={isPlaying ? 'Tạm dừng' : 'Phát'}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>

            <button
              onClick={nextTrack}
              className="text-slate-400 hover:text-white transition-colors"
              title="Bài kế tiếp"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <button
              onClick={toggleShuffle}
              className={`p-1.5 rounded-lg transition-colors ${
                isShuffle
                  ? 'text-[var(--primary-spotify)] bg-[var(--primary-spotify)]/15 border border-[var(--primary-spotify)]/30'
                  : 'text-slate-400 hover:text-white'
              }`}
              title={isShuffle ? 'Tắt phát ngẫu nhiên' : 'Bật phát ngẫu nhiên'}
            >
              <Shuffle className="w-4 h-4" />
            </button>

            <button
              onClick={toggleRepeat}
              className={`p-1.5 rounded-lg transition-colors ${
                repeatMode !== 'off'
                  ? 'text-cyan-400 bg-cyan-500/15 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-white'
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
            </button>
          </div>

          <div className="w-full flex items-center gap-2.5 text-[11px] text-slate-400 font-mono">
            <span className="w-9 text-right">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
              className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[var(--primary-spotify)]"
            />
            <span className="w-9">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Right: Volume & Extra Controls */}
        <div className="w-1/4 flex justify-end items-center gap-3">
          <button
            onClick={toggleFavoriteCurrentTrack}
            className={`p-2 rounded-xl transition-all ${
              currentTrack.is_favorite
                ? 'text-rose-500 bg-rose-500/15 border border-rose-500/30'
                : 'text-slate-400 hover:text-rose-400 hover:bg-white/5'
            }`}
            title={currentTrack.is_favorite ? 'Bỏ khỏi bài hát yêu thích' : 'Thêm vào bài hát yêu thích'}
          >
            <Heart
              className={`w-4 h-4 transition-all ${
                currentTrack.is_favorite ? 'fill-current drop-shadow-[0_0_8px_rgba(244,63,94,0.6)]' : ''
              }`}
            />
          </button>

          <button
            onClick={() => setShowLyricsModal(!showLyricsModal)}
            className={`p-2 rounded-xl transition-all ${
              showLyricsModal
                ? 'bg-[var(--primary-spotify)] text-black shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
            title="Lời bài hát (Lyrics)"
          >
            <Mic2 className="w-4 h-4" />
          </button>

          <div className="h-4 w-[1px] bg-white/10" />

          <button
            onClick={handleVolumeToggle}
            className="text-slate-400 hover:text-white transition-colors"
            title={volume === 0 ? 'Mở tiếng' : 'Tắt tiếng'}
          >
            {volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-24 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[var(--primary-spotify)]"
          />
        </div>
      </footer>

      {/* 🎤 FULLSCREEN / MODAL LYRICS OVERLAY FOR MOBILE (ANDROID/IOS) & DESKTOP */}
      {showLyricsModal && (
        <div className="fixed inset-0 z-50 bg-[#07080c] flex flex-col animate-in fade-in duration-200">
          <LyricsView onClose={() => setShowLyricsModal(false)} isModal={true} />
        </div>
      )}
    </>
  )
}
