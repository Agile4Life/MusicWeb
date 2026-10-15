'use client'

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Playlist } from '@/types'
import { getValidUserId } from '@/lib/accessControl'
import { useSession } from 'next-auth/react'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import {
  PlaylistRepository,
  PlaylistRequestError,
} from '@/lib/playlist/playlistRepository'
import { createBrowserPlaylistRepository } from './playlistComposition'

interface PlaylistContextType {
  playlists: Playlist[]
  loading: boolean
  createPlaylist: (customName?: string) => Promise<Playlist | null>
  deletePlaylist: (playlistId: string, playlistName: string) => Promise<boolean>
  refreshPlaylists: () => Promise<void>
}

const PlaylistContext = createContext<PlaylistContextType | undefined>(undefined)

export function PlaylistProvider({
  children,
  repository,
}: {
  children: React.ReactNode
  repository?: PlaylistRepository
}) {
  const playlistRepository = useMemo(
    () => repository ?? createBrowserPlaylistRepository(),
    [repository]
  )
  const { data: nextAuthSession } = useSession()
  const { userEmail } = useCurrentUser()
  const [playlists, setPlaylists] = useState<Playlist[]>([])
  const [loading, setLoading] = useState(true)
  const createBusyRef = useRef(false)
  const refreshSeqRef = useRef(0)

  const activeUserId = useMemo(() => {
    const user = userEmail
      ? {
          id: userEmail,
          email: userEmail,
          user_metadata: nextAuthSession?.user
            ? { full_name: nextAuthSession.user.name, avatar_url: nextAuthSession.user.image }
            : {},
        }
      : null
    return user ? getValidUserId(user) : null
  }, [userEmail, nextAuthSession])

  const refreshPlaylists = useCallback(async () => {
    const seq = ++refreshSeqRef.current

    try {
      const nextPlaylists = await playlistRepository.list()
      if (seq === refreshSeqRef.current) {
        setPlaylists(nextPlaylists)
      }
    } catch (err) {
      console.warn('PlaylistContext fetch error:', err)
    } finally {
      if (seq === refreshSeqRef.current) setLoading(false)
    }
  }, [playlistRepository])

  // Single centralized fetch & single Realtime WebSocket channel for playlists
  useEffect(() => {
    queueMicrotask(() => {
      void refreshPlaylists()
    })

    if (!activeUserId) return

    return playlistRepository.subscribe(() => {
      void refreshPlaylists()
    })
  }, [activeUserId, refreshPlaylists, playlistRepository])

  // 👉 TẠO PLAYLIST
  const createPlaylist = async (customName?: string): Promise<Playlist | null> => {
    if (createBusyRef.current) return null
    createBusyRef.current = true
    try {
      const playlist = await playlistRepository.create(customName)
      if (!playlist) return null

      setPlaylists((prev) => [playlist, ...prev])
      playlistRepository.notifyChanged()
      return playlist
    } catch (err) {
      if (err instanceof PlaylistRequestError && err.status === 401) {
        alert('Vui lòng đăng nhập để tạo Playlist cá nhân!')
        return null
      }
      return null
    } finally {
      createBusyRef.current = false
    }
  }

  // 👉 XÓA PLAYLIST
  const deletePlaylist = async (playlistId: string, playlistName: string): Promise<boolean> => {
    if (!confirm(`Bạn có chắc chắn muốn xóa playlist "${playlistName}"?`)) return false
    try {
      await playlistRepository.remove(playlistId)
      setPlaylists((prev) => prev.filter((p) => p.id !== playlistId))
      playlistRepository.notifyChanged()
      return true
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      alert('Lỗi xóa playlist: ' + message)
      return false
    }
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
