'use client'

import React, { useState } from 'react'
import { usePlayer } from './PlayerContext'
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Music,
  Disc,
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
    togglePlay,
    seek,
    setVolume,
    nextTrack,
    prevTrack,
  } = usePlayer()

  const [prevVol, setPrevVol] = useState(0.8)

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
      <footer className="h-20 bg-[#07080d]/90 backdrop-blur-2xl border-t border-white/5 px-6 flex items-center justify-between text-slate-400 select-none z-50">
        <div className="flex items-center gap-3 w-1/4">
          <div className="w-12 h-12 bg-white/5 rounded-xl flex items-center justify-center text-slate-600 border border-white/5">
            <Music className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-300">Chưa chọn bài hát nào</p>
            <p className="text-[10px] text-slate-500">Chọn một bài hát từ thư viện để phát</p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 w-2/4 max-w-xl">
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

        <div className="w-1/4 flex justify-end items-center gap-2 text-slate-600">
          <Volume2 className="w-4 h-4 cursor-not-allowed" />
          <div className="w-20 h-1 bg-white/5 rounded-full" />
        </div>
      </footer>
    )
  }

  return (
    <footer className="h-20 bg-[#07080d]/90 backdrop-blur-2xl border-t border-white/10 px-6 flex items-center justify-between text-slate-300 select-none z-50 shadow-2xl">
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
              <Disc className={`w-6 h-6 text-[#1DB954] ${isPlaying ? 'animate-spin-slow' : ''}`} />
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
                <span className="w-0.5 bg-[#1DB954] rounded-full eq-bar-1" />
                <span className="w-0.5 bg-[#1DB954] rounded-full eq-bar-2" />
                <span className="w-0.5 bg-[#1DB954] rounded-full eq-bar-3" />
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
            className="w-10 h-10 rounded-full bg-[#1DB954] hover:bg-[#1ed760] hover:scale-105 active:scale-95 transition-all flex items-center justify-center text-black shadow-lg shadow-emerald-500/30"
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
            className="flex-1 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#1DB954]"
          />
          <span className="w-9">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right: Volume Controls */}
      <div className="w-1/4 flex justify-end items-center gap-3">
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
          className="w-24 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#1DB954]"
        />
      </div>
    </footer>
  )
}
