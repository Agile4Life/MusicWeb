'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Track, Playlist } from '@/types'
import { TrackList } from '@/components/track/TrackList'
import { usePlayer } from '@/components/player/PlayerContext'
import { Play, Upload, Search, Music, Sparkles } from 'lucide-react'

export default function HomePage() {
  const supabase = createClient()
  const { playTrack } = usePlayer()

  const [tracks, setTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)

  const fetchData = async () => {
    setLoading(true)
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser()

    setUser(currentUser)

    if (currentUser) {
      // Fetch tracks
      const { data: trackData } = await supabase
        .from('tracks')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })

      if (trackData) setTracks(trackData)

      // Fetch user playlists
      const { data: playlistData } = await supabase
        .from('playlists')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })

      if (playlistData) setPlaylists(playlistData)
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleAddToPlaylist = async (playlistId: string, trackId: string) => {
    const { error } = await supabase.from('playlist_tracks').insert({
      playlist_id: playlistId,
      track_id: trackId,
    })

    if (!error) {
      alert('Đã thêm bài hát vào playlist!')
    } else {
      alert(error.message || 'Lỗi thêm bài hát vào playlist')
    }
  }

  const handleDeleteTrack = async (trackId: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa bài hát này khỏi thư viện?')) return

    const trackToDelete = tracks.find((t) => t.id === trackId)
    if (!trackToDelete) return

    // Delete DB record
    const { error: dbError } = await supabase.from('tracks').delete().eq('id', trackId)

    if (dbError) {
      alert('Lỗi xóa record DB: ' + dbError.message)
      return
    }

    // Delete file from Storage if exists
    if (trackToDelete.file_path) {
      await supabase.storage.from('music-files').remove([trackToDelete.file_path])
    }

    setTracks(tracks.filter((t) => t.id !== trackId))
  }

  const filteredTracks = tracks.filter((t) => {
    const query = searchQuery.toLowerCase()
    return (
      t.title.toLowerCase().includes(query) ||
      (t.artist && t.artist.toLowerCase().includes(query)) ||
      (t.album && t.album.toLowerCase().includes(query))
    )
  })

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Top Banner Header */}
      <div className="bg-gradient-to-r from-emerald-900/60 to-[#181818] p-6 rounded-2xl border border-emerald-500/20 shadow-lg flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#1DB954]">
            <Sparkles className="w-4 h-4" />
            <span>Thư viện cá nhân</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white">
            {user ? `Xin chào, ${user.email.split('@')[0]}` : 'Nhạc Cá Nhân Của Bạn'}
          </h1>
          <p className="text-sm text-gray-300">
            Lưu trữ, phát nhạc high-quality không giới hạn mọi lúc mọi nơi.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {tracks.length > 0 && (
            <button
              onClick={() => playTrack(tracks[0], tracks)}
              className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-bold px-5 py-3 rounded-full flex items-center gap-2 shadow-xl hover:scale-105 transition-transform"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>Phát Tất Cả</span>
            </button>
          )}

          <Link
            href="/upload"
            className="bg-[#282828] hover:bg-[#383838] text-white font-semibold px-4 py-3 rounded-full flex items-center gap-2 transition-colors text-sm"
          >
            <Upload className="w-4 h-4" />
            <span>Upload Nhạc</span>
          </Link>
        </div>
      </div>

      {/* Search & Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Tìm theo tên bài hát, nghệ sĩ..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#181818] border border-[#282828] focus:border-[#1DB954] text-white text-sm rounded-full pl-9 pr-4 py-2 outline-none"
          />
        </div>
        <p className="text-xs text-gray-400 font-mono">Tổng số: {filteredTracks.length} bài</p>
      </div>

      {/* Track List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">Đang tải thư viện nhạc...</div>
      ) : (
        <TrackList
          tracks={filteredTracks}
          userPlaylists={playlists}
          onAddToPlaylist={handleAddToPlaylist}
          onDeleteTrack={handleDeleteTrack}
        />
      )}
    </div>
  )
}
