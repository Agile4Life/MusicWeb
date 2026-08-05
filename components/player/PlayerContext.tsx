'use client'

import React, { createContext, useContext, useState, useRef, useEffect } from 'react'
import { Track } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { extractDriveFileId, getAuthorizedDriveStreamUrl } from '@/lib/googleDriveUpload'
import { useSession } from 'next-auth/react'
import { getValidUserId } from '@/lib/accessControl'

interface PlayerContextType {
  currentTrack: Track | null
  isPlaying: boolean
  queue: Track[]
  currentIndex: number
  currentTime: number
  duration: number
  volume: number
  playbackError: string | null
  playTrack: (track: Track, newQueue?: Track[]) => Promise<void>
  togglePlay: () => void
  seek: (time: number) => void
  setVolume: (val: number) => void
  nextTrack: () => void
  prevTrack: () => void
  audioRef: React.RefObject<HTMLAudioElement | null>
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined)

const savePlayerStateToStorage = (
  track: Track | null,
  time: number,
  trackQueue: Track[],
  index: number,
  vol: number
) => {
  if (typeof window === 'undefined' || !track) return
  try {
    localStorage.setItem(
      'musicweb_player_state',
      JSON.stringify({
        track,
        currentTime: time,
        queue: trackQueue,
        currentIndex: index,
        volume: vol,
        savedAt: Date.now(),
      })
    )
  } catch {
    // ignore storage error
  }
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { data: nextAuthSession } = useSession()
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [queue, setQueue] = useState<Track[]>([])
  const [currentIndex, setCurrentIndex] = useState<number>(-1)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [duration, setDuration] = useState<number>(0)
  const [volume, setVolumeState] = useState<number>(0.8)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [autoPlayNext, setAutoPlayNext] = useState(true)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playRequestRef = useRef(0)
  const currentTrackRef = useRef<Track | null>(null)
  const queueRef = useRef<Track[]>([])
  const currentIndexRef = useRef<number>(-1)
  const volumeRef = useRef<number>(0.8)
  const lastSavedTimeRef = useRef<number>(0)

  const supabase = createClient()

  useEffect(() => {
    currentTrackRef.current = currentTrack
    queueRef.current = queue
    currentIndexRef.current = currentIndex
    volumeRef.current = volume
  }, [currentTrack, queue, currentIndex, volume])

  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(async (result: { data: { user: { id: string } | null } }) => {
      const user = result.data.user
      if (!user) return
      const { data } = await supabase
        .from('user_settings')
        .select('auto_play')
        .eq('user_id', user.id)
        .maybeSingle()
      if (active && typeof data?.auto_play === 'boolean') setAutoPlayNext(data.auto_play)
    })
    return () => {
      active = false
    }
  }, [supabase])

  // Resolve both legacy Supabase paths and Google Drive files.
  const getAudioUrl = async (track: Track): Promise<string | null> => {
    const filePath = track.file_path
    if (!filePath) return null

    const driveFileId = extractDriveFileId(filePath)
    if (driveFileId) {
      return getAuthorizedDriveStreamUrl(track.id, driveFileId)
    }

    if (filePath.startsWith('http')) {
      return filePath
    }

    const { data, error } = await supabase.storage
      .from('music-files')
      .createSignedUrl(filePath, 3600)

    if (error || !data?.signedUrl) {
      const { data: pubData } = supabase.storage.from('music-files').getPublicUrl(filePath)
      return pubData.publicUrl
    }

    return data.signedUrl
  }

  // 🔄 RESTORE SAVED PLAYER STATE ON MOUNT (PAGE RELOAD)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const savedRaw = localStorage.getItem('musicweb_player_state')
      if (savedRaw) {
        const saved = JSON.parse(savedRaw)
        if (saved.track && saved.track.id) {
          const restoredTrack = saved.track
          const restoredTime = typeof saved.currentTime === 'number' ? saved.currentTime : 0
          const restoredQueue =
            Array.isArray(saved.queue) && saved.queue.length > 0 ? saved.queue : [restoredTrack]
          const restoredIndex = typeof saved.currentIndex === 'number' ? saved.currentIndex : 0
          const restoredVol = typeof saved.volume === 'number' ? saved.volume : 0.8

          setCurrentTrack(restoredTrack)
          setQueue(restoredQueue)
          setCurrentIndex(restoredIndex)
          setCurrentTime(restoredTime)
          setVolumeState(restoredVol)

          // Preload audio and set time position without starting playback
          getAudioUrl(restoredTrack)
            .then((url) => {
              const audio = audioRef.current
              if (url && audio) {
                audio.src = url
                audio.volume = restoredVol
                audio.load()

                const onLoaded = () => {
                  if (restoredTime > 0 && restoredTime < (audio.duration || Infinity)) {
                    audio.currentTime = restoredTime
                    setCurrentTime(restoredTime)
                  }
                  audio.removeEventListener('loadedmetadata', onLoaded)
                }
                audio.addEventListener('loadedmetadata', onLoaded)
              }
            })
            .catch((err) => console.warn('Audio restore error:', err))
        }
      }
    } catch (e) {
      console.warn('Failed to restore player state from storage:', e)
    }
  }, [])

  // 💾 SAVE EXACT PLAYBACK POSITION WHEN CLOSING OR UNLOADING PAGE
  useEffect(() => {
    const handleUnload = () => {
      if (currentTrackRef.current && audioRef.current) {
        const finalTime = audioRef.current.currentTime || 0
        savePlayerStateToStorage(
          currentTrackRef.current,
          finalTime,
          queueRef.current,
          currentIndexRef.current,
          volumeRef.current
        )
      }
    }

    window.addEventListener('beforeunload', handleUnload)
    window.addEventListener('pagehide', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('pagehide', handleUnload)
    }
  }, [])

  const playTrack = async (track: Track, newQueue?: Track[]) => {
    const requestId = ++playRequestRef.current

    let nextQueue = queue
    let nextIndex = currentIndex

    if (newQueue) {
      nextQueue = newQueue
      setQueue(newQueue)
      const index = newQueue.findIndex((t) => t.id === track.id)
      nextIndex = index >= 0 ? index : 0
      setCurrentIndex(nextIndex)
    } else if (queue.length === 0) {
      nextQueue = [track]
      setQueue(nextQueue)
      nextIndex = 0
      setCurrentIndex(0)
    }

    setCurrentTrack(track)
    setPlaybackError(null)

    // Save initial state (time 0)
    savePlayerStateToStorage(track, 0, nextQueue, nextIndex, volume)

    let url: string | null = null
    try {
      url = await getAudioUrl(track)
    } catch (error: any) {
      if (requestId === playRequestRef.current) {
        setPlaybackError(error?.message || 'Không thể cấp quyền phát audio')
      }
      return
    }
    const audio = audioRef.current
    if (!url || !audio || requestId !== playRequestRef.current) {
      if (!url) setPlaybackError('Không tìm thấy đường dẫn audio của bài hát')
      return
    }

    audio.pause()
    audio.src = url
    audio.volume = volume
    audio.load()

    try {
      await audio.play()
      if (requestId !== playRequestRef.current) return
      setIsPlaying(true)
    } catch (err) {
      setIsPlaying(false)
      const message = err instanceof Error ? err.message : String(err)
      setPlaybackError(`Không thể phát audio: ${message}`)
      console.error('Audio playback error:', { trackId: track.id, url, error: err })
      return
    }

    // Record listening history in background
    setTimeout(async () => {
      try {
        const {
          data: { user: currentUser },
        } = await supabase.auth.getUser()
        const activeUser = currentUser || (nextAuthSession?.user ? {
          id: nextAuthSession.user.email,
          email: nextAuthSession.user.email,
        } : null)

        const userId = activeUser ? getValidUserId(activeUser) : null
        if (!userId) return

        // 1. Save entry to listening_history
        await supabase.from('listening_history').insert({
          user_id: userId,
          track_id: track.id,
          played_at: new Date().toISOString(),
        })

        // 2. Increment track play_count
        const { data: trData } = await supabase
          .from('tracks')
          .select('play_count')
          .eq('id', track.id)
          .single()

        if (trData) {
          await supabase
            .from('tracks')
            .update({ play_count: (trData.play_count || 0) + 1 })
            .eq('id', track.id)
        }
      } catch (historyErr) {
        console.warn('History tracking error:', historyErr)
      }
    }, 100)
  }

  const togglePlay = () => {
    if (!audioRef.current || !currentTrack) return

    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          setIsPlaying(false)
          const message = err instanceof Error ? err.message : String(err)
          setPlaybackError(`Không thể phát audio: ${message}`)
          console.error('Playback error:', err)
        })
    }
  }

  const seek = (time: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = time
    setCurrentTime(time)
    if (currentTrackRef.current) {
      savePlayerStateToStorage(
        currentTrackRef.current,
        time,
        queueRef.current,
        currentIndexRef.current,
        volumeRef.current
      )
    }
  }

  const setVolume = (val: number) => {
    setVolumeState(val)
    if (audioRef.current) {
      audioRef.current.volume = val
    }
  }

  const nextTrack = () => {
    if (queue.length === 0 || currentIndex === -1) return
    const nextIdx = (currentIndex + 1) % queue.length
    setCurrentIndex(nextIdx)
    playTrack(queue[nextIdx])
  }

  const prevTrack = () => {
    if (queue.length === 0 || currentIndex === -1) return
    const prevIdx = (currentIndex - 1 + queue.length) % queue.length
    setCurrentIndex(prevIdx)
    playTrack(queue[prevIdx])
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      if (Math.abs(audio.currentTime - lastSavedTimeRef.current) > 2 && currentTrackRef.current) {
        lastSavedTimeRef.current = audio.currentTime
        savePlayerStateToStorage(
          currentTrackRef.current,
          audio.currentTime,
          queueRef.current,
          currentIndexRef.current,
          volumeRef.current
        )
      }
    }

    const handleLoadedMetadata = () => setDuration(audio.duration || 0)
    const handleError = () => {
      setIsPlaying(false)
      setDuration(0)
      const mediaError = audio.error
      setPlaybackError(
        `Audio lỗi${mediaError?.code ? ` (mã ${mediaError.code})` : ''}: ${
          mediaError?.message || 'không đọc được file'
        }`
      )
      console.error('Audio element error:', {
        src: audio.currentSrc || audio.src,
        mediaErrorCode: audio.error?.code,
        mediaErrorMessage: audio.error?.message,
      })
    }
    const handleEnded = () => {
      if (autoPlayNext) nextTrack()
      else setIsPlaying(false)
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
    }
  }, [currentIndex, queue, autoPlayNext])

  return (
    <PlayerContext.Provider
      value={{
        currentTrack,
        isPlaying,
        queue,
        currentIndex,
        currentTime,
        duration,
        volume,
        playbackError,
        playTrack,
        togglePlay,
        seek,
        setVolume,
        nextTrack,
        prevTrack,
        audioRef,
      }}
    >
      {children}
      <audio ref={audioRef} preload="metadata" crossOrigin="anonymous" />
    </PlayerContext.Provider>
  )
}

export function usePlayer() {
  const context = useContext(PlayerContext)
  if (!context) {
    throw new Error('usePlayer must be used within a PlayerProvider')
  }
  return context
}
