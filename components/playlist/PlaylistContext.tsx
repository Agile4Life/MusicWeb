'use client'

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Playlist } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { getValidUserId, isAdmin } from '@/lib/accessControl'
import { useSession } from 'next-auth/react'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'

interface PlaylistContextType {
  playlists: Playlist[]
  loading: boolean
  createPlaylist: (customName?: string) => Promise<Playlist | null>
  deletePlaylist: (playlistId: string, playlistName: string) => Promise<boolean>
  refreshPlaylists: () => Promise<void>
}

const PlaylistContext = createContext<PlaylistContextType | undefined>(undefined)

export function PlaylistProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const { data: nextAuthSession } = useSession()
  const { userEmail } = useCurrentUser()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const createBusyRef = useRef(false)
  const refreshSeqRef = useRef(0)

  const user = userEmail
    ? {
        id: userEmail,
        email: userEmail,
        user_metadata: nextAuthSession?.user
          ? { full_name: nextAuthSession.user.name, avatar_url: nextAuthSession.user.image }
          : {},
      }
    : null

  const activeUserId = useMemo(() => {
    return user ? getValidUserId(user) : null
  }, [user])

  const refreshPlaylists = useCallback(async () => {
    const seq = ++refreshSeqRef.current
    if (!activeUserId) {
      setPlaylists([])
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase
        .from('playlists')
        .select('*')
        .eq('user_id', activeUserId)
        .order('created_at', { ascending: false })

      if (!error && data) {
        if (seq !== refreshSeqRef.current) return
        setPlaylists(data)
      }
    } catch (err) {
      console.warn('PlaylistContext fetch error:', err)
    } finally {
      if (seq === refreshSeqRef.current) setLoading(false)
    }
  }, [activeUserId, supabase])

  // Single centralized fetch & single Realtime WebSocket channel for playlists
  useEffect(() => {
    refreshPlaylists()

    if (!activeUserId) return

    const channel = supabase
      .channel('global-playlists')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'playlists' },
        () => {
          refreshPlaylists()
        }
      )
      .subscribe()

    const handleCustomUpdate = () => {
      refreshPlaylists()
    }
    window.addEventListener('playlist-updated', handleCustomUpdate)

    return () => {
      window.removeEventListener('playlist-updated', handleCustomUpdate)
      supabase.removeChannel(channel)
    }
  }, [activeUserId, refreshPlaylists, supabase])

  const createPlaylist = async (customName?: string): Promise<Playlist | null> => {
    if (createBusyRef.current) return null
    createBusyRef.current = true
    try {
      if (!user || !activeUserId) {
        alert('Vui lòng đăng nhập để tạo Playlist cá nhân!')
        return null
      }

      const newName = customName || `Playlist #${playlists.length + 1}`

      try {
        const { data, error } = await supabase
          .from('playlists')
          .insert({
            user_id: activeUserId,
            name: newName,
            description: 'Playlist cá nhân',
            is_public: false,
          })
          .select()
          .single()

        if (data && !error) {
          setPlaylists((prev) => [data, ...prev])
          window.dispatchEvent(new Event('playlist-updated'))
          return data
        } else if (error) {
          alert('Lỗi tạo playlist: ' + error.message)
        }
      } catch (err: any) {
        alert('Lỗi tạo playlist: ' + err?.message)
      }
      return null
    } finally {
      createBusyRef.current = false
    }
  }

  const deletePlaylist = async (playlistId: string, playlistName: string): Promise<boolean> => {
    if (!confirm(`Bạn có chắc chắn muốn xóa playlist "${playlistName}"?`)) return false

    try {
      await supabase.from('playlist_tracks').delete().eq('playlist_id', playlistId)
      const { error } = await supabase.from('playlists').delete().eq('id', playlistId)

      if (!error) {
        setPlaylists((prev) => prev.filter((p) => p.id !== playlistId))
        window.dispatchEvent(new Event('playlist-updated'))
        return true
      } else {
        alert('Lỗi xóa playlist: ' + error.message)
      }
    } catch (err: any) {
      alert('Lỗi xóa playlist: ' + err?.message)
    }
    return false
  }

  return (
    <PlaylistContext.Provider
      value={{
        playlists,
        loading,
        createPlaylist,
        deletePlaylist,
        refreshPlaylists,
      }}
    >
      {children}
    </PlaylistContext.Provider>
  )
}

export function usePlaylists() {
  const context = useContext(PlaylistContext)
  if (!context) {
    throw new Error('usePlaylists must be used within a PlaylistProvider')
  }
  return context
}
