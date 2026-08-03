'use client'

import React from 'react'
import { Track, Playlist } from '@/types'
import { TrackRow } from './TrackRow'
import { Clock } from 'lucide-react'

interface TrackListProps {
  tracks: Track[]
  userPlaylists?: Playlist[]
  onAddToPlaylist?: (playlistId: string, trackId: string) => void
  onDeleteTrack?: (trackId: string) => void
  onDeleteTrackPermanently?: (trackId: string) => void
}

export function TrackList({
  tracks,
  userPlaylists = [],
  onAddToPlaylist,
  onDeleteTrack,
  onDeleteTrackPermanently,
}: TrackListProps) {
  if (tracks.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 bg-[#181818] rounded-lg">
        <p className="text-base font-semibold text-white mb-1">Chưa có bài hát nào</p>
        <p className="text-xs">Hãy upload bài hát đầu tiên của bạn vào thư viện!</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Table Header */}
      <div className="flex items-center justify-between px-4 py-2 text-xs font-semibold text-gray-400 border-b border-[#282828] mb-2">
        <div className="flex items-center gap-4 w-1/2">
          <span className="w-6 text-center">#</span>
          <span>TIÊU ĐỀ</span>
        </div>
        <div className="hidden md:block w-1/4">ALBUM</div>
        <div className="flex items-center justify-end w-1/4 pr-2">
          <Clock className="w-4 h-4" />
        </div>
      </div>

      {/* Track Rows */}
      {tracks.map((track, idx) => (
        <TrackRow
          key={track.id}
          track={track}
          index={idx}
          playlistTracks={tracks}
          userPlaylists={userPlaylists}
          onAddToPlaylist={onAddToPlaylist}
          onDeleteTrack={onDeleteTrack}
          onDeleteTrackPermanently={onDeleteTrackPermanently}
        />
      ))}
    </div>
  )
}
