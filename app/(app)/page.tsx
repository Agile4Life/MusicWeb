'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Track, Playlist } from '@/types'
import { TrackList } from '@/components/track/TrackList'
import { usePlayer } from '@/components/player/PlayerContext'
import { Play, Upload, Search, Sparkles, Disc, Music, Flame } from 'lucide-react'

export default function HomePage() {
  const supabase = createClient()
  const { playTrack, currentTrack, isPlaying } = usePlayer()

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

    const { error: dbError } = await supabase.from('tracks').delete().eq('id', trackId)

    if (dbError) {
      alert('Lỗi xóa record DB: ' + dbError.message)
      return
    }

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
    <div className="p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto w-full">
      {/* High-Impact Hero Card */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 p-8 md:p-10 bg-gradient-to-r from-emerald-950/80 via-[#0e141a] to-[#090b10] shadow-2xl">
        {/* Glow Effects */}
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-[#1DB954]/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex flex-col gap-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold uppercase tracking-widest w-max shadow-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Thư viện âm nhạc cá nhân</span>
            </div>

            <h1 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight">
              {user ? (
                <>
                  Xin chào, <span className="neon-gradient-text">{user.email.split('@')[0]}</span> 👋
                </>
              ) : (
                <>
                  Trình Nghe Nhạc <span className="neon-gradient-text">Độc Bản</span>
                </>
              )}
            </h1>

            <p className="text-sm md:text-base text-slate-300 font-light leading-relaxed">
              Không gian âm nhạc cá nhân hoàn hảo — Upload file MP3/WAV của chính bạn, tạo playlist riêng và tận hưởng âm thanh chất lượng cao.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {tracks.length > 0 && (
              <button
                onClick={() => playTrack(tracks[0], tracks)}
                className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-extrabold px-6 py-3.5 rounded-full flex items-center gap-2 shadow-xl shadow-emerald-500/25 hover:scale-105 transition-all text-sm"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>Phát Ngay</span>
              </button>
            )}

            <Link
              href="/upload"
              className="glass-card hover:border-emerald-500/40 text-white font-bold px-5 py-3.5 rounded-full flex items-center gap-2 text-sm transition-all shadow-lg"
            >
              <Upload className="w-4 h-4 text-emerald-400" />
              <span>Upload Nhạc</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Quick Play Card Showcase */}
      {tracks.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Flame className="w-5 h-5 text-amber-400" />
              Gần Đây & Nổi Bật
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {tracks.slice(0, 6).map((t) => (
              <div
                key={t.id}
                onClick={() => playTrack(t, tracks)}
                className="glass-card p-3 rounded-2xl flex flex-col gap-3 group cursor-pointer border border-white/5 relative"
              >
                <div className="aspect-square bg-slate-800 rounded-xl overflow-hidden relative shadow-md">
                  {t.cover_url ? (
                    <img src={t.cover_url} alt={t.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-slate-500">
                      <Music className="w-8 h-8 group-hover:text-emerald-400 transition-colors" />
                    </div>
                  )}
                  {/* Floating Quick Play Button */}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[2px]">
                    <div className="w-10 h-10 rounded-full bg-[#1DB954] flex items-center justify-center text-black shadow-lg hover:scale-110 transition-transform">
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                    </div>
                  </div>
                </div>

                <div className="truncate">
                  <p className="text-xs font-bold text-white truncate group-hover:text-[#1DB954] transition-colors">
                    {t.title}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {t.artist || 'Nghệ sĩ chưa xác định'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Tracks Table Section */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Disc className="w-5 h-5 text-emerald-400" />
            Tất Cả Bài Hát ({filteredTracks.length})
          </h2>

          <div className="relative max-w-md w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Tìm theo tên bài hát, nghệ sĩ, album..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full glass-input text-white text-xs rounded-full pl-10 pr-4 py-2.5 outline-none font-medium placeholder:text-slate-500"
            />
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16 text-slate-400 font-medium">Đang tải thư viện nhạc...</div>
        ) : (
          <TrackList
            tracks={filteredTracks}
            userPlaylists={playlists}
            onAddToPlaylist={handleAddToPlaylist}
            onDeleteTrack={handleDeleteTrack}
          />
        )}
      </div>
    </div>
  )
}
