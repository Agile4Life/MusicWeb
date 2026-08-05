'use client'

import React, { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Track, Playlist } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { getValidUserId } from '@/lib/accessControl'
import { useSession } from 'next-auth/react'
import { Heart, Play, Search, Music, Sparkles, Loader2 } from 'lucide-react'
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
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const { playTrack } = usePlayer()

  const [tracks, setTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [supabaseUser, setSupabaseUser] = useState<any>(null)

  const fetchFavorites = async () => {
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

      // Query 1: favorite_tracks join tracks table
      const { data: favData } = await supabase
        .from('favorite_tracks')
        .select('track_id, tracks:track_id(*)')
        .eq('user_id', userId)

      // Query 2: tracks table where is_favorite = true
      const { data: dbFavTracks } = await supabase
        .from('tracks')
        .select('*')
        .eq('user_id', userId)
        .eq('is_favorite', true)

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

      if (dbFavTracks) {
        for (const tr of dbFavTracks) {
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
  }

  useEffect(() => {
    fetchFavorites()
  }, [nextAuthSession])

  const handleAddToPlaylist = async (playlistId: string, track: Track) => {
    let targetTrackId = track.id

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
    <div className="p-6 md:p-8 flex flex-col gap-8 max-w-7xl mx-auto w-full">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 p-6 md:p-8 bg-gradient-to-r from-rose-950/60 via-[#0e141a] to-[#090b10] shadow-2xl flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-rose-500 to-pink-400 p-0.5 shadow-xl shadow-rose-500/20 shrink-0">
            <div className="w-full h-full bg-[#0d0e15] rounded-[14px] flex items-center justify-center text-rose-400">
              <Heart className="w-10 h-10 fill-current" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-rose-400">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Bộ sưu tập cá nhân</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Bài Hát Yêu Thích</h1>
            <p className="text-xs text-slate-400">
              {tracks.length > 0
                ? `Bạn có ${tracks.length} bài hát đã thêm vào danh sách yêu thích`
                : 'Danh sách bài hát được bạn đánh dấu yêu thích'}
            </p>
          </div>
        </div>

        {/* Top Play Action */}
        {tracks.length > 0 && (
          <button
            onClick={() => playTrack(tracks[0], tracks)}
            className="bg-rose-500 hover:bg-rose-400 text-white font-extrabold px-6 py-3 rounded-full flex items-center gap-2 text-xs shadow-xl shadow-rose-500/20 transition-all hover:scale-105"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Phát Tất Cả Yêu Thích</span>
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
