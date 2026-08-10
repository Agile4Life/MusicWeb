'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Track, Playlist } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { getValidUserId } from '@/lib/accessControl'
import { resolveExternalTrackId, isExternalTrack } from '@/lib/trackPersistence'
import { useSession } from 'next-auth/react'
import { Heart, Play, Search, Music, Sparkles, Loader2, ChevronLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { TrackList } from '@/components/track/TrackList'
import { TrackListSkeleton } from '@/components/common/SkeletonLoader'

function inferTrackSource(track: Track): Track {
  if (track.source && track.source !== 'local') return track

  const fp = track.file_path || ''
  if (fp.includes('youtube.com') || fp.includes('youtu.be') || track.youtube_id || track.id.startsWith('yt-')) {
    let ytId = track.youtube_id
    if (!ytId) {
      const match = fp.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/|^yt-)([a-zA-Z0-9_-]{11})/)
      if (match) ytId = match[1]
      else if (track.id.startsWith('yt-')) ytId = track.id.replace('yt-', '')
    }
    return { ...track, source: 'youtube', youtube_id: ytId }
  }

  if (fp.includes('spotify.com') || track.spotify_id || track.id.startsWith('spotify-')) {
    return { ...track, source: 'spotify' }
  }

  if (fp.includes('itunes.apple.com') || track.itunes_id || track.id.startsWith('itunes-')) {
    return { ...track, source: 'itunes' }
  }

  if (fp.includes('audius.co') || track.audius_id || track.id.startsWith('audius-')) {
    return { ...track, source: 'audius' }
  }

  return track
}

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

      const activeUser =
        currentUser ||
        (nextAuthSession?.user
          ? {
              id: nextAuthSession.user.email,
              email: nextAuthSession.user.email,
            }
          : null)

      const userId = activeUser ? getValidUserId(activeUser) : null

      if (!userId) {
        setTracks([])
        setPlaylists([])
        setLoading(false)
        return
      }

      // Fetch User Playlists
      const { data: playlistData } = await supabase
        .from('playlists')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (playlistData) setPlaylists(playlistData)

      // Fetch User's Personal Favorite Tracks from favorite_tracks junction table
      const { data: favData } = await supabase
        .from('favorite_tracks')
        .select('track_id, tracks:track_id(*)')
        .eq('user_id', userId)

      const favList: Track[] = []
      const seenIds = new Set<string>()

      if (favData) {
        for (const item of favData) {
          const tr = item.tracks as any
          if (tr && tr.id && !seenIds.has(tr.id)) {
            seenIds.add(tr.id)
            favList.push(inferTrackSource({ ...tr, is_favorite: true }))
          }
        }
      }

      setTracks(favList)
    } catch (err) {
      console.error('Fetch favorites error:', err)
    } finally {
      setLoading(false)
    }
  }, [nextAuthSession, supabase])

  useEffect(() => {
    fetchFavorites()
  }, [fetchFavorites])

  const handleAddToPlaylist = async (playlistId: string, track: Track) => {
    const activeUser =
      supabaseUser ||
      (nextAuthSession?.user
        ? {
            id: nextAuthSession.user.email,
            email: nextAuthSession.user.email,
          }
        : null)

    const userId = activeUser ? getValidUserId(activeUser) : null
    if (!userId) {
      alert('Vui lòng đăng nhập để thêm bài hát vào playlist!')
      return
    }

    let targetTrackId = track.id

    if (isExternalTrack(track)) {
      const resolvedId = await resolveExternalTrackId(supabase, track, userId)
      if (!resolvedId) {
        alert('Lỗi lưu bài hát vào CSDL')
        return
      }
      targetTrackId = resolvedId
    }

    const { error: rpcError } = await Promise.resolve(
      supabase.rpc('fn_add_track_to_playlist', {
        p_playlist_id: playlistId,
        p_track_id: targetTrackId,
      })
    )

    if (!rpcError) {
      alert('Đã thêm bài hát vào playlist!')
      return
    }

    const { error } = await supabase.from('playlist_tracks').insert({
      playlist_id: playlistId,
      track_id: targetTrackId,
    })

    if (!error) {
      alert('Đã thêm bài hát vào playlist!')
    } else {
      alert(error.message || 'Lỗi thêm bài hát vào playlist')
    }
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
    <div className="p-3.5 sm:p-6 md:p-8 flex flex-col gap-4 sm:gap-6 md:gap-8 max-w-7xl mx-auto w-full pb-36 md:pb-8 select-none">
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
