'use client'

import React, { createContext, useContext, useState, useRef, useEffect } from 'react'
import { Track } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { buildDriveStreamUrl } from '@/lib/googleDriveUpload'

interface PlayerContextType {
  currentTrack: Track | null
  isPlaying: boolean
  queue: Track[]
  currentIndex: number
  currentTime: number
  duration: number
  volume: number
  playTrack: (track: Track, newQueue?: Track[]) => Promise<void>
  togglePlay: () => void
  seek: (time: number) => void
  setVolume: (val: number) => void
  nextTrack: () => void
  prevTrack: () => void
  audioRef: React.RefObject<HTMLAudioElement | null>
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined)

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null)
  const [isPlaying, setIsPlaying] = useState<boolean>(false)
  const [queue, setQueue] = useState<Track[]>([])
  const [currentIndex, setCurrentIndex] = useState<number>(-1)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [duration, setDuration] = useState<number>(0)
  const [volume, setVolumeState] = useState<number>(0.8)
  const [autoPlayNext, setAutoPlayNext] = useState(true)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playRequestRef = useRef(0)
  const supabase = createClient()

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
    return () => { active = false }
  }, [supabase])

  // Resolve both legacy Supabase paths and Google Drive files.
  // Supabase paths are relative (for example "user-id/song.mp3").
  // Drive files are identified by a file ID and must be streamed through the Worker.
  const getAudioUrl = async (filePath: string): Promise<string | null> => {
    if (!filePath) return null

    if (filePath.startsWith('http')) {
      try {
        const parsed = new URL(filePath)
        const isGoogleUrl = parsed.hostname.includes('drive.google.com') || parsed.hostname.includes('googleapis.com')
        const workerStream = parsed.pathname.endsWith('/api/upload/stream')
        const queryId = parsed.searchParams.get('id')
        const pathId = parsed.pathname.match(/\/file\/d\/([^/]+)/)?.[1]

        // Old records may contain a direct Google Drive URL. Convert those to
        // the Worker stream so Range requests and Google auth stay server-side.
        if (isGoogleUrl && (queryId || pathId)) {
          return buildDriveStreamUrl(queryId || pathId!)
        }

        // New records already contain the Worker stream URL.
        if (workerStream && queryId) return filePath
      } catch {
        // Let the browser report malformed absolute URLs below.
      }

      // Do not send an absolute URL to Supabase. This preserves support for
      // legacy Supabase paths while allowing public/Worker URLs to play.
      return filePath
    }

    // Try creating signed URL (valid for 1 hour)
    const { data, error } = await supabase.storage
      .from('music-files')
      .createSignedUrl(filePath, 3600)

    if (error || !data?.signedUrl) {
      // Fallback to public URL if available
      const { data: pubData } = supabase.storage
        .from('music-files')
        .getPublicUrl(filePath)
      return pubData.publicUrl
    }

    return data.signedUrl
  }

  const playTrack = async (track: Track, newQueue?: Track[]) => {
    const requestId = ++playRequestRef.current

    if (newQueue) {
      setQueue(newQueue)
      const index = newQueue.findIndex((t) => t.id === track.id)
      setCurrentIndex(index >= 0 ? index : 0)
    } else if (queue.length === 0) {
      setQueue([track])
      setCurrentIndex(0)
    }

    setCurrentTrack(track)

    const url = await getAudioUrl(track.file_path)
    const audio = audioRef.current
    if (!url || !audio || requestId !== playRequestRef.current) return

    audio.pause()
    audio.src = url
    audio.volume = volume
    audio.load()

    try {
      await audio.play()
      if (requestId !== playRequestRef.current) return
      setIsPlaying(true)
      supabase.rpc('fn_play_track', { p_track_id: track.id }).catch(() => {})
    } catch (err) {
      setIsPlaying(false)
      console.error('Audio playback error:', { trackId: track.id, url, error: err })
    }
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
        .catch((err) => console.error('Playback error:', err))
    }
  }

  const seek = (time: number) => {
    if (!audioRef.current) return
    audioRef.current.currentTime = time
    setCurrentTime(time)
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

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleLoadedMetadata = () => setDuration(audio.duration || 0)
    const handleError = () => {
      setIsPlaying(false)
      setDuration(0)
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
