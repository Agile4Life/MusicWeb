'use client'

import React, { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Playlist, Track } from '@/types'
import { TrackList } from '@/components/track/TrackList'
import { usePlayer } from '@/components/player/PlayerContext'
import {
  Play,
  Music,
  Trash2,
  Edit2,
  Check,
  X,
  ListMusic,
  Upload,
  Plus,
  Search,
  Loader2,
  AlertCircle,
  Sparkles,
} from 'lucide-react'
import * as mm from 'music-metadata-browser'

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

  // Modals state
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showLibraryModal, setShowLibraryModal] = useState(false)

  // Direct Upload State
  const [file, setFile] = useState<File | null>(null)
  const [isModalDragging, setIsModalDragging] = useState(false)
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadArtist, setUploadArtist] = useState('')
  const [uploadDuration, setUploadDuration] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Library Tracks Picker State
  const [libraryTracks, setLibraryTracks] = useState<Track[]>([])
  const [librarySearch, setLibrarySearch] = useState('')
  const [loadingLibrary, setLoadingLibrary] = useState(false)

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
      .select('position, tracks:track_id(*, artists(name), albums(title))')
      .eq('playlist_id', playlistId)
      .order('position', { ascending: true })

    if (ptData) {
      const fetchedTracks = ptData
        .map((item: any) => {
          if (!item.tracks) return null
          return {
            ...item.tracks,
            artist: item.tracks.artist_name || item.tracks.artists?.name || item.tracks.artist || null,
            album: item.tracks.album_title || item.tracks.albums?.title || item.tracks.album || null,
          }
        })
        .filter(Boolean) as Track[]
      setTracks(fetchedTracks)
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchPlaylistData()

    // Subscribe to realtime changes for this playlist and its tracks
    const channel = supabase
      .channel(`playlist-detail-${playlistId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'playlist_tracks', filter: `playlist_id=eq.${playlistId}` },
        () => {
          fetchPlaylistData()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'playlists', filter: `id=eq.${playlistId}` },
        () => {
          fetchPlaylistData()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
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

  // Handle File select for direct upload inside playlist
  const handleFileChange = async (selectedFile: File) => {
    if (!selectedFile) return
    setUploadError(null)

    if (selectedFile.size > 150 * 1024 * 1024) {
      setUploadError('Dung lượng file tối đa là 150MB')
      return
    }

    setFile(selectedFile)
    setUploadTitle(selectedFile.name.replace(/\.[^/.]+$/, ''))

    try {
      const metadata = await mm.parseBlob(selectedFile)
      if (metadata.common.title) setUploadTitle(metadata.common.title)
      if (metadata.common.artist) setUploadArtist(metadata.common.artist)
      if (metadata.format.duration) setUploadDuration(Math.round(metadata.format.duration))
    } catch (err) {
      console.warn('Metadata parsing warning:', err)
    }
  }

  // Handle direct upload & add to playlist
  const handleDirectUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return

    setUploading(true)
    setUploadError(null)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) throw new Error('Bạn cần đăng nhập để tải nhạc')

      const fileExt = file.name.split('.').pop()
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
      const filePath = `${user.id}/${fileName}`

      // 1. Upload audio to storage (Try Signed Upload URL first for large files > 50MB)
      let uploadErr: any = null
      const { data: signedData, error: signedTokenErr } = await supabase.storage
        .from('music-files')
        .createSignedUploadUrl(filePath)

      if (!signedTokenErr && signedData?.token) {
        const { error: signedUploadErr } = await supabase.storage
          .from('music-files')
          .uploadToSignedUrl(filePath, signedData.token, file)
        uploadErr = signedUploadErr
      } else {
        const { error: directErr } = await supabase.storage
          .from('music-files')
          .upload(filePath, file, { upsert: true })
        uploadErr = directErr
      }

      if (uploadErr) throw new Error('Upload storage thất bại: ' + uploadErr.message)

      // 2. Get/create artist ID if provided
      let artistId: string | null = null
      if (uploadArtist && uploadArtist.trim()) {
        try {
          const { data: artistData } = await supabase.rpc('fn_get_or_create_artist', {
            p_name: uploadArtist.trim(),
          })
          if (artistData) artistId = artistData
        } catch {}
      }

      // 3. Insert into tracks DB table
      const { data: newTrack, error: dbError } = await supabase
        .from('tracks')
        .insert({
          user_id: user.id,
          title: uploadTitle || file.name,
          artist_id: artistId,
          duration: uploadDuration || 0,
          file_path: filePath,
          file_size: file.size,
        })
        .select()
        .single()

      if (dbError || !newTrack) throw new Error('Lỗi lưu thông tin DB: ' + (dbError?.message || ''))

      // 4. Add newly created track to playlist
      await supabase.rpc('fn_add_track_to_playlist', {
        p_playlist_id: playlistId,
        p_track_id: newTrack.id,
      })

      // Reset states & close modal
      setShowUploadModal(false)
      setFile(null)
      setUploadTitle('')
      setUploadArtist('')
      fetchPlaylistData()
    } catch (err: any) {
      let msg = err.message || 'Đã xảy ra lỗi khi tải nhạc'
      if (msg.includes('exceeded the maximum allowed size') || msg.includes('413')) {
        msg = 'Lỗi Supabase Storage: File vượt quá giới hạn "Max file size" trong Supabase Dashboard UI. Vui lòng vào Supabase Dashboard -> Storage -> Buckets -> music-files -> chọn Configuration / Settings -> Đổi "Max file size" thành 150MB rồi bấm Save.'
      }
      setUploadError(msg)
    } finally {
      setUploading(false)
    }
  }

  // Open Library Picker modal
  const openLibraryModal = async () => {
    setShowLibraryModal(true)
    setLoadingLibrary(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      const { data } = await supabase
        .from('view_track_details')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (data) {
        const normalized = data.map((t: any) => ({
          ...t,
          artist: t.artist_name || t.artist || null,
        }))
        setLibraryTracks(normalized)
      }
    }
    setLoadingLibrary(false)
  }

  // Add track from library to playlist
  const handleAddTrackToThisPlaylist = async (trackId: string) => {
    const { error } = await supabase.rpc('fn_add_track_to_playlist', {
      p_playlist_id: playlistId,
      p_track_id: trackId,
    })

    if (!error) {
      fetchPlaylistData()
    } else {
      alert('Lỗi thêm bài hát: ' + error.message)
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
            <ListMusic className="w-16 h-16 text-[var(--primary-spotify)]/80" />
          )}
        </div>

        <div className="flex-1 flex flex-col gap-3">
          <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-[var(--primary-spotify)]">
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
                  className="bg-[var(--primary-spotify)] text-black px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1 hover:scale-105 transition-transform"
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
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          {tracks.length > 0 && (
            <button
              onClick={() => playTrack(tracks[0], tracks)}
              className="bg-[var(--primary-spotify)] text-black font-extrabold px-6 py-3 rounded-full flex items-center gap-2 shadow-xl shadow-[var(--theme-glow-shadow)] hover:scale-105 transition-all text-xs"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Phát Playlist</span>
            </button>
          )}

          <button
            onClick={() => setShowUploadModal(true)}
            className="bg-white/10 hover:bg-white/20 text-white font-bold px-4 py-3 rounded-full flex items-center gap-2 text-xs transition-all border border-white/10"
          >
            <Upload className="w-4 h-4 text-[var(--primary-spotify)]" />
            <span>Upload nhạc vào Playlist này</span>
          </button>

          <button
            onClick={openLibraryModal}
            className="bg-white/10 hover:bg-white/20 text-white font-bold px-4 py-3 rounded-full flex items-center gap-2 text-xs transition-all border border-white/10"
          >
            <Plus className="w-4 h-4 text-[var(--primary-spotify)]" />
            <span>Thêm từ Thư viện</span>
          </button>
        </div>

        <button
          onClick={handleDeletePlaylist}
          className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors px-3 py-2 rounded-xl flex items-center gap-1.5 text-xs font-bold self-end sm:self-auto"
          title="Xóa playlist"
        >
          <Trash2 className="w-4 h-4" />
          <span>Xóa Playlist</span>
        </button>
      </div>

      {/* Playlist Track List or Empty State Actions */}
      {tracks.length > 0 ? (
        <TrackList tracks={tracks} onDeleteTrack={handleRemoveTrackFromPlaylist} />
      ) : (
        <div className="glass-panel p-10 rounded-3xl text-center border border-white/10 flex flex-col items-center gap-4 my-4">
          <div className="w-16 h-16 rounded-full bg-[var(--primary-spotify)]/10 flex items-center justify-center text-[var(--primary-spotify)] border border-[var(--primary-spotify)]/20 shadow-lg">
            <Music className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Playlist này chưa có bài hát nào</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Bạn có thể tải nhạc trực tiếp từ máy tính vào playlist này hoặc chọn bài hát đã có sẵn từ thư viện cá nhân.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
            <button
              onClick={() => setShowUploadModal(true)}
              className="bg-[var(--primary-spotify)] text-black font-extrabold px-5 py-3 rounded-full flex items-center gap-2 text-xs hover:scale-105 transition-all shadow-lg shadow-[var(--theme-glow-shadow)]"
            >
              <Upload className="w-4 h-4" />
              <span>Tải Nhạc Mới Vào Playlist</span>
            </button>

            <button
              onClick={openLibraryModal}
              className="glass-card hover:border-[var(--primary-spotify)]/50 text-white font-bold px-5 py-3 rounded-full flex items-center gap-2 text-xs transition-all"
            >
              <Plus className="w-4 h-4 text-[var(--primary-spotify)]" />
              <span>Chọn Từ Thư Viện Bài Hát</span>
            </button>
          </div>
        </div>
      )}

      {/* 🚀 MODAL 1: Upload Nhạc Trực Tiếp vào Playlist */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-md p-6 rounded-3xl border border-white/10 shadow-2xl relative flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-[var(--primary-spotify)]" />
                Upload Nhạc vào "{playlist.name}"
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {uploadError && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{uploadError}</span>
              </div>
            )}

            <form onSubmit={handleDirectUpload} className="flex flex-col gap-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsModalDragging(true)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsModalDragging(false)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setIsModalDragging(false)
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handleFileChange(e.dataTransfer.files[0])
                  }
                }}
                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer ${
                  isModalDragging
                    ? 'border-[var(--primary-spotify)] bg-[var(--primary-spotify)]/15 scale-[1.02] shadow-xl shadow-[var(--theme-glow-shadow)]'
                    : 'border-white/10 hover:border-[var(--primary-spotify)] bg-black/40'
                }`}
              >
                <input
                  type="file"
                  accept=".mp3,.wav,.m4a,.flac"
                  onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                  className="hidden"
                  id="playlist-audio-upload"
                />
                <label htmlFor="playlist-audio-upload" className="cursor-pointer flex flex-col items-center gap-2">
                  <Music className="w-6 h-6 text-[var(--primary-spotify)]" />
                  {file ? (
                    <div>
                      <p className="text-xs font-bold text-white">{file.name}</p>
                      <p className="text-[10px] text-[var(--primary-spotify)]">
                        {(file.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-semibold text-slate-300">Chọn file mp3, wav, m4a, flac</p>
                      <p className="text-[10px] text-slate-500">Dung lượng tối đa 150MB</p>
                    </div>
                  )}
                </label>
              </div>

              {file && (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">Tên bài hát *</label>
                    <input
                      type="text"
                      required
                      value={uploadTitle}
                      onChange={(e) => setUploadTitle(e.target.value)}
                      className="w-full glass-input rounded-xl px-3 py-2 text-xs text-white outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">Nghệ sĩ</label>
                    <input
                      type="text"
                      value={uploadArtist}
                      onChange={(e) => setUploadArtist(e.target.value)}
                      placeholder="Tên nghệ sĩ"
                      className="w-full glass-input rounded-xl px-3 py-2 text-xs text-white outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={uploading}
                    className="w-full bg-[var(--primary-spotify)] text-black font-extrabold py-2.5 rounded-full transition-all flex items-center justify-center gap-2 mt-1 shadow-lg shadow-[var(--theme-glow-shadow)] text-xs"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Đang Upload...
                      </>
                    ) : (
                      'Tải Lên & Thêm Vào Playlist'
                    )}
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* 🎵 MODAL 2: Chọn Bài Hát từ Thư Viện */}
      {showLibraryModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="glass-panel w-full max-w-lg p-6 rounded-3xl border border-white/10 shadow-2xl relative flex flex-col gap-4 max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-[var(--primary-spotify)]" />
                Thêm bài hát từ Thư viện
              </h3>
              <button
                onClick={() => setShowLibraryModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Tìm bài hát..."
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                className="w-full glass-input rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none"
              />
            </div>

            {/* Library Tracks List */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-2 max-h-96 pr-1">
              {loadingLibrary ? (
                <p className="text-xs text-slate-400 text-center py-6">Đang tải danh sách bài hát...</p>
              ) : (
                libraryTracks
                  .filter((t) => {
                    const query = librarySearch.toLowerCase()
                    return (
                      t.title.toLowerCase().includes(query) ||
                      (t.artist && t.artist.toLowerCase().includes(query))
                    )
                  })
                  .map((t) => {
                    const inPlaylist = tracks.some((pt) => pt.id === t.id)

                    return (
                      <div
                        key={t.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/10 transition-colors"
                      >
                        <div className="flex items-center gap-3 truncate">
                          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                            <Music className="w-4 h-4 text-slate-400" />
                          </div>
                          <div className="truncate">
                            <p className="text-xs font-bold text-white truncate">{t.title}</p>
                            <p className="text-[10px] text-slate-400 truncate">{t.artist || 'Nghệ sĩ chưa xác định'}</p>
                          </div>
                        </div>

                        {inPlaylist ? (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 shrink-0">
                            Đã thêm
                          </span>
                        ) : (
                          <button
                            onClick={() => handleAddTrackToThisPlaylist(t.id)}
                            className="bg-[var(--primary-spotify)] hover:scale-105 text-black p-1.5 rounded-lg font-bold transition-all shrink-0"
                            title="Thêm vào playlist"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )
                  })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
