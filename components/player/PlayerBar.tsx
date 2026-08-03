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
  Maximize2,
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
      <footer className="h-20 bg-black border-t border-[#282828] px-4 flex items-center justify-between text-gray-400 select-none">
        <div className="flex items-center gap-3 w-1/4">
          <div className="w-14 h-14 bg-[#181818] rounded flex items-center justify-center text-gray-500">
            <Music className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-300">Chưa chọn bài hát nào</p>
            <p className="text-xs text-gray-500">Chọn một bài hát từ thư viện để phát</p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1 w-2/4 max-w-xl">
          <div className="flex items-center gap-4 text-gray-600">
            <SkipBack className="w-5 h-5 cursor-not-allowed" />
            <button className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center text-gray-500 cursor-not-allowed">
              <Play className="w-4 h-4 fill-current ml-0.5" />
            </button>
            <SkipForward className="w-5 h-5 cursor-not-allowed" />
          </div>
          <div className="w-full flex items-center gap-2 text-xs text-gray-600">
            <span>0:00</span>
            <div className="flex-1 h-1 bg-[#282828] rounded-full" />
            <span>0:00</span>
          </div>
        </div>

        <div className="w-1/4 flex justify-end items-center gap-2 text-gray-600">
          <Volume2 className="w-5 h-5 cursor-not-allowed" />
          <div className="w-24 h-1 bg-[#282828] rounded-full" />
        </div>
      </footer>
    )
  }

  return (
    <footer className="h-20 bg-black border-t border-[#181818] px-4 flex items-center justify-between text-gray-300 select-none z-50">
      {/* Left: Track Metadata */}
      <div className="flex items-center gap-3 w-1/4 min-w-[180px]">
        <div className="w-14 h-14 bg-[#282828] rounded overflow-hidden relative shrink-0 flex items-center justify-center">
          {currentTrack.cover_url ? (
            <img
              src={currentTrack.cover_url}
              alt={currentTrack.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <Music className="w-6 h-6 text-gray-400" />
          )}
        </div>
        <div className="truncate">
          <p className="text-sm font-semibold text-white truncate hover:underline cursor-pointer">
            {currentTrack.title}
          </p>
          <p className="text-xs text-gray-400 truncate hover:underline cursor-pointer">
            {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
          </p>
        </div>
      </div>

      {/* Center: Controls & Seekbar */}
      <div className="flex flex-col items-center gap-1.5 w-2/4 max-w-xl">
        <div className="flex items-center gap-5">
          <button
            onClick={prevTrack}
            className="text-gray-400 hover:text-white transition-colors"
            title="Bài trước"
          >
            <SkipBack className="w-5 h-5" />
          </button>

          <button
            onClick={togglePlay}
            className="w-9 h-9 rounded-full bg-white hover:scale-105 transition-transform flex items-center justify-center text-black"
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
            className="text-gray-400 hover:text-white transition-colors"
            title="Bài kế tiếp"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>

        <div className="w-full flex items-center gap-2 text-xs text-gray-400">
          <span className="w-9 text-right font-mono">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value))}
            className="flex-1 h-1 bg-[#4d4d4d] rounded-lg appearance-none cursor-pointer accent-[#1DB954]"
          />
          <span className="w-9 font-mono">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Right: Volume */}
      <div className="w-1/4 flex justify-end items-center gap-2">
        <button
          onClick={handleVolumeToggle}
          className="text-gray-400 hover:text-white transition-colors"
          title={volume === 0 ? 'Mở tiếng' : 'Tắt tiếng'}
        >
          {volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="w-24 h-1 bg-[#4d4d4d] rounded-lg appearance-none cursor-pointer accent-[#1DB954]"
        />
      </div>
    </footer>
  )
}
