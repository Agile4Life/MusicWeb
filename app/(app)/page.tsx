'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Track, Playlist } from '@/types'
import { TrackList } from '@/components/track/TrackList'
import { usePlayer } from '@/components/player/PlayerContext'
import { Play, Upload, Search, Sparkles, Disc, Music, Flame, Trash2, AlertTriangle } from 'lucide-react'

export default function HomePage() {
  const supabase = createClient()
  const { playTrack, currentTrack, isPlaying } = usePlayer()

  const [tracks, setTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [cleaningDuplicates, setCleaningDuplicates] = useState(false)

  const fetchData = async () => {
    setLoading(true)
    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser()

    setUser(currentUser)

    // Query all tracks from database — allows all users to see tracks uploaded by Admin accounts
    const { data: rawTracks, error: trackError } = await supabase
      .from('tracks')
      .select('*')
      .order('created_at', { ascending: false })

    if (!trackError && rawTracks) {
      setTracks(rawTracks)
    } else if (trackError) {
      console.warn('Failed to fetch tracks:', trackError.message)
    }

    if (currentUser) {
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

    let timer: NodeJS.Timeout
    const debouncedFetch = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        fetchData()
      }, 800)
    }

    // Subscribe to realtime tracks & playlists updates for instant UI refresh
    const channel = supabase
      .channel('home-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tracks' },
        () => {
          debouncedFetch()
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'playlists' },
        () => {
          debouncedFetch()
        }
      )
      .subscribe()

    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [])

  const handleAddToPlaylist = async (playlistId: string, trackId: string) => {
    // Try calling RPC fn_add_track_to_playlist first
    const { error: rpcError } = await Promise.resolve(
      supabase.rpc('fn_add_track_to_playlist', {
        p_playlist_id: playlistId,
        p_track_id: trackId,
      })
    )

    if (!rpcError) {
      alert('Đã thêm bài hát vào playlist!')
      return
    }

    // Fallback to direct insert
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

    // Delete dependent records first to prevent foreign key constraint failures
    await supabase.from('playlist_tracks').delete().eq('track_id', trackId)
    await supabase.from('favorite_tracks').delete().eq('track_id', trackId)
    await supabase.from('listening_history').delete().eq('track_id', trackId)

    const { error: dbError } = await supabase.from('tracks').delete().eq('id', trackId)

    if (dbError) {
      alert('Lỗi xóa record DB: ' + dbError.message)
      return
    }

    if (trackToDelete.file_path && !trackToDelete.file_path.startsWith('http')) {
      await supabase.storage.from('music-files').remove([trackToDelete.file_path])
    }

    setTracks(tracks.filter((t) => t.id !== trackId))
  }

  const handleCleanDuplicates = async () => {
    if (!user) return
    if (!confirm('Tìm và xóa tất cả bài hát bị trùng (cùng tên + nghệ sĩ), chỉ giữ lại bản mới nhất?\n\nThao tác này không thể hoàn tác!')) return

    setCleaningDuplicates(true)
    try {
      // Group tracks by normalized title+artist key
      const seen = new Map<string, Track>()
      const toDelete: Track[] = []

      // tracks are already sorted by created_at desc (newest first)
      for (const track of tracks) {
        const key = `${track.title?.toLowerCase().trim()}|||${(track.artist || '').toLowerCase().trim()}`
        if (seen.has(key)) {
          // This is an older duplicate — mark for deletion
          toDelete.push(track)
        } else {
          seen.set(key, track)
        }
      }

      if (toDelete.length === 0) {
        alert('Không tìm thấy bài hát trùng nào!')
        return
      }

      let deletedCount = 0
      for (const track of toDelete) {
        const { error } = await supabase.from('tracks').delete().eq('id', track.id)
        if (!error) {
          if (track.file_path && !track.file_path.startsWith('http')) {
            await supabase.storage.from('music-files').remove([track.file_path])
          }
          deletedCount++
        }
      }

      alert(`✅ Đã xóa ${deletedCount} bài trùng khỏi thư viện!`)
      await fetchData()
    } finally {
      setCleaningDuplicates(false)
    }
  }

  const handleTrackUpdated = (trackId: string, updates: Partial<Track>) => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t)))
  }

  const handleBulkUpdated = (trackIds: string[], updates: Partial<Track>) => {
    const idSet = new Set(trackIds)
    setTracks((prev) =>
      prev.map((t) => (idSet.has(t.id) ? { ...t, ...updates } : t))
    )
  }

  const handleBulkDeleted = (trackIds: string[]) => {
    const idSet = new Set(trackIds)
    setTracks((prev) => prev.filter((t) => !idSet.has(t.id)))
  }

  const filteredTracks = tracks.filter((t) => {
    const query = searchQuery.toLowerCase()
    return (
      t.title.toLowerCase().includes(query) ||
      (t.artist && t.artist.toLowerCase().includes(query)) ||
      (t.album && t.album.toLowerCase().includes(query))
    )
  })

  // Admin check: role set via Supabase Dashboard (Auth > Users > app_metadata) or email match
  const isAdmin =
    user?.app_metadata?.role === 'admin' ||
    user?.email === 'admin@musicweb.com'

  return (
    <div className="p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto w-full">
      {/* High-Impact Hero Card */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 p-8 md:p-10 bg-gradient-to-r from-[var(--theme-gradient-1)] via-[#0e141a] to-[#090b10] shadow-2xl">
        {/* Glow Effects */}
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-[var(--primary-spotify)]/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-[var(--theme-secondary)]/20 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex flex-col gap-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--primary-spotify)]/10 border border-[var(--primary-spotify)]/30 text-[var(--primary-spotify)] text-xs font-bold uppercase tracking-widest w-max shadow-sm">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Thư viện âm nhạc cá nhân</span>
            </div>

            <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight flex items-center gap-3">
              <span>Xin Chào,</span>
              {user && (
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[var(--primary-spotify)] via-emerald-300 to-teal-200">
                  {user.user_metadata?.full_name || user.email?.split('@')[0]}
                </span>
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
                className="bg-[var(--primary-spotify)] text-black font-extrabold px-6 py-3.5 rounded-full flex items-center gap-2 shadow-xl shadow-[var(--theme-glow-shadow)] hover:scale-105 transition-all text-sm"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>Phát Ngay</span>
              </button>
            )}

            <Link
              href="/upload"
              className="glass-card hover:border-[var(--primary-spotify)]/50 text-white font-bold px-5 py-3.5 rounded-full flex items-center gap-2 text-sm transition-all shadow-lg"
            >
              <Upload className="w-4 h-4 text-[var(--primary-spotify)]" />
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
                className="glass-card p-3 rounded-2xl flex flex-col gap-2.5 cursor-pointer group hover:scale-[1.02] transition-all"
              >
                <div className="aspect-square bg-slate-800 rounded-xl overflow-hidden relative border border-white/10 flex items-center justify-center">
                  {t.cover_url ? (
                    <img src={t.cover_url} alt={t.title} className="w-full h-full object-cover" />
                  ) : (
                    <Music className="w-8 h-8 text-slate-500" />
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-[2px]">
                    <div className="w-10 h-10 rounded-full bg-[var(--primary-spotify)] text-black flex items-center justify-center shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform">
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                    </div>
                  </div>
                </div>

                <div className="truncate">
                  <p className="text-xs font-bold text-white truncate group-hover:text-[var(--primary-spotify)] transition-colors">
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Disc className="w-5 h-5 text-[var(--primary-spotify)]" />
            Tất Cả Bài Hát ({filteredTracks.length})
          </h2>

          <div className="flex items-center gap-2">
            {/* Clean duplicates button — admin only, shows when there are duplicates */}
            {isAdmin && (() => {
              const seen = new Set<string>()
              const hasDupes = tracks.some((t) => {
                const key = `${t.title?.toLowerCase().trim()}|||${(t.artist || '').toLowerCase().trim()}`
                if (seen.has(key)) return true
                seen.add(key)
                return false
              })
              return hasDupes ? (
                <button
                  onClick={handleCleanDuplicates}
                  disabled={cleaningDuplicates}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-3 py-2 rounded-full transition-all disabled:opacity-50"
                >
                  {cleaningDuplicates ? (
                    <span className="animate-spin w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full inline-block" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                  {cleaningDuplicates ? 'Đang dọn...' : 'Dọn bài trùng'}
                </button>
              ) : null
            })()}

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
        </div>

        {loading ? (
          <div className="text-center py-16 text-slate-400 font-medium">Đang tải thư viện nhạc...</div>
        ) : (
          <TrackList
            tracks={filteredTracks}
            userPlaylists={playlists}
            onAddToPlaylist={handleAddToPlaylist}
            onDeleteTrack={handleDeleteTrack}
            onTrackUpdated={handleTrackUpdated}
            isAdmin={isAdmin}
            onBulkUpdated={handleBulkUpdated}
            onBulkDeleted={handleBulkDeleted}
          />
        )}
      </div>
    </div>
  )
}
