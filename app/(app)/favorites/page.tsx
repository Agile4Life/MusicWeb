'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Track, Playlist } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { getValidUserId, getAllValidUserIds } from '@/lib/accessControl'
import { resolveExternalTrackId, isExternalTrack, addTrackToPlaylist } from '@/lib/trackPersistence'
import { fetchFavoriteTracks, inferTrackSource } from '@/lib/favoriteTracks'
import { toast } from '@/components/ui/ToastContext'
import { useSession } from 'next-auth/react'
import { Heart, Play, Search, Music, Sparkles, Loader2, ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { TrackList } from '@/components/track/TrackList'
import { TrackListSkeleton } from '@/components/common/SkeletonLoader'

export default function FavoritesPage() {
  const router = useRouter()
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const { playTrack } = usePlayer()

  const [tracks, setTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [supabaseUser, setSupabaseUser] = useState<any>(null)

  const fetchFavorites = useCallback(async () => {
    setLoading(true)
    try {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser()

      setSupabaseUser(currentUser)

      const userIds = getAllValidUserIds(currentUser, nextAuthSession)

      if (userIds.length === 0) {
        setTracks([])
        setPlaylists([])
        setLoading(false)
        return
      }

      // Fetch User Playlists
      const { data: playlistData } = await supabase
        .from('playlists')
        .select('*')
        .in('user_id', userIds)
        .order('created_at', { ascending: false })

      if (playlistData) setPlaylists(playlistData)

      // Fetch User's Personal Favorite Tracks from favorite_tracks junction table reliably
      const favList = await fetchFavoriteTracks(supabase, userIds, 100)
      setTracks(favList)
    } catch (err) {
      console.error('Fetch favorites error:', err)
    } finally {
      setLoading(false)
    }
  }, [nextAuthSession, supabase])

  useEffect(() => {
    fetchFavorites()

    const channel = supabase
      .channel('favorites-page-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'favorite_tracks' },
        () => {
          fetchFavorites()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchFavorites, supabase])

  const handleAddToPlaylist = async (playlistId: string, track: Track) => {
    const activeUser =
      supabaseUser ||
      (nextAuthSession?.user
        ? {
            id: nextAuthSession.user.email,
            email: nextAuthSession.user.email,
          }
        : null)

    const userId = activeUser ? getValidUserId(activeUser) : ''
    const result = await addTrackToPlaylist(supabase, playlistId, track, userId)
    toast(result.message, result.success ? 'success' : 'error', track.title)
  }

  const handleTrackUpdated = (trackId: string, updates: Partial<Track>) => {
    if (updates.is_favorite === false) {
      setTracks((prev) => prev.filter((t) => t.id !== trackId))
    } else {
      setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t)))
    }
  }

  const filteredTracks = tracks.filter((t) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return t.title?.toLowerCase().includes(q) || t.artist?.toLowerCase().includes(q)
  })

  const user =
    supabaseUser ||
    (nextAuthSession?.user
      ? {
          id: nextAuthSession.user.email,
          email: nextAuthSession.user.email,
        }
      : null)
  const isAdmin = user?.email === 'admin@musicweb.com'

  return (
    <div className="p-3.5 sm:p-6 lg:p-8 flex flex-col gap-4 sm:gap-6 lg:gap-8 max-w-7xl mx-auto w-full pb-36 lg:pb-8 select-none">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] p-4 sm:p-6 md:p-8 bg-[#0d1017] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 sm:p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 transition-colors shrink-0"
            title="Quay lại"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>

          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 shrink-0">
            <Heart className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />
          </div>

          <div className="flex flex-col gap-1">
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">Bài hát yêu thích</h1>
            <p className="text-xs text-slate-400">
              {tracks.length > 0
                ? `${tracks.length} bài hát trong bộ sưu tập của bạn`
                : 'Danh sách bài hát được bạn đánh dấu yêu thích'}
            </p>
          </div>
        </div>

        {/* Top Play Action */}
        {tracks.length > 0 && (
          <button
            onClick={() => playTrack(tracks[0], tracks)}
            className="bg-rose-500 hover:bg-rose-400 text-white font-bold px-5 py-2.5 rounded-full flex items-center gap-2 text-xs transition-colors"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Phát tất cả</span>
          </button>
        )}
      </div>

      {/* Filter / Search input */}
      {tracks.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm bài hát yêu thích..."
              className="w-full glass-input rounded-xl pl-10 pr-4 py-2.5 text-xs text-white outline-none"
            />
          </div>

          <span className="text-xs font-mono text-slate-400">
            {filteredTracks.length} bài hát
          </span>
        </div>
      )}

      {/* Main Tracks Table */}
      {loading ? (
        <TrackListSkeleton count={6} />
      ) : (
        <TrackList
          tracks={filteredTracks}
          userPlaylists={playlists}
          onAddToPlaylist={handleAddToPlaylist}
          onTrackUpdated={handleTrackUpdated}
          isAdmin={isAdmin}
        />
      )}
    </div>
  )
}
