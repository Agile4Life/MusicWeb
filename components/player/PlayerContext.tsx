'use client'

import React, { createContext, useContext, useState, useRef, useEffect } from 'react'
import { Track } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { extractDriveFileId, getAuthorizedDriveStreamUrl } from '@/lib/googleDriveUpload'
import { useSession } from 'next-auth/react'
import { getValidUserId } from '@/lib/accessControl'
import { deduplicateQueueTracks } from '@/lib/utils'
import { findBestYouTubeMatch } from '@/lib/youtube'
import { fetchUnifiedSearch } from '@/lib/searchApi'

export type RepeatMode = 'off' | 'all' | 'one'

interface PlayerContextType {
  currentTrack: Track | null
  isPlaying: boolean
  queue: Track[]
  currentIndex: number
  currentTime: number
  duration: number
  volume: number
  isShuffle: boolean
  toggleShuffle: () => void
  repeatMode: RepeatMode
  toggleRepeat: () => void
  toggleFavoriteCurrentTrack: () => Promise<void>
  playbackError: string | null
  playTrack: (
    track: Track,
    newQueue?: Track[],
    forceIndex?: number,
    startFromTime?: number
  ) => Promise<void>
  togglePlay: () => void
  seek: (time: number) => void
  setVolume: (val: number) => void
  nextTrack: () => void
  prevTrack: () => void
  addToQueue: (track: Track) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  isQueueOpen: boolean
  toggleQueue: () => void
  closeQueue: () => void
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

function inferTrackSource(track: Track): Track {
  if (track.youtube_id) {
    return { ...track, source: 'youtube' }
  }
  if (track.source && track.source !== 'local') return track

  const fp = track.file_path || ''
  if (fp.includes('youtube.com') || fp.includes('youtu.be') || track.id.startsWith('yt-')) {
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
  const [isShuffle, setIsShuffle] = useState(false)
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off')
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const autoPlayNextRef = useRef(true)
  const isShuffleRef = useRef(false)
  const repeatModeRef = useRef<RepeatMode>('off')

  const toggleQueue = () => setIsQueueOpen((prev) => !prev)
  const closeQueue = () => setIsQueueOpen(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ytPlayerRef = useRef<any>(null)
  const ytReadyRef = useRef<boolean>(false)
  const playRequestRef = useRef(0)

  const currentTrackRef = useRef<Track | null>(null)
  const queueRef = useRef<Track[]>([])
  const currentIndexRef = useRef<number>(-1)
  const volumeRef = useRef<number>(0.8)
  const lastSavedTimeRef = useRef<number>(0)
  const playTrackRef = useRef<
    (track: Track, newQueue?: Track[], forceIndex?: number, startFromTime?: number) => Promise<void>
  >(async () => {})
  const nextTrackRef = useRef<() => void>(() => {})
  const prevTrackRef = useRef<() => void>(() => {})

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

  useEffect(() => {
    isShuffleRef.current = isShuffle
  }, [isShuffle])

  useEffect(() => {
    repeatModeRef.current = repeatMode
  }, [repeatMode])

  const toggleShuffle = () => {
    setIsShuffle((prev) => !prev)
  }

  const toggleRepeat = () => {
    setRepeatMode((prev) => {
      if (prev === 'off') return 'all'
      if (prev === 'all') return 'one'
      return 'off'
    })
  }

  const toggleFavoriteCurrentTrack = async () => {
    if (!currentTrack) return
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    const activeUser =
      currentUser ||
      (nextAuthSession?.user
        ? { id: nextAuthSession.user.email, email: nextAuthSession.user.email }
        : null)
    const userId = activeUser ? getValidUserId(activeUser) : null
    if (!userId) {
      alert('Vui lòng đăng nhập để lưu bài hát yêu thích!')
      return
    }

    const nextValue = !currentTrack.is_favorite
    setCurrentTrack((prev) => (prev ? { ...prev, is_favorite: nextValue } : null))

    try {
      let dbTrackId = currentTrack.id

      // If track is from external source (YouTube, iTunes, Audius), ensure it exists in tracks table
      if (currentTrack.source && currentTrack.source !== 'local') {
        const { data: existing } = await supabase
          .from('tracks')
          .select('id')
          .eq('file_path', currentTrack.file_path)
          .maybeSingle()

        if (existing && existing.id) {
          dbTrackId = existing.id
        } else {
          const { data: inserted } = await supabase
            .from('tracks')
            .insert({
              user_id: userId,
              title: currentTrack.title,
              artist: currentTrack.artist || null,
              album: currentTrack.album || null,
              duration: currentTrack.duration || 0,
              file_path: currentTrack.file_path,
              cover_url: currentTrack.cover_url || null,
              created_at: new Date().toISOString(),
            })
            .select('id')
            .single()

          if (inserted && inserted.id) dbTrackId = inserted.id
        }
      }

      if (nextValue) {
        await supabase.from('favorite_tracks').upsert({ user_id: userId, track_id: dbTrackId })
      } else {
        await supabase.from('favorite_tracks').delete().eq('user_id', userId).eq('track_id', dbTrackId)
      }
    } catch (err) {
      console.warn('Toggle favorite error:', err)
    }
  }

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
              const active = currentTrackRef.current
              if (active && active.source === 'youtube' && active.youtube_id) {
                try {
                  ytPlayerRef.current.cueVideoById({
                    videoId: active.youtube_id,
                    startSeconds: lastSavedTimeRef.current || 0,
                  })
                } catch (e) {
                  console.warn('YT cue error on ready:', e)
                }
              }
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
                const mode = repeatModeRef.current
                if (mode === 'one') {
                  setTimeout(() => {
                    if (currentTrackRef.current) {
                      playTrackRef.current(currentTrackRef.current)
                    }
                  }, 0)
                } else if (mode === 'all') {
                  setTimeout(() => {
                    nextTrackRef.current()
                  }, 0)
                } else if (autoPlayNextRef.current) {
                  const q = queueRef.current
                  const idx = currentIndexRef.current
                  if (isShuffleRef.current || idx < q.length - 1) {
                    setTimeout(() => {
                      nextTrackRef.current()
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

    // Spotify webpage URLs cannot be played directly by HTML5 <audio>
    if (filePath.includes('spotify.com') || track.source === 'spotify') {
      if (filePath.includes('.mp3') || filePath.includes('p.scdn.co') || filePath.includes('preview')) {
        return filePath
      }
      return null
    }

    const driveFileId = extractDriveFileId(filePath)
    if (driveFileId) {
      return `/api/drive-stream?id=${encodeURIComponent(driveFileId)}`
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
          const restoredTrack = inferTrackSource(saved.track)
          const restoredTime = typeof saved.currentTime === 'number' ? saved.currentTime : 0
          const restoredQueue =
            Array.isArray(saved.queue) && saved.queue.length > 0
              ? saved.queue.map(inferTrackSource)
              : [restoredTrack]
          const restoredIndex = typeof saved.currentIndex === 'number' ? saved.currentIndex : 0
          const restoredVol = typeof saved.volume === 'number' ? saved.volume : 0.8

          setCurrentTrack(restoredTrack)
          setQueue(restoredQueue)
          setCurrentIndex(restoredIndex)
          setCurrentTime(restoredTime)
          setVolumeState(restoredVol)
          lastSavedTimeRef.current = restoredTime

          if (restoredTrack.source === 'youtube' && restoredTrack.youtube_id) {
            if (ytReadyRef.current && ytPlayerRef.current?.cueVideoById) {
              try {
                ytPlayerRef.current.cueVideoById({
                  videoId: restoredTrack.youtube_id,
                  startSeconds: restoredTime,
                })
              } catch (e) {}
            }
          } else {
            getAudioUrl(restoredTrack)
              .then((url) => {
                const audio = audioRef.current
                if (url && audio) {
                  const onLoaded = () => {
                    if (restoredTime > 0 && restoredTime < (audio.duration || Infinity)) {
                      audio.currentTime = restoredTime
                      setCurrentTime(restoredTime)
                    }
                    audio.removeEventListener('loadedmetadata', onLoaded)
                  }
                  audio.addEventListener('loadedmetadata', onLoaded)

                  audio.src = url
                  audio.volume = restoredVol
                  audio.load()

                  if (audio.readyState >= 1) {
                    onLoaded()
                  }
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

  const playTrack = async (
    rawTrack: Track,
    newQueue?: Track[],
    forceIndex?: number,
    startFromTime?: number
  ) => {
    const requestId = ++playRequestRef.current
    const track = inferTrackSource(rawTrack)

    // ⚡ 1. PAUSE CURRENT AUDIO IMMEDIATELY (ZERO DELAY ON STOPPING PREVIOUS TRACK)
    if (audioRef.current) {
      try { audioRef.current.pause() } catch {}
    }
    if (ytPlayerRef.current?.pauseVideo) {
      try { ytPlayerRef.current.pauseVideo() } catch {}
    }

    let nextQueue = queue
    let nextIndex = currentIndex

    if (newQueue) {
      nextQueue = deduplicateQueueTracks(newQueue)
      setQueue(nextQueue)
      const index = nextQueue.findIndex((t) => t.id === track.id)
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

    const initialTime = typeof startFromTime === 'number' && startFromTime >= 0 ? startFromTime : 0

    // ⚡ 2. UPDATE UI INSTANTLY (< 5ms)
    setCurrentTrack(track)
    setIsPlaying(true)
    setCurrentTime(initialTime)
    setDuration(track.duration || 0)
    setPlaybackError(null)
    savePlayerStateToStorage(track, initialTime, nextQueue, nextIndex, volume)

    // 🎵 Full-Length Stream Resolver for iTunes & Spotify tracks (Resolves DRM/metadata into 100% playable full song)
    let activeTrack = track
    if ((track.source === 'itunes' || track.source === 'spotify' || (!track.youtube_id && (track.spotify_id || track.itunes_id))) && !track.youtube_id) {
      // Synchronously unlock YouTube player user gesture before async fetch
      if (ytPlayerRef.current && ytPlayerRef.current.playVideo) {
        try { ytPlayerRef.current.playVideo() } catch {}
      }

      try {
        const cleanTitle = track.title.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()
        const queryStr = `${cleanTitle} ${track.artist || ''}`
        const data = await fetchUnifiedSearch(queryStr, 'youtube')
        if (requestId !== playRequestRef.current) return
        const ytList: Track[] = data.youtube || []
          let bestMatch = findBestYouTubeMatch(ytList, track.title, track.artist, track.duration, track.album)
          if (!bestMatch && ytList.length > 0) {
            bestMatch = ytList[0]
          }
          if (bestMatch && bestMatch.youtube_id) {
            const candidateDuration = bestMatch.duration || 0
            const isTargetShort = !track.duration || track.duration < 900
            if (!isTargetShort || candidateDuration <= 1200 || ytList.length === 1) {
              activeTrack = {
                ...track,
                youtube_id: bestMatch.youtube_id,
                source: 'youtube', // Switch audio engine to YouTube for 100% full-length playback
              }
              rawTrack.youtube_id = bestMatch.youtube_id
              track.youtube_id = bestMatch.youtube_id
              if (requestId === playRequestRef.current) {
                setCurrentTrack(activeTrack)
              }
            }
          }
      } catch (e) {
        console.warn('Full length resolution fallback:', e)
      }
    }

    if (requestId !== playRequestRef.current) return

    // Handle YouTube track playback (or resolved Spotify/iTunes track)
    if (activeTrack.source === 'youtube' && activeTrack.youtube_id) {
      if (audioRef.current) audioRef.current.pause()

      const tryLoadYt = (retries = 5) => {
        if (requestId !== playRequestRef.current) return
        if (ytPlayerRef.current && ytPlayerRef.current.loadVideoById) {
          try {
            ytPlayerRef.current.setVolume(volume * 100)
            ytPlayerRef.current.loadVideoById({
              videoId: activeTrack.youtube_id,
              startSeconds: initialTime,
            })
            setIsPlaying(true)
          } catch (e) {
            console.warn('YT loadVideoById error:', e)
          }
        } else if (retries > 0) {
          setTimeout(() => tryLoadYt(retries - 1), 100)
        }
      }
      tryLoadYt()
    } else {
      // Handle HTML5 / Audius audio playback
      if (ytPlayerRef.current && ytPlayerRef.current.pauseVideo) {
        try {
          ytPlayerRef.current.pauseVideo()
        } catch {}
      }

      let url: string | null = null
      try {
        url = await getAudioUrl(activeTrack)
      } catch (error: any) {
        if (requestId === playRequestRef.current) {
          setPlaybackError(error?.message || 'Không thể cấp quyền phát audio')
        }
        return
      }

      const audio = audioRef.current
      if (!url || !audio || requestId !== playRequestRef.current) {
        if (!url && requestId === playRequestRef.current) {
          setIsPlaying(false)
          setPlaybackError(`Bài hát "${activeTrack.title}" từ Spotify không hỗ trợ phát trực tiếp. Vui lòng chọn bài từ YouTube, Audius hoặc Thư viện.`)
        }
        return
      }

      audio.pause()
      audio.src = url
      audio.volume = volume
      if (initialTime > 0) {
        audio.currentTime = initialTime
      } else {
        audio.currentTime = 0
      }

      try {
        await audio.play()
        if (requestId !== playRequestRef.current) return
        setIsPlaying(true)
      } catch (err: any) {
        if (err?.name === 'AbortError' || String(err).includes('interrupted')) {
          return // Ignore play interruption silently
        }
        setIsPlaying(false)
        const message = err instanceof Error ? err.message : String(err)
        console.warn('Audio playback info:', { trackId: track.id, message })
        return
      }
    }

    // Record listening history in background for ALL sources (Local, iTunes, YouTube, Audius)
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

        let dbTrackId = track.id

        // If track is from an external global source (YouTube, Audius, iTunes),
        // upsert it into the DB tracks table first to get a valid UUID for listening_history!
        if (track.source && track.source !== 'local') {
          const { data: existing } = await supabase
            .from('tracks')
            .select('id')
            .eq('file_path', track.file_path)
            .maybeSingle()

          if (existing && existing.id) {
            dbTrackId = existing.id
          } else {
            const { data: inserted } = await supabase
              .from('tracks')
              .insert({
                user_id: userId,
                title: track.title,
                artist: track.artist || null,
                album: track.album || null,
                duration: track.duration || 0,
                file_path: track.file_path,
                cover_url: track.cover_url || null,
                created_at: new Date().toISOString(),
              })
              .select('id')
              .single()

            if (inserted && inserted.id) {
              dbTrackId = inserted.id
            } else {
              return
            }
          }
        }

        await supabase.from('listening_history').insert({
          user_id: userId,
          track_id: dbTrackId,
          played_at: new Date().toISOString(),
        })
      } catch (historyErr) {
        console.warn('History tracking error:', historyErr)
      }
    }, 100)
  }

  // Keep playTrackRef in sync so YouTube onStateChange closure always calls latest version
  playTrackRef.current = playTrack

  const togglePlay = async () => {
    if (!currentTrack) return

    const track = inferTrackSource(currentTrack)

    if (track.source === 'youtube') {
      if (isPlaying) {
        if (ytPlayerRef.current?.pauseVideo) {
          try {
            ytPlayerRef.current.pauseVideo()
          } catch {}
        }
        setIsPlaying(false)
      } else {
        if (ytPlayerRef.current && ytReadyRef.current) {
          try {
            const state = ytPlayerRef.current.getPlayerState ? ytPlayerRef.current.getPlayerState() : -1
            // 1 = playing, 2 = paused, 3 = buffering, 5 = video cued
            if (state === 5 || state === 2 || state === 1 || state === 3) {
              ytPlayerRef.current.playVideo()
              setIsPlaying(true)
              return
            }
          } catch (e) {
            console.warn('YT playVideo state check failed:', e)
          }
        }
        // Fallback: If YT player was unstarted (-1), empty, or not cued, start via playTrack
        await playTrack(track, queue, currentIndex, currentTime)
      }
      return
    }

    // HTML5 / Audius / Local / Spotify / iTunes tracks
    if (isPlaying) {
      if (audioRef.current) {
        audioRef.current.pause()
      }
      setIsPlaying(false)
    } else {
      const audio = audioRef.current
      if (!audio || !audio.src || audio.src === window.location.href || audio.error) {
        // If audio source is missing, invalid, or errored out (e.g. after reload)
        await playTrack(track, queue, currentIndex, currentTime)
        return
      }

      try {
        await audio.play()
        setIsPlaying(true)
      } catch (err: any) {
        if (err?.name === 'AbortError' || String(err).includes('interrupted')) {
          return
        }
        console.warn('audio.play() failed, re-loading track:', err)
        await playTrack(track, queue, currentIndex, currentTime)
      }
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
    const q = queueRef.current.length > 0 ? queueRef.current : queue
    const idx = currentIndexRef.current >= 0 ? currentIndexRef.current : currentIndex
    if (q.length === 0 || idx === -1) return

    let nextIdx = 0
    if (isShuffleRef.current && q.length > 1) {
      do {
        nextIdx = Math.floor(Math.random() * q.length)
      } while (nextIdx === idx && q.length > 1)
    } else {
      nextIdx = (idx + 1) % q.length
    }
    setCurrentIndex(nextIdx)
    playTrack(q[nextIdx], undefined, nextIdx)
  }

  const prevTrack = () => {
    const q = queueRef.current.length > 0 ? queueRef.current : queue
    const idx = currentIndexRef.current >= 0 ? currentIndexRef.current : currentIndex
    if (q.length === 0 || idx === -1) return

    // If current track has played for more than 3 seconds, restart it at 0:00 (standard player behavior)
    const activeTime = audioRef.current?.currentTime || currentTime
    if (activeTime > 3) {
      seek(0)
      return
    }

    let prevIdx = 0
    if (isShuffleRef.current && q.length > 1) {
      do {
        prevIdx = Math.floor(Math.random() * q.length)
      } while (prevIdx === idx && q.length > 1)
    } else {
      prevIdx = (idx - 1 + q.length) % q.length
    }
    setCurrentIndex(prevIdx)
    playTrack(q[prevIdx], undefined, prevIdx)
  }

  nextTrackRef.current = nextTrack
  prevTrackRef.current = prevTrack

  const addToQueue = (track: Track) => {
    setQueue((prev) => {
      const insertIdx = currentIndexRef.current >= 0 ? currentIndexRef.current + 1 : prev.length
      const newQ = [...prev]
      newQ.splice(insertIdx, 0, track)
      return newQ
    })
  }

  const removeFromQueue = (indexToRemove: number) => {
    setQueue((prev) => prev.filter((_, idx) => idx !== indexToRemove))
    if (currentIndex > indexToRemove) {
      setCurrentIndex((prev) => prev - 1)
    }
  }

  const clearQueue = () => {
    if (currentTrack) {
      setQueue([currentTrack])
      setCurrentIndex(0)
    } else {
      setQueue([])
      setCurrentIndex(-1)
    }
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

    const fallbackToYouTube = async (track: Track) => {
      try {
        const query = `${track.title} ${track.artist || ''}`.trim()
        const data = await fetchUnifiedSearch(query, 'youtube')
        const ytList: Track[] = data.youtube || []
          const bestMatch = findBestYouTubeMatch(ytList, track.title, track.artist, track.duration, track.album)
          if (bestMatch && bestMatch.youtube_id) {
            const candidateDuration = bestMatch.duration || 0
            const isTargetShort = !track.duration || track.duration < 900
            if (!isTargetShort || candidateDuration <= 1200) {
              const activeTrack: Track = {
                ...track,
                youtube_id: bestMatch.youtube_id,
                source: 'youtube',
              }
              setCurrentTrack(activeTrack)
              setPlaybackError(null)
              if (ytPlayerRef.current?.loadVideoById) {
                ytPlayerRef.current.setVolume(volume * 100)
                ytPlayerRef.current.loadVideoById(bestMatch.youtube_id)
                setIsPlaying(true)
                return
              }
            }
          }
      } catch (e) {
        console.warn('YouTube fallback failed:', e)
      }
      setIsPlaying(false)
      setPlaybackError('Không thể phát file nhạc này từ Google Drive hoặc YouTube.')
    }

    const handleLoadedMetadata = () => {
      if (currentTrackRef.current?.source !== 'youtube') {
        const loadedDuration = audio.duration || 0
        setDuration(loadedDuration)

        // Automatically skip short sound snippets / meme clips under 15 seconds
        if (loadedDuration > 0 && loadedDuration < 15) {
          console.warn('Track audio duration too short (< 15s), skipping automatically:', currentTrackRef.current?.title)
          nextTrackRef.current()
          return
        }

        if (currentTrackRef.current && loadedDuration > 0 && (!currentTrackRef.current.duration || currentTrackRef.current.duration === 0)) {
          const trackId = currentTrackRef.current.id
          currentTrackRef.current.duration = Math.round(loadedDuration)
          supabase.from('tracks').update({ duration: Math.round(loadedDuration) }).eq('id', trackId).then(() => {})
        }
      }
    }

    const handleError = async () => {
      if (currentTrackRef.current?.source !== 'youtube') {
        const current = currentTrackRef.current
        if (current && current.file_path) {
          await fallbackToYouTube(current)
          return
        }
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
        const mode = repeatModeRef.current
        if (mode === 'one') {
          if (audioRef.current) {
            audioRef.current.currentTime = 0
            audioRef.current.play().catch(() => {})
          }
        } else if (mode === 'all') {
          nextTrackRef.current()
        } else if (autoPlayNextRef.current) {
          const q = queueRef.current
          const idx = currentIndexRef.current
          if (isShuffleRef.current || idx < q.length - 1) {
            nextTrackRef.current()
          } else {
            setIsPlaying(false)
          }
        } else {
          setIsPlaying(false)
        }
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
  }, [currentIndex, queue, autoPlayNext, repeatMode])

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
        isShuffle,
        toggleShuffle,
        repeatMode,
        toggleRepeat,
        toggleFavoriteCurrentTrack,
        playbackError,
        playTrack,
        togglePlay,
        seek,
        setVolume,
        nextTrack,
        prevTrack,
        addToQueue,
        removeFromQueue,
        clearQueue,
        isQueueOpen,
        toggleQueue,
        closeQueue,
        audioRef,
      }}
    >
      {children}
      <audio ref={audioRef} preload="metadata" />
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
