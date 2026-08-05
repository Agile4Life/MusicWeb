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
  isShuffle: boolean
  toggleShuffle: () => void
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

declare global {
  interface Window {
    YT: any
    onYouTubeIframeAPIReady: any
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
  const autoPlayNextRef = useRef(true)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ytPlayerRef = useRef<any>(null)
  const ytReadyRef = useRef<boolean>(false)
  const playRequestRef = useRef(0)

  const currentTrackRef = useRef<Track | null>(null)
  const queueRef = useRef<Track[]>([])
  const currentIndexRef = useRef<number>(-1)
  const volumeRef = useRef<number>(0.8)
  const lastSavedTimeRef = useRef<number>(0)
  const playTrackRef = useRef<(track: Track, newQueue?: Track[], forceIndex?: number) => Promise<void>>(async () => {})

  const supabase = createClient()

  useEffect(() => {
    currentTrackRef.current = currentTrack
    queueRef.current = queue
    currentIndexRef.current = currentIndex
    volumeRef.current = volume
  }, [currentTrack, queue, currentIndex, volume])

  useEffect(() => {
    autoPlayNextRef.current = autoPlayNext
  }, [autoPlayNext])

  // Load YouTube IFrame Player API Script dynamically
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!window.YT) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      const firstScriptTag = document.getElementsByTagName('script')[0]
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag)

      window.onYouTubeIframeAPIReady = () => {
        initYouTubePlayer()
      }
    } else {
      initYouTubePlayer()
    }

    function initYouTubePlayer() {
      if (ytPlayerRef.current || !window.YT) return
      try {
        ytPlayerRef.current = new window.YT.Player('yt-player-container', {
          height: '0',
          width: '0',
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            rel: 0,
          },
          events: {
            onReady: () => {
              ytReadyRef.current = true
            },
            onStateChange: (event: any) => {
              // YT.PlayerState.PLAYING = 1, PAUSED = 2, ENDED = 0
              if (event.data === 1) {
                setIsPlaying(true)
                if (ytPlayerRef.current?.getDuration) {
                  setDuration(ytPlayerRef.current.getDuration() || 0)
                }
              } else if (event.data === 2) {
                setIsPlaying(false)
              } else if (event.data === 0) {
                setIsPlaying(false)
                // Use refs to avoid stale closure over autoPlayNext and queue/index
                if (autoPlayNextRef.current) {
                  const q = queueRef.current
                  const idx = currentIndexRef.current
                  if (q.length > 0 && idx !== -1) {
                    const nextIdx = (idx + 1) % q.length
                    // Defer to avoid calling during YT state transition
                    setTimeout(() => {
                      playTrackRef.current(q[nextIdx], undefined, nextIdx)
                    }, 0)
                  }
                }
              }
            },
            onError: (err: any) => {
              console.warn('YouTube Player Error:', err)
              setPlaybackError('Không thể phát video YouTube này')
            },
          },
        })
      } catch (e) {
        console.warn('YT Player init exception:', e)
      }
    }
  }, [])

  // Sync YouTube Player timer when playing YouTube track
  useEffect(() => {
    let interval: any = null
    if (currentTrack?.source === 'youtube' && isPlaying) {
      interval = setInterval(() => {
        if (ytPlayerRef.current && ytPlayerRef.current.getCurrentTime) {
          const time = ytPlayerRef.current.getCurrentTime() || 0
          setCurrentTime(time)
          if (ytPlayerRef.current.getDuration) {
            setDuration(ytPlayerRef.current.getDuration() || 0)
          }

          if (Math.abs(time - lastSavedTimeRef.current) > 2) {
            lastSavedTimeRef.current = time
            savePlayerStateToStorage(
              currentTrackRef.current,
              time,
              queueRef.current,
              currentIndexRef.current,
              volumeRef.current
            )
          }
        }
      }, 1000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [currentTrack, isPlaying])

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

  // Resolve audio URL for local and external tracks
  const getAudioUrl = async (track: Track): Promise<string | null> => {
    if (track.source === 'audius' || track.audio_url) {
      return track.audio_url || track.file_path
    }

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

  // Restore saved player state on mount
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

          if (restoredTrack.source !== 'youtube') {
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
      }
    } catch (e) {
      console.warn('Failed to restore player state from storage:', e)
    }
  }, [])

  // Save exact position on page unload
  useEffect(() => {
    const handleUnload = () => {
      if (currentTrackRef.current) {
        let finalTime = currentTime
        if (currentTrackRef.current.source === 'youtube' && ytPlayerRef.current?.getCurrentTime) {
          finalTime = ytPlayerRef.current.getCurrentTime() || currentTime
        } else if (audioRef.current) {
          finalTime = audioRef.current.currentTime || currentTime
        }
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
  }, [currentTime])

  const playTrack = async (track: Track, newQueue?: Track[], forceIndex?: number) => {
    const requestId = ++playRequestRef.current

    let nextQueue = queue
    let nextIndex = currentIndex

    if (newQueue) {
      nextQueue = newQueue
      setQueue(newQueue)
      const index = newQueue.findIndex((t) => t.id === track.id)
      nextIndex = index >= 0 ? index : 0
      setCurrentIndex(nextIndex)
    } else if (typeof forceIndex === 'number') {
      nextIndex = forceIndex
      setCurrentIndex(forceIndex)
    } else if (queue.length === 0) {
      nextQueue = [track]
      setQueue(nextQueue)
      nextIndex = 0
      setCurrentIndex(0)
    }

    // 🎵 Full-Length Stream Resolver for iTunes tracks (Resolves 30s limit into 100% full song)
    let activeTrack = track
    if (track.source === 'itunes' && !track.youtube_id) {
      try {
        const { searchYouTubeTracks } = await import('@/lib/youtube')
        const matches = await searchYouTubeTracks(`${track.title} ${track.artist || ''}`, 1)
        if (matches.length > 0 && matches[0].youtube_id) {
          activeTrack = {
            ...track,
            youtube_id: matches[0].youtube_id,
            source: 'youtube', // Switch audio engine to YouTube for 100% full-length playback
          }
        }
      } catch (e) {
        console.warn('iTunes full length resolution fallback to 30s preview:', e)
      }
    }

    setCurrentTrack(track)
    setPlaybackError(null)
    savePlayerStateToStorage(track, 0, nextQueue, nextIndex, volume)

    // Handle YouTube track playback (or resolved iTunes track)
    if (activeTrack.source === 'youtube' && activeTrack.youtube_id) {
      if (audioRef.current) audioRef.current.pause()

      if (ytPlayerRef.current && ytPlayerRef.current.loadVideoById) {
        try {
          ytPlayerRef.current.setVolume(volume * 100)
          ytPlayerRef.current.loadVideoById(activeTrack.youtube_id)
          setIsPlaying(true)
        } catch (e) {
          console.warn('YT loadVideoById error:', e)
        }
      } else {
        setPlaybackError('Đang khởi tạo YouTube Player, vui lòng thử lại sau 2 giây')
      }
    } else {
      // Handle HTML5 / Audius audio playback
      if (ytPlayerRef.current && ytPlayerRef.current.pauseVideo) {
        try {
          ytPlayerRef.current.pauseVideo()
        } catch {}
      }

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
      } catch (err: any) {
        setIsPlaying(false)
        if (err?.name === 'AbortError' || String(err).includes('interrupted')) {
          return // Ignore play interruption silently
        }
        const message = err instanceof Error ? err.message : String(err)
        console.warn('Audio playback info:', { trackId: track.id, message })
        return
      }
    }

    // Record listening history in background — only for local DB tracks
    // YouTube/Audius tracks have non-UUID IDs (e.g. "yt-xxx", "audius-xxx")
    // which would crash the INSERT into the UUID-typed track_id column.
    if (!track.source || track.source === 'local') {
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

          await supabase.from('listening_history').insert({
            user_id: userId,
            track_id: track.id,
            played_at: new Date().toISOString(),
          })
        } catch (historyErr) {
          console.warn('History tracking error:', historyErr)
        }
      }, 100)
    }
  }

  // Keep playTrackRef in sync so YouTube onStateChange closure always calls latest version
  playTrackRef.current = playTrack

  const togglePlay = () => {
    if (!currentTrack) return

    if (currentTrack.source === 'youtube' && ytPlayerRef.current) {
      if (isPlaying) {
        ytPlayerRef.current.pauseVideo()
        setIsPlaying(false)
      } else {
        ytPlayerRef.current.playVideo()
        setIsPlaying(true)
      }
      return
    }

    if (!audioRef.current) return
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
        })
    }
  }

  const seek = (time: number) => {
    setCurrentTime(time)

    if (currentTrack?.source === 'youtube' && ytPlayerRef.current?.seekTo) {
      ytPlayerRef.current.seekTo(time, true)
    } else if (audioRef.current) {
      audioRef.current.currentTime = time
    }

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
    if (ytPlayerRef.current?.setVolume) {
      try {
        ytPlayerRef.current.setVolume(val * 100)
      } catch {}
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

  // HTML5 Audio Event Listeners
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      if (currentTrackRef.current?.source !== 'youtube') {
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
    }

    const handleLoadedMetadata = () => {
      if (currentTrackRef.current?.source !== 'youtube') {
        setDuration(audio.duration || 0)
      }
    }

    const handleError = () => {
      if (currentTrackRef.current?.source !== 'youtube') {
        setIsPlaying(false)
        setDuration(0)
        const mediaError = audio.error
        setPlaybackError(
          `Audio lỗi${mediaError?.code ? ` (mã ${mediaError.code})` : ''}: ${
            mediaError?.message || 'không đọc được file'
          }`
        )
      }
    }

    const handleEnded = () => {
      if (currentTrackRef.current?.source !== 'youtube') {
        if (autoPlayNext) nextTrack()
        else setIsPlaying(false)
      }
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

  // Media Session API Sync (Lock Screen Controls)
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator) || !currentTrack) return

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist || 'Nghệ sĩ chưa xác định',
        album: currentTrack.album || 'MusicWeb Studio',
        artwork: [
          {
            src: currentTrack.cover_url || '/favicon.ico',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      })

      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'

      navigator.mediaSession.setActionHandler('play', () => togglePlay())
      navigator.mediaSession.setActionHandler('pause', () => togglePlay())
      navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack())
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack())

      try {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime !== undefined) seek(details.seekTime)
        })
      } catch (e) {}
    } catch (err) {
      console.warn('MediaSession init error:', err)
    }
  }, [currentTrack, isPlaying])

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
      {/* Hidden YouTube Player IFrame container */}
      <div className="hidden pointer-events-none opacity-0 invisible w-0 h-0 overflow-hidden">
        <div id="yt-player-container" />
      </div>
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
