'use client'

import React, { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Playlist, Track } from '@/types'
import { TrackList } from '@/components/track/TrackList'
import { usePlayer } from '@/components/player/PlayerContext'
import { Play, Music, Trash2, Edit2, Check, X, Disc, ListMusic } from 'lucide-react'

export default function PlaylistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: playlistId } = use(params)
  const router = useRouter()
  const supabase = createClient()
  const { playTrack } = usePlayer()

  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const fetchPlaylistData = async () => {
    setLoading(true)
    const { data: plData, error: plError } = await supabase
      .from('playlists')
      .select('*')
      .eq('id', playlistId)
      .single()

    if (plError || !plData) {
      setLoading(false)
      return
    }

    setPlaylist(plData)
    setEditName(plData.name)
    setEditDesc(plData.description || '')

    const { data: ptData } = await supabase
      .from('playlist_tracks')
      .select('position, tracks(*)')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: true })

    if (ptData) {
      const fetchedTracks = ptData
        .map((item: any) => item.tracks)
        .filter(Boolean) as Track[]
      setTracks(fetchedTracks)
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchPlaylistData()
  }, [playlistId])

  const handleUpdatePlaylist = async () => {
    if (!playlist) return
    const { error } = await supabase
      .from('playlists')
      .update({
        name: editName,
        description: editDesc,
      })
      .eq('id', playlist.id)

    if (!error) {
      setPlaylist({ ...playlist, name: editName, description: editDesc })
      setIsEditing(false)
      router.refresh()
    } else {
      alert('Lỗi cập nhật: ' + error.message)
    }
  }

  const handleDeletePlaylist = async () => {
    if (!playlist || !confirm('Bạn có chắc chắn muốn xóa playlist này?')) return

    const { error } = await supabase.from('playlists').delete().eq('id', playlist.id)

    if (!error) {
      router.push('/')
      router.refresh()
    } else {
      alert('Lỗi xóa playlist: ' + error.message)
    }
  }

  const handleRemoveTrackFromPlaylist = async (trackId: string) => {
    const { error } = await supabase
      .from('playlist_tracks')
      .delete()
      .eq('playlist_id', playlistId)
      .eq('track_id', trackId)

    if (!error) {
      setTracks(tracks.filter((t) => t.id !== trackId))
    } else {
      alert('Lỗi xóa bài khỏi playlist: ' + error.message)
    }
  }

  if (loading) {
    return <div className="p-8 text-slate-400 font-medium">Đang tải thông tin playlist...</div>
  }

  if (!playlist) {
    return (
      <div className="p-8 text-center py-16 text-slate-400">
        <p className="text-lg font-bold text-white">Không tìm thấy Playlist</p>
        <p className="text-xs mt-1">Playlist này không tồn tại hoặc bạn không có quyền truy cập.</p>
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto w-full">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 p-6 md:p-8 bg-gradient-to-r from-slate-900/90 via-[#0e141a] to-[#090b10] shadow-2xl flex flex-col md:flex-row items-start md:items-end gap-6">
        <div className="w-40 h-40 bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl shadow-2xl flex items-center justify-center shrink-0 border border-white/10">
          {playlist.cover_url ? (
            <img src={playlist.cover_url} alt={playlist.name} className="w-full h-full object-cover rounded-2xl" />
          ) : (
            <ListMusic className="w-16 h-16 text-emerald-400/80" />
          )}
        </div>

        <div className="flex-1 flex flex-col gap-3">
          <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            <span>PLAYLIST CÁ NHÂN</span>
          </div>

          {isEditing ? (
            <div className="flex flex-col gap-2 max-w-md">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="glass-input text-white font-extrabold text-xl px-3 py-1.5 rounded-xl outline-none"
              />
              <input
                type="text"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Mô tả playlist"
                className="glass-input text-slate-300 text-xs px-3 py-1.5 rounded-xl outline-none"
              />
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={handleUpdatePlaylist}
                  className="bg-[#1DB954] text-black px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 hover:bg-emerald-400"
                >
                  <Check className="w-3.5 h-3.5" /> Lưu
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="bg-white/10 text-white px-3.5 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1 hover:bg-white/20"
                >
                  <X className="w-3.5 h-3.5" /> Hủy
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-extrabold text-white">{playlist.name}</h1>
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                  title="Chỉnh sửa playlist"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1">{playlist.description || 'Chưa có mô tả'}</p>
            </div>
          )}

          <p className="text-xs text-slate-400 font-mono mt-1">
            {tracks.length} bài hát
          </p>
        </div>
      </div>

      {/* Toolbar Controls */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <div className="flex items-center gap-4">
          {tracks.length > 0 && (
            <button
              onClick={() => playTrack(tracks[0], tracks)}
              className="bg-[#1DB954] hover:bg-[#1ed760] text-black font-extrabold px-6 py-3.5 rounded-full flex items-center gap-2 shadow-xl shadow-emerald-500/20 hover:scale-105 transition-all text-sm"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>Phát Playlist</span>
            </button>
          )}
        </div>

        <button
          onClick={handleDeletePlaylist}
          className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors px-3 py-2 rounded-xl flex items-center gap-1.5 text-xs font-bold"
          title="Xóa playlist"
        >
          <Trash2 className="w-4 h-4" />
          <span>Xóa Playlist</span>
        </button>
      </div>

      {/* Playlist Track List */}
      <TrackList tracks={tracks} onDeleteTrack={handleRemoveTrackFromPlaylist} />
    </div>
  )
}
