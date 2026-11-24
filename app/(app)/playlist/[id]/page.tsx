'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useSession } from 'next-auth/react'
import { isAdmin } from '@/lib/accessControl'
import { addTrackToPlaylist } from '@/lib/trackPersistence'
import { fetchUnifiedSearch } from '@/lib/searchApi'
import { flattenUnifiedSearchResults } from '@/lib/searchFlow'
import { toast } from '@/components/ui/ToastContext'
import { Playlist, Track } from '@/types'
import { TrackList } from '@/components/track/TrackList'
import { usePlayerTrack, usePlayerControls } from '@/components/player/PlayerContext'
import { UploadForm } from '@/components/upload/UploadForm'
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
  Shuffle,
  ChevronDown,
} from 'lucide-react'
import { usePlaylists } from '@/components/playlist/PlaylistContext'

import { TrackListSkeleton, HeroCardSkeleton } from '@/components/common/SkeletonLoader'

export default function PlaylistDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [playlistId, setPlaylistId] = useState<string>('')
  const router = useRouter()

  useEffect(() => {
    let mounted = true
    params.then((resolved) => {
      if (mounted) setPlaylistId(resolved.id)
    })
    return () => {
      mounted = false
    }
  }, [params])
  const supabase = createClient()
  const { isShuffle } = usePlayerTrack()
  const { playTrack, toggleShuffle } = usePlayerControls()
  const { playlists: userPlaylists, createPlaylist } = usePlaylists()

  const { data: session } = useSession()
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then((res: any) => {
      const email = res?.data?.user?.email || session?.user?.email || null
      setUserEmail(email)
    })
  }, [supabase, session])

  const userIsAdmin = isAdmin(userEmail)

  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [showPlaylistSelector, setShowPlaylistSelector] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')

  // Modals state
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showLibraryModal, setShowLibraryModal] = useState(false)

  // Close open modals on Escape
  useEffect(() => {
    if (!showPlaylistSelector && !showUploadModal && !showLibraryModal) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showPlaylistSelector) setShowPlaylistSelector(false)
        else if (showUploadModal) setShowUploadModal(false)
        else if (showLibraryModal) setShowLibraryModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showPlaylistSelector, showUploadModal, showLibraryModal])

  // Direct Upload State

  // Library & Global Tracks Picker State
  const [libraryTracks, setLibraryTracks] = useState<Track[]>([])
  const [searchResults, setSearchResults] = useState<Track[]>([])
  const [librarySearch, setLibrarySearch] = useState('')
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const [addingTrackId, setAddingTrackId] = useState<string | null>(null)

  // Debounced search for Online + Local tracks in modal
  useEffect(() => {
    if (!showLibraryModal) return
    const q = librarySearch.trim()
    if (!q) {
      setSearchResults([])
      return
    }

    setLoadingLibrary(true)
    const timer = setTimeout(async () => {
      try {
        const rawResults = await fetchUnifiedSearch(q)
        const flattened = flattenUnifiedSearchResults(rawResults)
        setSearchResults(flattened)
      } catch (err) {
        console.warn('Modal search error:', err)
      } finally {
        setLoadingLibrary(false)
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [librarySearch, showLibraryModal])

  const displayedModalTracks = useMemo(() => {
    if (librarySearch.trim()) {
      return searchResults
    }
    return libraryTracks
  }, [librarySearch, searchResults, libraryTracks])

  const fetchPlaylistData = async (showSkeleton = true) => {
    if (!playlistId) return
    if (showSkeleton) setLoading(true)

    try {
      const res = await fetch(`/api/playlists/${playlistId}`)
      if (!res.ok) {
        if (showSkeleton) setLoading(false)
        return
      }

      const data = await res.json()
      if (data.playlist) {
        setPlaylist(data.playlist)
        setEditName(data.playlist.name)
        setEditDesc(data.playlist.description || '')
        setTracks(data.tracks || [])
      }
    } catch (err) {
      console.error('fetchPlaylistData error:', err)
    } finally {
      if (showSkeleton) setLoading(false)
    }
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

  // Prevent background page scrolling when modals are open
  useEffect(() => {
    const scrollEl = document.querySelector<HTMLElement>('.main-content-scroll')
    if (showUploadModal || showLibraryModal || showPlaylistSelector) {
      if (scrollEl) scrollEl.style.overflow = 'hidden'
    } else {
      if (scrollEl) scrollEl.style.overflow = ''
    }
    return () => {
      if (scrollEl) scrollEl.style.overflow = ''
    }
  }, [showUploadModal, showLibraryModal, showPlaylistSelector])

  // 👉 SỬA PLAYLIST
  const handleUpdatePlaylist = async () => {
    if (!playlist) return
    const res = await fetch(`/api/playlists/${playlist.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, description: editDesc }),
    })
    if (res.ok) {
      setPlaylist({ ...playlist, name: editName, description: editDesc })
      setIsEditing(false)
      window.dispatchEvent(new Event('playlist-updated'))
      router.refresh()
    } else if (res.status === 403) {
      toast('Bạn không có quyền sửa playlist này.', 'error')
    }
  }

  const handleDeletePlaylist = async () => {
    if (!playlist || !confirm('Bạn có chắc chắn muốn xóa playlist này?')) return

    try {
      const res = await fetch(`/api/playlists/${playlist.id}`, { method: 'DELETE' })
      if (res.ok) {
        window.dispatchEvent(new Event('playlist-updated'))
        router.push('/')
        router.refresh()
      } else {
        const errData = await res.json().catch(() => null)
        toast('Lỗi xóa playlist: ' + (errData?.error || res.statusText), 'error')
      }
    } catch (err: any) {
      toast('Lỗi xóa playlist: ' + err?.message, 'error')
    }
  }

  // 👉 XÓA BÀI KHỎI PLAYLIST
  const handleRemoveTrackFromPlaylist = async (trackId: string) => {
    const res = await fetch(
      `/api/playlists/${playlistId}/tracks?trackId=${encodeURIComponent(trackId)}`,
      { method: 'DELETE' }
    )
    if (res.ok) {
      setTracks(tracks.filter((t) => t.id !== trackId))
    } else if (res.status === 403) {
      toast('Bạn không có quyền sửa playlist này.', 'error')
    }
  }


  // Handle File select for direct upload inside playlist

  // Handle direct upload & add to playlist

  // Open Library Picker modal
  const openLibraryModal = async () => {
    setShowLibraryModal(true)
    setLoadingLibrary(true)

    // Select all tracks so all users can add Admin-uploaded songs and albums to playlists
    const { data } = await supabase
      .from('tracks')
      .select('*')
      .order('created_at', { ascending: false })

    if (data) {
      const normalized = data.map((t: Track) => ({ ...t, artist: t.artist || null }))
      setLibraryTracks(normalized)
    }

    setLoadingLibrary(false)
  }

  // Add track (local or external online) to playlist smoothly without full-page flickering
  const handleAddTrackToThisPlaylist = async (track: Track) => {
    setAddingTrackId(track.id)
    try {
      const result = await addTrackToPlaylist(playlistId, track)

      if (result.success) {
        toast(result.message, 'success', track.title)
        // Fetch playlist data in background without triggering full-page skeleton loading
        await fetchPlaylistData(false)
      } else {
        toast(result.message, 'error', track.title)
      }
    } finally {
      setAddingTrackId(null)
    }
  }

  if (loading) {
    return (
      <div className="p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto w-full">
        <HeroCardSkeleton />
        <div className="flex flex-col gap-4">
          <div className="w-48 h-6 bg-slate-800 rounded-lg animate-pulse" />
          <TrackListSkeleton count={6} />
        </div>
      </div>
    )
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
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col gap-4 sm:gap-6 lg:gap-8 max-w-7xl mx-auto w-full pb-36 lg:pb-8 select-none">
      {/* Header Banner */}
      <div className="hero-banner relative overflow-hidden rounded-2xl border border-white/[0.06] p-4 sm:p-6 md:p-8 bg-[var(--elevation-1-bg,#0d1017)] flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
        <div className="w-28 h-28 sm:w-36 sm:h-36 bg-slate-800 rounded-xl flex items-center justify-center shrink-0 border border-white/10 overflow-hidden">
          {playlist.cover_url ? (
            <img src={playlist.cover_url} alt={playlist.name} className="w-full h-full object-cover" />
          ) : (
            <ListMusic className="w-10 h-10 sm:w-12 sm:h-12 text-[var(--spotify-glow,#22d3ee)]" />
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-2.5">
          <p className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
            Playlist cá nhân
          </p>

          {isEditing ? (
            <div className="flex flex-col gap-2 max-w-md">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="bg-white/10 text-white font-bold text-lg px-3 py-1 rounded-xl outline-none border border-[var(--spotify-glow,#22d3ee)]"
              />
              <input
                type="text"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="Mô tả playlist..."
                className="bg-white/10 text-slate-300 text-xs px-3 py-1 rounded-xl outline-none"
              />
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={handleUpdatePlaylist}
                  className="bg-[var(--primary-spotify,#06b6d4)] text-black px-3.5 py-1 rounded-full text-xs font-bold flex items-center gap-1 hover:brightness-110 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" /> Lưu
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="bg-white/10 text-white px-3.5 py-1 rounded-full text-xs font-semibold hover:bg-white/20 transition-colors"
                >
                  <X className="w-3.5 h-3.5" /> Hủy
                </button>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white line-clamp-2">{playlist.name}</h1>
                <button
                  onClick={() => setIsEditing(true)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors shrink-0"
                  title="Chỉnh sửa playlist"
                >
                  <Edit2 className="w-4 h-4" />
                </button>

                <div className="relative">
                  <button
                    onClick={() => setShowPlaylistSelector((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/15 border border-white/15 text-xs font-bold text-[var(--spotify-glow,#22d3ee)] transition-colors cursor-pointer"
                    title="Đổi playlist"
                  >
                    <ListMusic className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)]" />
                    <span>Đổi Playlist ({userPlaylists.length})</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showPlaylistSelector ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-1 truncate">{playlist.description || 'Chưa có mô tả'}</p>
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
            <>
              <button
                onClick={() => playTrack(tracks[0], tracks)}
                className="bg-[var(--primary-spotify)] hover:brightness-110 text-black font-extrabold px-6 py-3 rounded-full flex items-center gap-2 transition-colors text-xs cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Phát Playlist</span>
              </button>

              <button
                onClick={() => {
                  if (!isShuffle) toggleShuffle()
                  const randomIdx = Math.floor(Math.random() * tracks.length)
                  playTrack(tracks[randomIdx], tracks, randomIdx)
                }}
                className={`font-bold px-4 py-3 rounded-full flex items-center gap-2 text-xs transition-colors border cursor-pointer ${
                  isShuffle
                    ? 'bg-[var(--primary-spotify)]/20 text-[var(--primary-spotify)] border-[var(--primary-spotify)]/40'
                    : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
                }`}
              >
                <Shuffle className="w-4 h-4" />
                <span>Phát Ngẫu Nhiên</span>
              </button>
            </>
          )}

          {userIsAdmin && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="bg-white/10 hover:bg-white/20 text-white font-bold px-4 py-3 rounded-full flex items-center gap-2 text-xs transition-colors border border-white/10 cursor-pointer"
            >
              <Upload className="w-4 h-4 text-[var(--primary-spotify)]" />
              <span>Upload nhạc vào Playlist này</span>
            </button>
          )}

          <button
            onClick={openLibraryModal}
            className="bg-white/10 hover:bg-white/20 text-white font-bold px-4 py-3 rounded-full flex items-center gap-2 text-xs transition-colors border border-white/10 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[var(--primary-spotify)]" />
            <span>Thêm từ Thư viện</span>
          </button>
        </div>

        <button
          onClick={handleDeletePlaylist}
          className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors px-3 py-2 rounded-xl flex items-center gap-1.5 text-xs font-bold self-end sm:self-auto whitespace-nowrap shrink-0 cursor-pointer"
          title="Xóa playlist"
        >
          <Trash2 className="w-4 h-4" />
          <span>Xóa Playlist</span>
        </button>
      </div>

      {/* Playlist Track List or Empty State Actions */}
      {tracks.length > 0 ? (
        <TrackList
          tracks={tracks}
          userPlaylists={userPlaylists}
          onAddToPlaylist={async (targetPlId, track) => {
            const res = await addTrackToPlaylist(targetPlId, track)
            toast(res.message, res.success ? 'success' : 'error', track.title)
          }}
          onDeleteTrack={handleRemoveTrackFromPlaylist}
        />
      ) : (
        <div className="glass-panel p-10 rounded-2xl text-center border border-white/10 flex flex-col items-center gap-4 my-4">
          <div className="w-16 h-16 rounded-full bg-[var(--primary-spotify)]/10 flex items-center justify-center text-[var(--primary-spotify)] border border-[var(--primary-spotify)]/20">
            <Music className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Playlist này chưa có bài hát nào</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Bạn có thể chọn bài hát đã có sẵn từ thư viện hệ thống để thêm vào playlist cá nhân này.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
            {userIsAdmin && (
              <button
                onClick={() => setShowUploadModal(true)}
                className="bg-[var(--primary-spotify)] hover:brightness-110 text-black font-extrabold px-5 py-3 rounded-full flex items-center gap-2 text-xs transition-colors cursor-pointer"
              >
                <Upload className="w-4 h-4" />
                <span>Tải Nhạc Mới Vào Playlist</span>
              </button>
            )}

            <button
              onClick={openLibraryModal}
              className="bg-white/10 hover:bg-white/15 border border-white/15 hover:border-[var(--primary-spotify)]/50 text-white font-bold px-5 py-3 rounded-full flex items-center gap-2 text-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4 text-[var(--primary-spotify)]" />
              <span>Chọn Từ Thư Viện Bài Hát</span>
            </button>
          </div>
        </div>
      )}

      {/* 📋 MODAL: Đổi Playlist Cá Nhân */}
      {mounted && showPlaylistSelector && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[99999] lg:z-[70] bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200 select-none"
          onClick={() => setShowPlaylistSelector(false)}
        >
          <div
            className="glass-panel modal-content w-full sm:max-w-md bg-[var(--elevation-2-bg,#0c121e)] border-t sm:border border-white/15 rounded-t-3xl sm:rounded-2xl p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] sm:pb-5 shadow-2xl flex flex-col gap-4 max-h-[85vh] animate-in slide-in-from-bottom duration-250"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile drag handle */}
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-1 shrink-0 sm:hidden" />

            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <ListMusic className="w-5 h-5 text-[var(--spotify-glow,#22d3ee)]" />
                <h3 className="text-base font-extrabold text-white">Đổi Playlist Cá Nhân</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPlaylistSelector(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
                title="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col gap-2 overflow-y-auto max-h-[50vh] pr-1 custom-slim-scrollbar">
              {userPlaylists.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">
                  Bạn chưa có playlist cá nhân nào
                </div>
              ) : (
                userPlaylists.map((pl) => (
                  <button
                    key={pl.id}
                    type="button"
                    onClick={() => {
                      setShowPlaylistSelector(false)
                      router.push(`/playlist/${pl.id}`)
                    }}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl text-xs text-left transition-colors cursor-pointer ${
                      pl.id === playlistId
                        ? 'bg-[var(--primary-spotify)]/20 text-[var(--spotify-glow,#22d3ee)] font-bold border border-[var(--primary-spotify)]/40'
                        : 'bg-white/[0.04] text-slate-200 hover:bg-white/10 border border-white/5'
                    }`}
                  >
                    <div className="flex flex-col gap-0.5 truncate pr-2">
                      <span className="truncate text-sm font-bold">{pl.name}</span>
                      <span className="text-[10px] text-slate-400">Playlist cá nhân</span>
                    </div>
                    {pl.id === playlistId && (
                      <Check className="w-4 h-4 text-[var(--spotify-glow,#22d3ee)] shrink-0" />
                    )}
                  </button>
                ))
              )}
            </div>

            <div className="pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={async () => {
                  setShowPlaylistSelector(false)
                  const newPl = await createPlaylist()
                  if (newPl) {
                    router.push(`/playlist/${newPl.id}`)
                  }
                }}
                className="w-full bg-[var(--primary-spotify,#06b6d4)] text-black font-extrabold py-3 rounded-xl flex items-center justify-center gap-2 text-xs hover:brightness-110 transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Tạo Playlist Mới</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 🚀 MODAL 1: Upload Nhạc Trực Tiếp vào Playlist */}
      {mounted && showUploadModal && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/85 backdrop-blur-md z-[99999] lg:z-[70] flex items-center justify-center p-4 select-none"
          onClick={() => setShowUploadModal(false)}
        >
          <div className="w-full max-w-4xl relative" onClick={(e) => e.stopPropagation()}>
            <UploadForm
              playlistId={playlistId}
              onClose={() => {
                setShowUploadModal(false)
                fetchPlaylistData()
              }}
            />
          </div>
        </div>,
        document.body
      )}

      {/* 🎵 MODAL 2: Chọn Bài Hát từ Thư Viện */}
      {mounted && showLibraryModal && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 bg-black/80 backdrop-blur-md z-[99999] lg:z-[70] flex items-center justify-center p-4 select-none"
          onClick={() => setShowLibraryModal(false)}
        >
          <div
            className="glass-panel w-full max-w-xl p-6 rounded-2xl border border-white/10 shadow-2xl relative flex flex-col gap-4 max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-[var(--primary-spotify)]" />
                Thêm bài hát từ Thư viện
              </h3>
              <button
                onClick={() => setShowLibraryModal(false)}
                className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
                title="Đóng"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Tìm bài hát từ thư viện hoặc online (Spotify, YouTube, NCT)..."
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                className="w-full glass-input rounded-xl pl-9 pr-3 py-2 text-xs text-white outline-none"
              />
            </div>

            {/* Library / Search Tracks List */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-2 max-h-96 pr-1 custom-slim-scrollbar">
              {loadingLibrary ? (
                <p className="text-xs text-slate-400 text-center py-6">Đang tìm bài hát...</p>
              ) : displayedModalTracks.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">
                  {librarySearch.trim() ? 'Không tìm thấy bài hát phù hợp' : 'Thư viện trống'}
                </p>
              ) : (
                displayedModalTracks.map((t) => {
                  const inPlaylist = tracks.some(
                    (pt) =>
                      pt.id === t.id ||
                      (t.title &&
                        pt.title?.toLowerCase().trim() === t.title.toLowerCase().trim() &&
                        (pt.artist || '').toLowerCase().trim() === (t.artist || '').toLowerCase().trim())
                  )

                  return (
                    <div
                      key={t.id}
                      className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05] gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0 overflow-hidden border border-white/10">
                          {t.cover_url ? (
                            <img src={t.cover_url} alt={t.title} className="w-full h-full object-cover" />
                          ) : (
                            <Music className="w-4 h-4 text-slate-400" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white truncate">{t.title}</p>
                          <p className="text-[10px] text-slate-400 truncate">{t.artist || 'Nghệ sĩ chưa xác định'}</p>
                        </div>
                      </div>

                      {inPlaylist ? (
                        <span className="text-[10px] font-bold text-[var(--spotify-glow,#22d3ee)] bg-[var(--primary-spotify,#06b6d4)]/10 px-2.5 py-1 rounded-full border border-[var(--primary-spotify,#06b6d4)]/20 shrink-0 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Đã thêm
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAddTrackToThisPlaylist(t)}
                          disabled={addingTrackId === t.id}
                          className="bg-[var(--primary-spotify)] hover:brightness-110 text-black p-1.5 rounded-lg font-bold transition-colors shrink-0 disabled:opacity-50 flex items-center justify-center min-w-[32px] min-h-[32px] cursor-pointer"
                          title="Thêm vào playlist"
                        >
                          {addingTrackId === t.id ? (
                            <Loader2 className="w-4 h-4 animate-spin text-black" />
                          ) : (
                            <Plus className="w-4 h-4" />
                          )}
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
