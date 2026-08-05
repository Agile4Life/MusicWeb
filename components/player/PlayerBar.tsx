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
  Disc,
  ChevronDown,
  Maximize2,
  SlidersHorizontal,
  Mic2,
  X,
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
      <div className="md:hidden fixed bottom-14 left-2 right-2 z-40 bg-[#121520]/95 backdrop-blur-2xl border border-white/15 rounded-2xl p-2 shadow-2xl shadow-black/80 select-none">
        <div className="flex items-center justify-between gap-3">
          {/* Tap to expand full mobile player */}
          <div
            onClick={() => setShowMobileFullPlayer(true)}
            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer active:opacity-80"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-800 border border-white/10 flex items-center justify-center overflow-hidden shrink-0 relative">
              {currentTrack.cover_url ? (
                <img
                  src={currentTrack.cover_url}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Disc className={`w-5 h-5 text-[var(--primary-spotify)] ${isPlaying ? 'animate-spin-slow' : ''}`} />
              )}
            </div>

            <div className="flex flex-col truncate flex-1">
              <span className="text-xs font-bold text-white truncate">{currentTrack.title}</span>
              <span className="text-[10px] text-slate-400 truncate">
                {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
              </span>
            </div>
          </div>

          {/* Quick Touch Controls */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={togglePlay}
              className="w-9 h-9 rounded-full bg-[var(--primary-spotify)] text-black flex items-center justify-center shadow-md active:scale-95"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>

            <button
              onClick={nextTrack}
              className="p-2 text-slate-300 hover:text-white active:scale-95"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mini progress bar on top edge of mini player */}
        <div className="w-full h-0.5 bg-white/10 rounded-full mt-1.5 overflow-hidden">
          <div
            className="h-full bg-[var(--primary-spotify)] transition-all duration-300"
            style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
          />
        </div>
      </div>

      {/* 📱 FULLSCREEN MOBILE PLAYER OVERLAY MODAL */}
      {showMobileFullPlayer && (
        <div className="md:hidden fixed inset-0 z-50 bg-[#07080c]/98 backdrop-blur-2xl flex flex-col p-6 animate-in slide-in-from-bottom duration-300 select-none">
          {/* Header handle */}
          <div className="flex items-center justify-between pb-4">
            <button
              onClick={() => setShowMobileFullPlayer(false)}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-slate-300 hover:text-white"
            >
              <ChevronDown className="w-6 h-6" />
            </button>

            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
              Đang phát từ MusicWeb
            </span>

            <button
              onClick={() => {
                setShowMobileFullPlayer(false)
                setShowLyricsModal(true)
              }}
              className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-slate-300 hover:text-[var(--primary-spotify)]"
              title="Xem lời bài hát"
            >
              <Mic2 className="w-5 h-5" />
            </button>
          </div>

          {/* Large Album Artwork */}
          <div className="flex-1 flex items-center justify-center my-6">
            <div className="w-64 h-64 sm:w-72 sm:h-72 rounded-3xl bg-gradient-to-br from-slate-800 to-slate-900 border border-white/10 shadow-2xl flex items-center justify-center overflow-hidden relative p-1">
              {currentTrack.cover_url ? (
                <img
                  src={currentTrack.cover_url}
                  alt={currentTrack.title}
                  className="w-full h-full object-cover rounded-2xl"
                />
              ) : (
                <div className="w-full h-full bg-[#0d0e15] rounded-2xl flex items-center justify-center text-[var(--primary-spotify)]">
                  <Disc className={`w-28 h-28 ${isPlaying ? 'animate-spin-slow' : ''}`} />
                </div>
              )}
            </div>
          </div>

          {/* Track Info Header */}
          <div className="flex flex-col items-start gap-1 mb-6">
            <h2 className="text-xl font-extrabold text-white truncate w-full">{currentTrack.title}</h2>
            <p className="text-sm font-medium text-slate-400 truncate w-full">
              {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
            </p>
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
          <div className="flex items-center justify-evenly mb-8">
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
                <Disc className={`w-6 h-6 text-[var(--primary-spotify)] ${isPlaying ? 'animate-spin-slow' : ''}`} />
              )}
            </div>
          </div>

          <div className="truncate flex flex-col">
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
            {playbackError && (
              <p className="text-[10px] text-red-400 truncate max-w-[260px]" title={playbackError}>
                {playbackError}
              </p>
            )}
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

      {/* 🎤 FULLSCREEN / MODAL LYRICS OVERLAY */}
      {showLyricsModal && (
        <div className="fixed inset-0 z-50 bg-[#07080c]/98 backdrop-blur-2xl flex flex-col p-4 md:p-8 animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-2 border-b border-white/10 z-20">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <Mic2 className="w-4 h-4 text-[var(--primary-spotify)]" />
              <span>Lời bài hát Studio</span>
            </span>

            <button
              onClick={() => setShowLyricsModal(false)}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors"
              title="Đóng lời bài hát"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 relative mt-2">
            <LyricsView onClose={() => setShowLyricsModal(false)} isModal={true} />
          </div>
        </div>
      )}
    </>
  )
}
