'use client'

import React, { useState } from 'react'
import { Track, Playlist } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { Play, Pause, Music, Trash2, Plus, Clock, MoreVertical } from 'lucide-react'

interface TrackRowProps {
  track: Track
  index: number
  playlistTracks?: Track[]
  userPlaylists?: Playlist[]
  onAddToPlaylist?: (playlistId: string, trackId: string) => void
  onDeleteTrack?: (trackId: string) => void
}

function formatDuration(seconds: number) {
  if (!seconds || isNaN(seconds)) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`
}

export function TrackRow({
  track,
  index,
  playlistTracks = [],
  userPlaylists = [],
  onAddToPlaylist,
  onDeleteTrack,
}: TrackRowProps) {
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer()
  const [showMenu, setShowMenu] = useState(false)

  const isCurrent = currentTrack?.id === track.id

  const handlePlayClick = () => {
    if (isCurrent) {
      togglePlay()
    } else {
      playTrack(track, playlistTracks.length > 0 ? playlistTracks : [track])
    }
  }

  return (
    <div
      className={`group flex items-center justify-between px-4 py-2.5 rounded-md hover:bg-[#282828] transition-colors cursor-pointer select-none ${
        isCurrent ? 'bg-[#1e1e1e]' : ''
      }`}
      onMouseLeave={() => setShowMenu(false)}
    >
      {/* Index & Play button */}
      <div className="flex items-center gap-4 w-1/2 truncate">
        <div className="w-6 text-center text-sm font-medium text-gray-400 shrink-0">
          <span className="group-hover:hidden">
            {isCurrent && isPlaying ? (
              <span className="text-[#1DB954] animate-pulse">▶</span>
            ) : (
              <span className={isCurrent ? 'text-[#1DB954] font-bold' : ''}>{index + 1}</span>
            )}
          </span>
          <button
            onClick={handlePlayClick}
            className="hidden group-hover:inline-block text-white hover:scale-110 transition-transform"
          >
            {isCurrent && isPlaying ? (
              <Pause className="w-4 h-4 fill-current text-[#1DB954]" />
            ) : (
              <Play className="w-4 h-4 fill-current text-white" />
            )}
          </button>
        </div>

        {/* Cover thumbnail & Title/Artist */}
        <div className="w-10 h-10 bg-[#181818] rounded overflow-hidden shrink-0 flex items-center justify-center">
          {track.cover_url ? (
            <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
          ) : (
            <Music className="w-5 h-5 text-gray-500" />
          )}
        </div>

        <div className="truncate">
          <p
            className={`text-sm font-semibold truncate ${
              isCurrent ? 'text-[#1DB954]' : 'text-white'
            }`}
          >
            {track.title}
          </p>
          <p className="text-xs text-gray-400 truncate">{track.artist || 'Nghệ sĩ chưa xác định'}</p>
        </div>
      </div>

      {/* Album name */}
      <div className="hidden md:block w-1/4 truncate text-sm text-gray-400">
        {track.album || '—'}
      </div>

      {/* Duration & Options */}
      <div className="flex items-center justify-end gap-3 w-1/4 text-sm text-gray-400">
        <span className="font-mono text-xs">{formatDuration(track.duration)}</span>

        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="p-1 hover:text-white rounded transition-colors opacity-0 group-hover:opacity-100"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-8 bg-[#282828] border border-[#3e3e3e] shadow-xl rounded-md py-1 w-48 z-20 text-xs text-gray-200">
              {userPlaylists.length > 0 && onAddToPlaylist && (
                <div className="px-2 py-1 text-gray-400 font-semibold border-b border-[#383838]">
                  Thêm vào Playlist
                </div>
              )}
              {userPlaylists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    onAddToPlaylist?.(pl.id, track.id)
                    setShowMenu(false)
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#3e3e3e] truncate transition-colors"
                >
                  + {pl.name}
                </button>
              ))}

              {onDeleteTrack && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteTrack(track.id)
                    setShowMenu(false)
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-red-500/20 text-red-400 flex items-center gap-2 border-t border-[#383838] transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Xóa bài hát
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
