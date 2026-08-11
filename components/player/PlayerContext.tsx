'use client'

import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Track } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { extractDriveFileId, isPreviewUrl, verifyDriveFile, triggerDrivePrewarm, getClientCdnCache } from '@/lib/googleDriveUpload'
import { useSession } from 'next-auth/react'
import { getValidUserId } from '@/lib/accessControl'
import { deduplicateQueueTracks } from '@/lib/utils'
import { resolveExternalTrackId, isExternalTrack } from '@/lib/trackPersistence'
import { findBestYouTubeMatch, normalizeTitle, extractYouTubeVideoId, fetchViewCountForVideo } from '@/lib/youtube'
import { fetchUnifiedSearch } from '@/lib/searchApi'
import { getSmartRecommendedTracks } from '@/lib/smartRecommend'
import { NextQueueResponse, queueTrackToTrack } from '@/types/queue'
import { getMusicOfftopicSegments, calculateIntroOffset } from '@/lib/sponsorblock'
import { isIOSDevice, playAudioElement, redactAudioSource, shouldUseHtml5Audio, toPersistedTrack } from '@/lib/audioPlayback'
import { getNhacCuaTuiStreamUrl, resolveNhacCuaTuiSong, resolveNhacCuaTuiTrack } from '@/lib/nhaccuatuiClient'
import { resolveStreamCached, invalidateStreamResolution } from '@/lib/resolveStreamClient'

export type RepeatMode = 'off' | 'all' | 'one'

// Tracks that can keep playing in the background (resolvable to a direct HTML5 stream
// without runtime matching). YouTube tracks resolve through the /api/youtube/stream proxy.
function isBackgroundPlayableTrack(t: Track | null | undefined): boolean {
  if (!t) return false
  if (t.youtube_id || t.source === 'youtube') return true
  if (t.nhaccuatui_id || t.source === 'nhaccuatui') return true
  if (t.drive_file_id || extractDriveFileId(t.file_path || '')) return true
  if (t.source === 'local') return true
  if (t.audio_url && t.audio_url.startsWith('http') && !isPreviewUrl(t.audio_url)) return true
  return false
}

// Inside a queue whose tracks all come from YouTube (a YouTube-sourced album/playlist),
// keep the original order — no background filtering, everything is stream-resolvable.
function isFullYouTubeQueue(q: Track[]): boolean {
  return q.length > 0 && q.every((t) => Boolean(t.youtube_id) || t.source === 'youtube')
}

interface PlayerContextType {
  currentTrack: Track | null
  isPlaying: boolean
  isBuffering: boolean
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
  mvIntroOffset: number
}

interface PlaybackProgressContextType {
  currentTime: number
  duration: number
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined)
const PlaybackProgressContext = createContext<PlaybackProgressContextType>({
  currentTime: 0,
  duration: 0,
})

export function usePlaybackProgress() {
  return useContext(PlaybackProgressContext)
}

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
        track: toPersistedTrack(track),
        currentTime: time,
        queue: trackQueue.map(toPersistedTrack),
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
  const [isBuffering, setIsBuffering] = useState<boolean>(false)
  const [queue, setQueue] = useState<Track[]>([])
  const [currentIndex, setCurrentIndex] = useState<number>(-1)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [duration, setDuration] = useState<number>(0)
  const [volume, setVolumeState] = useState<number>(0.8)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [mvIntroOffset, setMvIntroOffset] = useState<number>(0)

  // Fetch SponsorBlock MV Intro offset when track changes (Stage 2 & Stage 4)
  useEffect(() => {
    setMvIntroOffset(0) // Stage 4: reset immediately on track change
    if (!currentTrack) return

    const ytId =
      currentTrack.youtube_id ||
      extractYouTubeVideoId(currentTrack.file_path || '') ||
      (currentTrack.id?.startsWith('yt-') ? currentTrack.id.replace('yt-', '') : null)

    if (!ytId) return

    // Stage 2: Fire off async without blocking audio playback
    getMusicOfftopicSegments(ytId)
      .then((segments) => {
        const offset = calculateIntroOffset(segments)
        setMvIntroOffset(offset)
      })
      .catch(() => setMvIntroOffset(0))
  }, [currentTrack?.id])
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
  const audioRetryCountRef = useRef(0)
  const ytPlayerRef = useRef<any>(null)
  const ytReadyRef = useRef<boolean>(false)
  const ytStuckTimerRef = useRef<any>(null)
  const playRequestRef = useRef(0)
  const ytLoadedIdRef = useRef<string | null>(null)
  const pendingSeekRef = useRef<number | null>(null)
  // True when a YouTube-sourced track is playing through the HTML5 <audio> proxy
  // (iOS only — the iframe engine is paused by iOS when the screen locks/app backgrounds)
  const ytHtml5ModeRef = useRef<boolean>(false)

  const currentTrackRef = useRef<Track | null>(null)
  const queueRef = useRef<Track[]>([])
  const currentIndexRef = useRef<number>(-1)
  const volumeRef = useRef<number>(0.8)
  const lastSavedTimeRef = useRef<number>(0)
  const lastPrevClickRef = useRef<number>(0)
  const playedHistoryStackRef = useRef<Track[]>([])
  const forwardHistoryStackRef = useRef<Track[]>([])
  const isPrevNextActionRef = useRef<boolean>(false)
  const playTrackRef = useRef<
    (track: Track, newQueue?: Track[], forceIndex?: number, startFromTime?: number) => Promise<void>
  >(async () => {})
  const nextTrackRef = useRef<() => void>(() => {})
  const prevTrackRef = useRef<() => void>(() => {})
  const pendingResumeRef = useRef<boolean>(false)

  // "YouTube iframe engine active" — false when the same track streams via HTML5 audio (iOS background mode)
  const isYtIframeEngine = useCallback((): boolean => {
    const t = currentTrackRef.current
    return (t?.source === 'youtube' || Boolean(t?.youtube_id)) && !ytHtml5ModeRef.current
  }, [])

  const autoFetchSmartQueueRef = useRef(false)

  const recordListenEvent = useCallback((track: Track | null, completed: boolean, skipAtSeconds?: number) => {
    if (!track || !track.id) return
    fetch('/api/listen-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_id: track.id,
        artist: track.artist || null,
        completed,
        skip_at_seconds: typeof skipAtSeconds === 'number' ? Math.round(skipAtSeconds) : null,
      }),
    }).catch(() => {})
  }, [])

  const triggerSmartQueueFill = useCallback(async (seedTrack: Track, currentQ: Track[]) => {
    if (!seedTrack || autoFetchSmartQueueRef.current) return
    autoFetchSmartQueueRef.current = true
    try {
      const seedId = seedTrack.id
      const artist = seedTrack.artist || ''
      const title = seedTrack.title || ''
      const res = await fetch(
        `/api/queue/next?current_track_id=${encodeURIComponent(seedId)}&artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}&limit=12`
      )
      if (res.ok) {
        const data: NextQueueResponse = await res.json()
        if (data.tracks && data.tracks.length > 0) {
          const appTracks = data.tracks.map((qt) => queueTrackToTrack(qt))
          setQueue((prev) => deduplicateQueueTracks([...prev, ...appTracks]))
          return
        }
      }
      // Fallback if API returned empty
      const recs = await getSmartRecommendedTracks(seedTrack, currentQ, 8)
      if (recs && recs.length > 0) {
        setQueue((prev) => deduplicateQueueTracks([...prev, ...recs]))
      }
    } catch (err) {
      console.warn('Smart queue auto-fill error:', err)
      const recs = await getSmartRecommendedTracks(seedTrack, currentQ, 8).catch(() => [])
      if (recs && recs.length > 0) {
        setQueue((prev) => deduplicateQueueTracks([...prev, ...recs]))
      }
    } finally {
      autoFetchSmartQueueRef.current = false
    }
  }, [])

  const supabase = createClient()

  const audioUrlCacheRef = useRef<Map<string, { url: string; ts: number }>>(new Map())
  const URL_CACHE_TTL = 30 * 60 * 1000 // 30 mins

  // Cached catalog-track resolution (NCT/Drive/YouTube matching) so switching back to a
  // previously resolved track skips the slow network matching entirely.
  const trackResolutionCacheRef = useRef<Map<string, { activeTrack: Track; expiresAt: number }>>(new Map())
  const TRACK_RESOLUTION_TTL = 30 * 60 * 1000

  // Resolve audio URL for local and external tracks
  const getAudioUrl = useCallback(
    async (track: Track): Promise<string | null> => {
      const nctStreamUrl = getNhacCuaTuiStreamUrl(track)
      if (nctStreamUrl) return nctStreamUrl

      // iOS (Safari & Chrome): play YouTube through the HTML5 stream proxy so audio
      // keeps playing in the background — iOS pauses the iframe engine on lock/background.
      if (isIOSDevice() && track.youtube_id) {
        return `/api/youtube/stream?id=${encodeURIComponent(track.youtube_id)}`
      }

      if (track.source === 'audius' || track.audio_url) {
        return track.audio_url || track.file_path
      }

      // YouTube tracks use the IFrame engine. The old server-side audio proxy
      // relies on deprecated YouTube extraction clients.
      if (!shouldUseHtml5Audio(track)) return null

      const filePath = track.file_path || ''
      if (!filePath) return null

      // Spotify webpage URLs cannot be played directly by HTML5 <audio>
      if (filePath.includes('spotify.com') || track.source === 'spotify') {
        if (filePath.includes('.mp3') || filePath.includes('p.scdn.co') || filePath.includes('preview')) {
          return filePath
        }
        return null
      }

      const driveFileId = track.drive_file_id || extractDriveFileId(filePath)
      if (driveFileId) {
        const cachedDirectUrl = getClientCdnCache(driveFileId)
        if (cachedDirectUrl) {
          return cachedDirectUrl
        }
        const ext =
          track.file_ext ||
          track.title?.match(/\.(flac|mp3|wav|m4a|aac|ogg|wma)(?:[?#]|$)/i)?.[1]?.toLowerCase() ||
          ''
        const filenameParam = ext ? `&filename=${encodeURIComponent(`stream.${ext}`)}` : ''
        return `/api/drive-stream?id=${encodeURIComponent(driveFileId)}${filenameParam}&proxy=true`
      }

      let rawUrl: string | null = null
      if (filePath.startsWith('http')) {
        rawUrl = filePath
      } else {
        const { data, error } = await supabase.storage
          .from('music-files')
          .createSignedUrl(filePath, 3600)

        if (error || !data?.signedUrl) {
          const { data: pubData } = supabase.storage.from('music-files').getPublicUrl(filePath)
          rawUrl = pubData.publicUrl
        } else {
          rawUrl = data.signedUrl
        }
      }

      if (
        rawUrl &&
        rawUrl.startsWith('http://') &&
        !rawUrl.startsWith('http://localhost') &&
        !rawUrl.startsWith('http://127.0.0.1')
      ) {
        rawUrl = rawUrl.replace(/^http:\/\//i, 'https://')
      }

      return rawUrl
    },
    [supabase]
  )

  const getAudioUrlCached = useCallback(
    async (track: Track): Promise<string | null> => {
      if (!track || !track.id) return null
      // NCT URLs are signed and short-lived; always resolve them fresh.
      if (track.source === 'nhaccuatui') return getAudioUrl(track)
      const cached = audioUrlCacheRef.current.get(track.id)
      if (cached && Date.now() - cached.ts < URL_CACHE_TTL) {
        return cached.url
      }
      const url = await getAudioUrl(track)
      if (url) {
        audioUrlCacheRef.current.set(track.id, { url, ts: Date.now() })
      }
      return url
    },
    [getAudioUrl]
  )

  // Fire-and-forget prewarm & audio URL prefetch for upcoming tracks (prevents iOS background autoplay blocks)
  useEffect(() => {
    if (queue && queue.length > 0) {
      const upcoming = queue.slice(currentIndex, currentIndex + 6)
      triggerDrivePrewarm(upcoming)

      // Prefetch audio URLs for next 4 tracks into synchronous cache
      const nextTracks = queue.slice(currentIndex + 1, currentIndex + 5)
      for (const nextTr of nextTracks) {
        if (nextTr && nextTr.id && !audioUrlCacheRef.current.has(nextTr.id)) {
          getAudioUrlCached(nextTr).catch(() => {})
        }
      }

      // Also warm the CURRENT track's URL (e.g. YouTube stream on iOS runs yt-dlp server-side
      // in the background so the very first play doesn't wait for extraction).
      const currentTr = queue[currentIndex]
      if (currentTr && currentTr.id && !audioUrlCacheRef.current.has(currentTr.id)) {
        getAudioUrlCached(currentTr).catch(() => {})
      }
    }

    // Pre-resolve metadata/stream for next tracks to guarantee smooth background playback on mobile
    if (queue && queue.length > 0 && currentIndex >= 0) {
      for (let offset = 1; offset <= 3; offset++) {
        const nextIdx = currentIndex + offset
        if (nextIdx >= queue.length) break
        const nextTr = queue[nextIdx]
        const hasDirectPlayable = Boolean(
          nextTr.audio_url ||
          nextTr.drive_file_id ||
          extractDriveFileId(nextTr.file_path || '') ||
          nextTr.youtube_id ||
          (nextTr.file_path && (
            nextTr.file_path.includes('.mp3') ||
            nextTr.file_path.includes('preview') ||
            nextTr.file_path.includes('dzcdn.net') ||
            nextTr.file_path.includes('apple.com') ||
            nextTr.file_path.includes('drive-stream') ||
            nextTr.file_path.includes('audius')
          ))
        )

        if (!hasDirectPlayable && (nextTr.source === 'itunes' || nextTr.source === 'spotify' || nextTr.spotify_id || nextTr.itunes_id) && !(nextTr as any)._preResolving) {
          ;(nextTr as any)._preResolving = true
          const queryStr = `${nextTr.title.replace(/\([^)]*\)/g, '').trim()} ${nextTr.artist || ''}`.trim()
          fetchUnifiedSearch(queryStr, 'youtube').then((ytData) => {
            const ytList: Track[] = ytData?.youtube || []
            const bestMatch = findBestYouTubeMatch(ytList, nextTr.title, nextTr.artist, nextTr.duration, nextTr.album) || ytList[0]
            if (bestMatch && bestMatch.youtube_id) {
              setQueue((prevQ) =>
                prevQ.map((t, idx) => (idx === nextIdx ? { ...t, youtube_id: bestMatch.youtube_id, source: 'youtube' as const } : t))
              )
            }
          }).catch(() => {})
        }
      }
    }
  }, [queue, currentIndex, getAudioUrlCached])



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
        const resolvedId = await resolveExternalTrackId(supabase, currentTrack, userId)
        if (resolvedId) dbTrackId = resolvedId
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
          height: '1',
          width: '1',
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            playsinline: 1,
            enablejsapi: 1,
            rel: 0,
            origin: typeof window !== 'undefined' ? window.location.origin : '',
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
              const active = currentTrackRef.current
              // If active track is NOT a YouTube track, ensure YouTube player is stopped immediately
              if (active && active.source !== 'youtube') {
                if (ytStuckTimerRef.current) {
                  clearTimeout(ytStuckTimerRef.current)
                  ytStuckTimerRef.current = null
                }
                if (event.data === 1 || event.data === 3) {
                  try {
                    if (ytPlayerRef.current?.pauseVideo) ytPlayerRef.current.pauseVideo()
                    if (ytPlayerRef.current?.stopVideo) ytPlayerRef.current.stopVideo()
                  } catch {}
                }
                return
              }

              // YT.PlayerState.PLAYING = 1, PAUSED = 2, ENDED = 0, BUFFERING = 3
              if (event.data === 1) {
                if (ytStuckTimerRef.current) clearTimeout(ytStuckTimerRef.current)
                setIsPlaying(true)
                setIsBuffering(false)
                if (ytPlayerRef.current?.getDuration) {
                  setDuration(ytPlayerRef.current.getDuration() || 0)
                }
              } else if (event.data === 3) {
                setIsBuffering(true)
              } else if (event.data === 2) {
                if (ytStuckTimerRef.current) clearTimeout(ytStuckTimerRef.current)
                setIsBuffering(false)
                if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                  return
                }
                setIsPlaying(false)
              } else if (event.data === 0) {
                // Ignore ENDED events from a previously stopped video (rapid track switch)
                const loadedVideoId = ytLoadedIdRef.current
                const activeForEnded = currentTrackRef.current
                if (
                  loadedVideoId &&
                  activeForEnded &&
                  activeForEnded.youtube_id &&
                  activeForEnded.youtube_id !== loadedVideoId
                ) {
                  return
                }
                if (ytStuckTimerRef.current) clearTimeout(ytStuckTimerRef.current)
                setIsPlaying(false)
                recordListenEvent(currentTrackRef.current, true)
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
              } else if (event.data === -1 || event.data === 3 || event.data === 5) {
                // Cold-start watchdog: if stuck in cued/buffering/unstarted for > 800ms, auto-trigger playVideo() ONLY if active track is YouTube
                if (ytStuckTimerRef.current) clearTimeout(ytStuckTimerRef.current)
                ytStuckTimerRef.current = setTimeout(() => {
                  const currentActive = currentTrackRef.current
                  if (currentActive && currentActive.source === 'youtube' && ytPlayerRef.current && ytPlayerRef.current.playVideo) {
                    try {
                      ytPlayerRef.current.playVideo()
                    } catch (e) {}
                  }
                }, 800)
              }
            },
            onError: async (err: any) => {
              console.warn('YouTube Player Error:', err)
              const active = currentTrackRef.current
              const errorCode = err?.data
              const isEmbedError = errorCode === 150 || errorCode === 101 || errorCode === 100

              if (active && isEmbedError && !(active as any)._ytRetried) {
                console.log('[YouTube Fallback] Error 150/101/100 encountered, attempting automatic fallback match...')
                ;(active as any)._ytRetried = true
                try {
                  const queryStr = `${active.title} ${active.artist || ''}`.trim()
                  const searchRes = await fetchUnifiedSearch(queryStr, 'youtube')
                  const candidates = (searchRes?.youtube || []).filter((t: Track) => t.youtube_id && t.youtube_id !== active.youtube_id)
                  if (candidates.length > 0) {
                    const fallbackMatch = findBestYouTubeMatch(candidates, active.title, active.artist, active.duration, active.album) || candidates[0]
                    if (fallbackMatch && fallbackMatch.youtube_id) {
                      console.log('[YouTube Fallback] Swapping to alternative YouTube video:', fallbackMatch.youtube_id)
                      const updatedTrack = { ...active, youtube_id: fallbackMatch.youtube_id }
                      currentTrackRef.current = updatedTrack
                      setCurrentTrack(updatedTrack)
                      if (ytPlayerRef.current?.loadVideoById) {
                        ytLoadedIdRef.current = fallbackMatch.youtube_id
                        ytPlayerRef.current.loadVideoById({ videoId: fallbackMatch.youtube_id })
                        setIsPlaying(true)
                        setPlaybackError(null)
                        return
                      }
                    }
                  }
                } catch (fallbackErr) {
                  console.warn('YouTube fallback retry error:', fallbackErr)
                }
              }

              setPlaybackError(
                errorCode === 150 || errorCode === 101
                  ? 'Video này bị cấm nhúng phát ngoài YouTube. Vui lòng chọn bài khác.'
                  : 'Không thể phát video YouTube này'
              )
            },
          },
        })
      } catch (e) {
        console.warn('YT Player init exception:', e)
      }
    }
  }, [])

  // Sync YouTube Player timer when playing YouTube track (or Spotify/iTunes track resolved to YouTube stream)
  useEffect(() => {
    let interval: any = null
    const isYouTubeEngine = (currentTrack?.source === 'youtube' || Boolean(currentTrack?.youtube_id)) && !ytHtml5ModeRef.current
    if (isYouTubeEngine && isPlaying) {
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
      }, 150) // 150ms for ultra-responsive lyric scrolling & highlighting
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



  // Restore saved player state on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    const restoreRequestId = playRequestRef.current
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
          setQueue(deduplicateQueueTracks(restoredQueue))
          setCurrentIndex(restoredIndex)
          setCurrentTime(restoredTime)
          setDuration(restoredTrack.duration || 0)
          setVolumeState(restoredVol)
          lastSavedTimeRef.current = restoredTime

          if (restoredTrack.source === 'youtube' && restoredTrack.youtube_id && !ytHtml5ModeRef.current) {
            if (ytReadyRef.current && ytPlayerRef.current?.cueVideoById) {
              try {
                ytLoadedIdRef.current = restoredTrack.youtube_id
                ytPlayerRef.current.cueVideoById({
                  videoId: restoredTrack.youtube_id,
                  startSeconds: restoredTime,
                })
              } catch (e) {}
            }
          } else {
            const restoreTrack = restoredTrack.source === 'nhaccuatui' && restoredTrack.nhaccuatui_id
              ? resolveNhacCuaTuiSong(restoredTrack.nhaccuatui_id).then((song) => song ? {
                ...restoredTrack,
                title: song.title || restoredTrack.title,
                artist: song.artist || restoredTrack.artist,
                cover_url: restoredTrack.cover_url || song.coverUrl || null,
                duration: song.duration || restoredTrack.duration,
              } : restoredTrack)
              : Promise.resolve(restoredTrack)

            restoreTrack.then((playableTrack) => {
                if (playRequestRef.current !== restoreRequestId) return
                if (playableTrack !== restoredTrack) setCurrentTrack(playableTrack)
                return getAudioUrl(playableTrack)
              })
              .then((url) => {
                if (playRequestRef.current !== restoreRequestId) return
                const audio = audioRef.current
                if (url && audio) {
                  const onLoaded = () => {
                    if (restoredTime > 0 && restoredTime < (audio.duration || Infinity)) {
                      audio.currentTime = restoredTime
                      setCurrentTime(restoredTime)
                    }
                    if (audio.duration && !isNaN(audio.duration) && audio.duration > 0) {
                      setDuration(Math.round(audio.duration))
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
        if (currentTrackRef.current.source === 'youtube' && !ytHtml5ModeRef.current && ytPlayerRef.current?.getCurrentTime) {
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

  // Keep the service worker alive during playback (iOS Safari background audio)
  useEffect(() => {
    if (!isPlaying) return
    const ping = () => {
      if (navigator.serviceWorker?.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'KEEP_ALIVE' })
      }
    }
    ping()
    const timer = setInterval(ping, 20000)
    return () => clearInterval(timer)
  }, [isPlaying])

  const playTrack = async (
    rawTrack: Track,
    newQueue?: Track[],
    forceIndex?: number,
    startFromTime?: number
  ) => {
    const requestId = ++playRequestRef.current
    audioRetryCountRef.current = 0
    ytHtml5ModeRef.current = false
    const track = inferTrackSource(rawTrack)

    // 🚀 Push currentTrack onto true playback history stack when user changes track
    if (currentTrackRef.current && currentTrackRef.current.id !== track.id) {
      let activeTime = currentTime
      if (currentTrackRef.current.source === 'youtube' && !ytHtml5ModeRef.current && ytPlayerRef.current?.getCurrentTime) {
        try { activeTime = ytPlayerRef.current.getCurrentTime() || currentTime } catch {}
      } else if (audioRef.current) {
        activeTime = audioRef.current.currentTime || currentTime
      }
      const trackDur = currentTrackRef.current.duration || 0
      if (activeTime > 2 && (trackDur === 0 || activeTime < trackDur - 5)) {
        recordListenEvent(currentTrackRef.current, false, activeTime)
      }

      if (!isPrevNextActionRef.current) {
        playedHistoryStackRef.current.push(currentTrackRef.current)
        if (playedHistoryStackRef.current.length > 50) {
          playedHistoryStackRef.current.shift()
        }
      }
    }
    if (!isPrevNextActionRef.current) {
      forwardHistoryStackRef.current = []
    }
    isPrevNextActionRef.current = false

    // ⚡ 1. PAUSE & STOP ALL PREVIOUS AUDIO ENGINES IMMEDIATELY (ZERO DELAY OVERLAP)
    if (ytStuckTimerRef.current) {
      clearTimeout(ytStuckTimerRef.current)
      ytStuckTimerRef.current = null
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
        audioRef.current.removeAttribute('src')
        audioRef.current.load()
      } catch {}
    }
    if (ytPlayerRef.current) {
      try {
        if (ytPlayerRef.current.stopVideo) ytPlayerRef.current.stopVideo()
        if (ytPlayerRef.current.pauseVideo) ytPlayerRef.current.pauseVideo()
      } catch {}
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

    // Apply a seek the user performed while the track was still resolving
    const consumePendingSeek = (fallback: number): number => {
      const p = pendingSeekRef.current
      if (p !== null) {
        pendingSeekRef.current = null
        return p
      }
      return fallback
    }

    // Keep the queue row in sync with the resolved track so PlayerBar, QueueDrawer
    // and track rows all show the title/artist/cover of the website actually playing.
    const syncQueueEntry = (resolvedTrack: Track) => {
      if (nextIndex >= 0 && nextIndex < nextQueue.length) {
        const synced = [...nextQueue]
        synced[nextIndex] = { ...synced[nextIndex], ...resolvedTrack }
        nextQueue = synced
        setQueue(synced)
      }
    }

    // ⚡ 2. UPDATE UI INSTANTLY (< 5ms)
    setCurrentTrack(track)
    setIsPlaying(false)
    setIsBuffering(true)
    setCurrentTime(initialTime)
    setDuration(track.duration || 0)
    setPlaybackError(null)
    savePlayerStateToStorage(track, initialTime, nextQueue, nextIndex, volume)

    // 🧠 SMART AUTOPLAY: Automatically fill queue with matching genre & region tracks when starting track from main feed
    if (nextQueue.length <= 5) {
      triggerSmartQueueFill(track, nextQueue)
    }

    // 🎵 Full-Length Stream Resolver for iTunes & Spotify tracks (Resolves DRM/metadata into 100% playable full song)
    let activeTrack = track
    const isPreviewAudio = Boolean(
      (track.audio_url && (
        track.audio_url.includes('apple.com') ||
        track.audio_url.includes('dzcdn.net') ||
        track.audio_url.includes('p.scdn.co') ||
        track.audio_url.includes('mzstatic.com') ||
        track.audio_url.includes('preview')
      )) ||
      (track.file_path && (
        track.file_path.includes('apple.com') ||
        track.file_path.includes('dzcdn.net') ||
        track.file_path.includes('p.scdn.co') ||
        track.file_path.includes('mzstatic.com') ||
        track.file_path.includes('preview')
      )) ||
      track.source === 'itunes' ||
      track.source === 'spotify' ||
      (track as any).source === 'deezer'
    )

    const hasDirectPlayableAudio = !isPreviewAudio && Boolean(
      (track.audio_url && track.source !== 'nhaccuatui') ||
      track.drive_file_id ||
      extractDriveFileId(track.file_path || '') ||
      (track.file_path && (
        track.file_path.includes('drive-stream') ||
        track.file_path.includes('drive.google')
      ))
    )

    const shouldResolveExternalCatalog = (!hasDirectPlayableAudio || isPreviewAudio) && (
      (track.source === 'nhaccuatui' && Boolean(track.nhaccuatui_id)) ||
      track.source === 'itunes' ||
      track.source === 'spotify' ||
      (track as any).source === 'deezer' ||
      isPreviewAudio ||
      (!track.youtube_id && (track.spotify_id || track.itunes_id || track.nhaccuatui_id))
    ) && !track.youtube_id

    // ⚡ FAST-START: for catalog tracks with an immediate preview/direct URL, start audio
    // NOW (same call stack as the user gesture) and let the full-length resolution below
    // upgrade the source to the real stream when it's ready.
    if (isPreviewAudio && audioRef.current && requestId === playRequestRef.current) {
      const immediateUrl = (track.audio_url && track.audio_url.startsWith('http'))
        ? track.audio_url
        : (track.file_path && track.file_path.startsWith('http') ? track.file_path : null)
      if (immediateUrl) {
        try {
          audioRef.current.src = immediateUrl
          // Muted fast-start: keep the iOS gesture chain alive, but the 30s preview
          // must never become audible — the resolved full-length stream (or the preview
          // fallback path below) restores the real volume when it takes over.
          audioRef.current.volume = 0
          audioRef.current.play()
            .then(() => {
              if (requestId === playRequestRef.current) {
                setIsBuffering(false)
                setIsPlaying(true)
              }
            })
            .catch(() => {
              // Play rejected (e.g. iOS background autoplay block) — never leave the
              // element stuck muted, unless a newer play request owns the element now.
              if (requestId === playRequestRef.current && audioRef.current) {
                audioRef.current.volume = volumeRef.current
              }
            })
        } catch {}
      }
    }

    // ⚡ Fast path: reuse a previously resolved catalog match for this track.id
    const cachedResolution = shouldResolveExternalCatalog
      ? trackResolutionCacheRef.current.get(track.id)
      : undefined
    const useCachedResolution = cachedResolution && Date.now() < cachedResolution.expiresAt
    if (useCachedResolution && requestId === playRequestRef.current) {
      activeTrack = cachedResolution.activeTrack
      setCurrentTrack(activeTrack)
      syncQueueEntry(activeTrack)
    }

    if (shouldResolveExternalCatalog && !useCachedResolution) {
      // 🚀 Single-call resolution via /api/resolve-stream (L1→L2→full resolve)
      const resolved = await resolveStreamCached({
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        album: track.album,
      })

      if (requestId !== playRequestRef.current) return

      if (resolved) {
        if (resolved.source === 'nhaccuatui') {
          activeTrack = {
            ...track,
            source: 'nhaccuatui',
            nhaccuatui_id: resolved.id,
            title: resolved.title || track.title,
            artist: resolved.artist || track.artist,
            duration: resolved.duration || track.duration,
            cover_url: resolved.coverUrl || track.cover_url || null,
          }
        } else if (resolved.source === 'drive') {
          activeTrack = {
            ...track,
            source: 'local' as const,
            file_path: resolved.id,
            title: resolved.title || track.title,
            artist: resolved.artist || track.artist,
            duration: resolved.duration || track.duration,
            cover_url: resolved.coverUrl || track.cover_url || null,
            album: track.album || null,
            spotify_album_id: track.spotify_album_id || null,
          }
        } else if (resolved.source === 'youtube') {
          activeTrack = {
            ...track,
            youtube_id: resolved.id,
            source: 'youtube',
          }
          rawTrack.youtube_id = resolved.id
          track.youtube_id = resolved.id
          const isValidUUID = (id?: string) => Boolean(id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
          if (isValidUUID(track.id)) {
            supabase.from('tracks').update({ youtube_id: resolved.id }).eq('id', track.id).then((res: any) => {
              if (res?.error) console.warn('Failed to persist youtube_id:', res.error.message)
            })
          }
        }

        trackResolutionCacheRef.current.set(track.id, { activeTrack, expiresAt: Date.now() + TRACK_RESOLUTION_TTL })

        if (requestId === playRequestRef.current) {
          setCurrentTrack(activeTrack)
          syncQueueEntry(activeTrack)
        }
      }
    }

    if (requestId !== playRequestRef.current) return

    // 🎵 1. Try SYNCHRONOUS URL cache hit first (Zero-await gap for unbroken iOS Safari background playback gesture chain)
    let url: string | null = audioUrlCacheRef.current.get(activeTrack.id)?.url || null
    if (!url) {
      try {
        url = await getAudioUrlCached(activeTrack)
      } catch (error: any) {}
    }

    const audio = audioRef.current

    if (url && audio && requestId === playRequestRef.current) {
      ytHtml5ModeRef.current = isIOSDevice() && (activeTrack.source === 'youtube' || Boolean(activeTrack.youtube_id))
      // Note: intentionally NO audio.pause() here — pausing first can revoke the active
      // iOS audio session and make the following play() require a fresh user gesture.
      audio.src = url
      audio.volume = volume
      audio.currentTime = consumePendingSeek(initialTime > 0 ? initialTime : 0)

      try {
        await playAudioElement(audio)
        if (requestId !== playRequestRef.current) {
          audio.pause()
          return
        }
        setIsPlaying(true)
        return
      } catch (err: any) {
        if (err?.name === 'AbortError' || String(err).includes('interrupted')) {
          return // Ignore play interruption silently
        }
        setIsPlaying(false)
        setIsBuffering(false)
        if (isIOSDevice() && (err?.name === 'NotAllowedError' || String(err?.message || '').includes('not allowed'))) {
          // iOS background: play() needs a fresh user gesture. Keep the stream loaded and
          // resume on the next media-session action (lock-screen play button) or when visible.
          pendingResumeRef.current = true
          return
        }
        if (audioRef.current) {
          try {
            audioRef.current.pause()
            audioRef.current.removeAttribute('src')
          } catch {}
        }
        console.warn('HTML5 audio stream playback info:', err)
      }
    }

    // 🎬 Fallback Engine: YouTube IFrame Player (Used when direct audio stream proxy is unavailable)
    const ytId = activeTrack.youtube_id || (activeTrack.source === 'youtube' ? extractYouTubeVideoId(activeTrack.file_path || '') : null)
    if (ytId) {
      ytHtml5ModeRef.current = false
      if (audio) {
        try {
          audio.pause()
          audio.removeAttribute('src')
        } catch {}
      }

      const tryLoadYt = (retries = 5) => {
        if (requestId !== playRequestRef.current) return
        if (ytPlayerRef.current && ytPlayerRef.current.loadVideoById) {
          try {
            if (ytPlayerRef.current.unMute) ytPlayerRef.current.unMute()
            ytPlayerRef.current.setVolume(volume * 100)
            ytLoadedIdRef.current = ytId
            ytPlayerRef.current.loadVideoById({
              videoId: ytId,
              startSeconds: consumePendingSeek(initialTime),
            })
            if (ytPlayerRef.current.playVideo) {
              try { ytPlayerRef.current.playVideo() } catch {}
            }
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
      if (requestId === playRequestRef.current) {
        setIsPlaying(false)
        setPlaybackError(`Bài hát "${activeTrack.title}" không hỗ trợ phát trực tiếp. Vui lòng chọn bài khác.`)
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

        // If track is from an external global source, upsert it into the DB tracks table
        // first to get a valid UUID for listening_history.
        if (isExternalTrack(track)) {
          const resolvedId = await resolveExternalTrackId(supabase, track, userId)
          if (!resolvedId) return
          dbTrackId = resolvedId
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

    if (track.source === 'youtube' && !ytHtml5ModeRef.current) {
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

    const isYouTubeEngine = (currentTrack?.source === 'youtube' || Boolean(currentTrack?.youtube_id)) && !ytHtml5ModeRef.current
    const audio = audioRef.current
    const ytEngine = isYouTubeEngine && ytPlayerRef.current?.seekTo
    if (ytEngine && currentTrackRef.current?.youtube_id === ytLoadedIdRef.current) {
      try {
        ytPlayerRef.current.seekTo(time, true)
      } catch {}
    } else if (audio && audio.src) {
      audio.currentTime = time
    } else {
      // Track still resolving — apply the seek once playback starts
      pendingSeekRef.current = time
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

  // ⚡ Fast-path: play a track synchronously from the URL cache so lock-screen / background
  // next/prev actions keep their iOS user-gesture chain (no awaits before play()).
  const tryQuickPlayFromCache = (track: Track, idx?: number): boolean => {
    if (!track || typeof window === 'undefined') return false
    const cached = audioUrlCacheRef.current.get(track.id)?.url
    const audio = audioRef.current
    if (!cached || !audio) return false

    // Cancel any pending async play requests
    playRequestRef.current++

    // Stop the YouTube iframe engine if it was active
    if (ytStuckTimerRef.current) {
      clearTimeout(ytStuckTimerRef.current)
      ytStuckTimerRef.current = null
    }
    if (ytPlayerRef.current) {
      try {
        if (ytPlayerRef.current.stopVideo) ytPlayerRef.current.stopVideo()
        else if (ytPlayerRef.current.pauseVideo) ytPlayerRef.current.pauseVideo()
      } catch {}
    }

    // Resolve the queue index (track id-based lookup, falls back to the provided index)
    const q = queueRef.current.length > 0 ? queueRef.current : queue
    let targetIdx = typeof idx === 'number' && idx >= 0 ? idx : q.findIndex((t) => t.id === track.id)
    if (targetIdx < 0) targetIdx = currentIndexRef.current
    currentIndexRef.current = targetIdx
    setCurrentIndex(targetIdx)

    ytHtml5ModeRef.current = isIOSDevice() && (track.source === 'youtube' || Boolean(track.youtube_id))

    setCurrentTrack(track)
    if (targetIdx >= 0 && targetIdx < q.length) {
      setQueue((prevQ) => {
        const synced = [...prevQ]
        synced[targetIdx] = { ...synced[targetIdx], ...track }
        return synced
      })
    }
    setCurrentTime(0)
    setDuration(track.duration || 0)
    setPlaybackError(null)
    setIsBuffering(true)
    savePlayerStateToStorage(track, 0, q, targetIdx, volume)

    // Swap src WITHOUT pausing first (pausing can revoke the active iOS audio session / gesture chain)
    audio.src = cached
    audio.volume = volumeRef.current || volume
    audio.currentTime = 0

    audio.play()
      .then(() => {
        setIsBuffering(false)
        setIsPlaying(true)
        audioRetryCountRef.current = 0
      })
      .catch((err: any) => {
        setIsBuffering(false)
        setIsPlaying(false)
        // On iOS background, play() without a fresh gesture is rejected — keep src loaded
        // and let the next media-session action / visibility retry resume it.
        if (err?.name === 'NotAllowedError' || String(err?.message || '').includes('not allowed')) {
          pendingResumeRef.current = true
        } else {
          console.warn('Quick-play audio failed:', err?.message || err)
        }
      })

    return true
  }

  const nextTrack = () => {
    isPrevNextActionRef.current = true

    // 🚀 STEP 1: Check forward history stack first (if user clicked Previous earlier)
    if (forwardHistoryStackRef.current.length > 0) {
      const forwardSong = forwardHistoryStackRef.current.pop()
      if (forwardSong) {
        if (currentTrackRef.current) {
          playedHistoryStackRef.current.push(currentTrackRef.current)
        }
        if (!tryQuickPlayFromCache(forwardSong)) playTrack(forwardSong)
        return
      }
    }

    // STEP 2: Fallback to queue if forward history is empty
    const q = queueRef.current.length > 0 ? queueRef.current : queue
    if (q.length === 0) return

    let idx = currentIndexRef.current >= 0 ? currentIndexRef.current : currentIndex
    if (idx < 0) {
      if (currentTrackRef.current) {
        idx = q.findIndex((t) => t.id === currentTrackRef.current?.id)
      }
      if (idx < 0) idx = 0
    }

    let nextIdx = 0
    const preserveOrder = isFullYouTubeQueue(q)
    if (isShuffleRef.current && q.length > 1) {
      // Random pick, preferring tracks that can play in the background (skip the rest)
      let found = -1
      for (let attempt = 0; attempt < 20; attempt++) {
        const cand = Math.floor(Math.random() * q.length)
        if (cand === idx) continue
        if (preserveOrder || isBackgroundPlayableTrack(q[cand])) {
          found = cand
          break
        }
      }
      if (found < 0) {
        do {
          nextIdx = Math.floor(Math.random() * q.length)
        } while (nextIdx === idx && q.length > 1)
      } else {
        nextIdx = found
      }
    } else {
      // Sequential: advance to the next track that can play in the background,
      // unless this is a full-YouTube queue (keep strict album/playlist order).
      nextIdx = -1
      for (let step = 1; step <= q.length; step++) {
        const cand = (idx + step) % q.length
        if (preserveOrder || isBackgroundPlayableTrack(q[cand])) {
          nextIdx = cand
          break
        }
      }
      // Wrapped back to the current track (no other background-playable track) → keep original behavior
      if (nextIdx === idx) nextIdx = (idx + 1) % q.length
      if (nextIdx < 0) nextIdx = (idx + 1) % q.length
    }
    if (tryQuickPlayFromCache(q[nextIdx], nextIdx)) {
      if (nextIdx >= q.length - 2) {
        triggerSmartQueueFill(q[nextIdx], q)
      }
      return
    }
    setCurrentIndex(nextIdx)
    currentIndexRef.current = nextIdx
    playTrack(q[nextIdx], undefined, nextIdx)

    // Auto-fetch next batch of matching recommendations when queue is near end
    if (nextIdx >= q.length - 2) {
      triggerSmartQueueFill(q[nextIdx], q)
    }
  }

  const prevTrack = () => {
    isPrevNextActionRef.current = true

    const now = Date.now()
    const isRecentClick = now - lastPrevClickRef.current < 2500
    lastPrevClickRef.current = now

    // Determine current play time across YouTube & HTML5 engines
    let activeTime = currentTime
    if ((currentTrackRef.current?.source === 'youtube' || currentTrackRef.current?.youtube_id) && !ytHtml5ModeRef.current) {
      if (ytPlayerRef.current?.getCurrentTime) {
        try {
          activeTime = ytPlayerRef.current.getCurrentTime() || currentTime
        } catch {}
      }
    } else if (audioRef.current) {
      activeTime = audioRef.current.currentTime || currentTime
    }

    // If played > 3 seconds AND not clicked recently, restart track at 0:00.
    if (activeTime > 3 && !isRecentClick) {
      seek(0)
      return
    }

    // 🚀 STEP 1: Pop and play true previously played track from history stack!
    if (playedHistoryStackRef.current.length > 0) {
      const prevSong = playedHistoryStackRef.current.pop()
      if (prevSong) {
        if (currentTrackRef.current) {
          forwardHistoryStackRef.current.push(currentTrackRef.current)
        }
        if (!tryQuickPlayFromCache(prevSong)) playTrack(prevSong)
        return
      }
    }

    // STEP 2: Fallback to queue if history stack is empty
    const q = queueRef.current.length > 0 ? queueRef.current : queue
    if (q.length === 0) return

    let idx = currentIndexRef.current >= 0 ? currentIndexRef.current : currentIndex
    if (idx < 0) {
      if (currentTrackRef.current) {
        idx = q.findIndex((t) => t.id === currentTrackRef.current?.id)
      }
      if (idx < 0) idx = 0
    }

    let prevIdx = 0
    if (isShuffleRef.current && q.length > 1) {
      do {
        prevIdx = Math.floor(Math.random() * q.length)
      } while (prevIdx === idx && q.length > 1)
    } else {
      prevIdx = (idx - 1 + q.length) % q.length
    }
    if (tryQuickPlayFromCache(q[prevIdx], prevIdx)) return
    setCurrentIndex(prevIdx)
    currentIndexRef.current = prevIdx
    playTrack(q[prevIdx], undefined, prevIdx)
  }

  nextTrackRef.current = nextTrack
  prevTrackRef.current = prevTrack

  const addToQueue = (track: Track) => {
    setQueue((prev) => {
      const insertIdx = currentIndexRef.current >= 0 ? currentIndexRef.current + 1 : prev.length
      const newQ = [...prev]
      newQ.splice(insertIdx, 0, track)
      return deduplicateQueueTracks(newQ)
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
      if (!isYtIframeEngine()) {
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
        if (currentTrackRef.current?.id !== track.id) return
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
      if (!isYtIframeEngine()) {
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
      if (!isYtIframeEngine()) {
        const current = currentTrackRef.current
        const erroredTrack = current
        if (audioRetryCountRef.current < 2) {
          audioRetryCountRef.current++
          setTimeout(() => {
            if (erroredTrack && currentTrackRef.current?.id !== erroredTrack.id) return
            if (audioRef.current) {
              audioRef.current.load()
              audioRef.current.play().catch(() => {})
            }
          }, 500 * audioRetryCountRef.current)
          return
        }
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
      if (!isYtIframeEngine()) {
        recordListenEvent(currentTrackRef.current, true)
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

    const handleWaiting = () => setIsBuffering(true)
    const handleStalled = () => setIsBuffering(true)
    const handleLoadStart = () => setIsBuffering(true)
    const handleCanPlay = () => {
      setIsBuffering(false)
      // Retry a background play() that was rejected by iOS for lacking a fresh gesture
      if (pendingResumeRef.current && audioRef.current && audioRef.current.paused) {
        pendingResumeRef.current = false
        audioRef.current.play().catch(() => {
          pendingResumeRef.current = true
        })
      }
    }
    const handlePlaying = () => {
      setIsBuffering(false)
      audioRetryCountRef.current = 0
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && pendingResumeRef.current && audioRef.current && audioRef.current.paused) {
        pendingResumeRef.current = false
        audioRef.current.play().catch(() => {
          pendingResumeRef.current = true
        })
      }
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)
    audio.addEventListener('waiting', handleWaiting)
    audio.addEventListener('stalled', handleStalled)
    audio.addEventListener('loadstart', handleLoadStart)
    audio.addEventListener('canplay', handleCanPlay)
    audio.addEventListener('playing', handlePlaying)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
      audio.removeEventListener('waiting', handleWaiting)
      audio.removeEventListener('stalled', handleStalled)
      audio.removeEventListener('loadstart', handleLoadStart)
      audio.removeEventListener('canplay', handleCanPlay)
      audio.removeEventListener('playing', handlePlaying)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [currentIndex, queue, autoPlayNext, repeatMode])

  // On-demand fetch view_count for current track if youtube_id exists and view_count is null
  useEffect(() => {
    if (!currentTrack || !currentTrack.youtube_id || currentTrack.view_count != null) return

    let cancelled = false
    const ytId = currentTrack.youtube_id

    fetchViewCountForVideo(ytId).then((views) => {
      if (!cancelled && views != null) {
        setCurrentTrack((prev) => (prev && prev.youtube_id === ytId ? { ...prev, view_count: views } : prev))
        setQueue((prevQueue) =>
          prevQueue.map((t) => (t.youtube_id === ytId ? { ...t, view_count: views } : t))
        )
      }
    }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [currentTrack?.id, currentTrack?.youtube_id, currentTrack?.view_count])

  // Media Session API Sync (Lock Screen Controls & Mobile Background Playback)
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator) || !currentTrack) return

    try {
      const origin = window.location.origin
      const rawCover = currentTrack.cover_url || ''
      const coverSrc = rawCover
        ? rawCover.startsWith('http')
          ? rawCover
          : `${origin}${rawCover}`
        : `${origin}/favicon.ico`

      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist || 'Nghệ sĩ chưa xác định',
        album: currentTrack.album || 'MusicWeb Studio',
        artwork: [
          { src: coverSrc, sizes: '96x96', type: 'image/png' },
          { src: coverSrc, sizes: '128x128', type: 'image/png' },
          { src: coverSrc, sizes: '192x192', type: 'image/png' },
          { src: coverSrc, sizes: '256x256', type: 'image/png' },
          { src: coverSrc, sizes: '384x384', type: 'image/png' },
          { src: coverSrc, sizes: '512x512', type: 'image/png' },
        ],
      })

      navigator.mediaSession.setActionHandler('play', () => {
        void (async () => {
          const isYouTube = (currentTrackRef.current?.source === 'youtube' || Boolean(currentTrackRef.current?.youtube_id)) && !ytHtml5ModeRef.current
          if (isYouTube && ytPlayerRef.current?.playVideo) {
            try {
              ytPlayerRef.current.playVideo()
              setIsPlaying(true)
            } catch (err) {
              setIsPlaying(false)
              console.warn('Media Session YouTube play failed:', err)
            }
            return
          }

          if (!audioRef.current) return

          try {
            await playAudioElement(audioRef.current)
            setIsPlaying(true)
          } catch (err) {
            setIsPlaying(false)
            console.warn('Media Session audio play failed:', err)
          }
        })()
      })

      navigator.mediaSession.setActionHandler('pause', () => {
        const isYouTube = (currentTrackRef.current?.source === 'youtube' || Boolean(currentTrackRef.current?.youtube_id)) && !ytHtml5ModeRef.current
        if (isYouTube && ytPlayerRef.current?.pauseVideo) {
          try { ytPlayerRef.current.pauseVideo() } catch {}
        } else if (audioRef.current) {
          audioRef.current.pause()
        }
        setIsPlaying(false)
      })

      navigator.mediaSession.setActionHandler('previoustrack', () => prevTrackRef.current())
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrackRef.current())

      try {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime !== undefined) seek(details.seekTime)
        })
      } catch (e) {}

      // iOS hides next/prev track buttons when seekbackward/seekforward are registered,
      // so on iOS we only register the skip buttons (next/prev) and let the scrubber handle seeking.
      if (!isIOSDevice()) {
        try {
          navigator.mediaSession.setActionHandler('seekbackward', (details) => {
            const skip = details.seekOffset || 10
            if (!ytHtml5ModeRef.current && ytPlayerRef.current?.getCurrentTime) {
              try {
                const cur = ytPlayerRef.current.getCurrentTime() || 0
                seek(Math.max(cur - skip, 0))
                return
              } catch {}
            }
            if (audioRef.current) {
              seek(Math.max(audioRef.current.currentTime - skip, 0))
            }
          })
        } catch (e) {}

        try {
          navigator.mediaSession.setActionHandler('seekforward', (details) => {
            const skip = details.seekOffset || 10
            if (!ytHtml5ModeRef.current && ytPlayerRef.current?.getCurrentTime) {
              try {
                const cur = ytPlayerRef.current.getCurrentTime() || 0
                const dur = ytPlayerRef.current.getDuration() || 0
                seek(Math.min(cur + skip, dur))
                return
              } catch {}
            }
            if (audioRef.current) {
              seek(Math.min(audioRef.current.currentTime + skip, audioRef.current.duration || 0))
            }
          })
        } catch (e) {}
      }

      try {
        navigator.mediaSession.setActionHandler('stop', () => {
          const isYouTube = (currentTrackRef.current?.source === 'youtube' || Boolean(currentTrackRef.current?.youtube_id)) && !ytHtml5ModeRef.current
          if (isYouTube && ytPlayerRef.current?.pauseVideo) {
            try { ytPlayerRef.current.pauseVideo() } catch {}
          }
          if (audioRef.current) {
            audioRef.current.pause()
          }
          setIsPlaying(false)
        })
      } catch (e) {}
    } catch (err) {
      console.warn('MediaSession init error:', err)
    }
  }, [currentTrack])

  // Playback state & position — throttled to once per second to avoid overhead
  const lastPositionUpdateRef = useRef<number>(0)
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator) || !currentTrack) return

    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'

      const now = Date.now()
      if ('setPositionState' in navigator.mediaSession && duration > 0 && currentTime >= 0 && (now - lastPositionUpdateRef.current > 1000)) {
        lastPositionUpdateRef.current = now
        try {
          navigator.mediaSession.setPositionState({
            duration: Math.max(duration, 0),
            playbackRate: 1,
            position: Math.min(Math.max(currentTime, 0), duration),
          })
        } catch (e) {}
      }
    } catch (err) {
      // silently ignore
    }
  }, [currentTrack, isPlaying, currentTime, duration])



  const effectiveDuration = duration > 0 ? duration : (currentTrack?.duration || 0)

  const progressValue = useMemo(() => ({ currentTime, duration: effectiveDuration }), [currentTime, duration, currentTrack?.duration])

  const playerValue = useMemo(
    () => ({
      currentTrack,
      isPlaying,
      isBuffering,
      queue,
      currentIndex,
      currentTime,
      duration: effectiveDuration,
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
      mvIntroOffset,
    }),
    [
      currentTrack,
      isPlaying,
      isBuffering,
      queue,
      currentIndex,
      volume,
      isShuffle,
      repeatMode,
      playbackError,
      isQueueOpen,
      mvIntroOffset,
      toggleShuffle,
      toggleRepeat,
      toggleFavoriteCurrentTrack,
      playTrack,
      togglePlay,
      seek,
      setVolume,
      nextTrack,
      prevTrack,
      addToQueue,
      removeFromQueue,
      clearQueue,
      toggleQueue,
      closeQueue,
    ]
  )

  // Toggle data-buffering attribute on document element for cursor/UI feedback
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (isBuffering) {
      document.documentElement.setAttribute('data-buffering', 'true')
    } else {
      document.documentElement.removeAttribute('data-buffering')
    }
  }, [isBuffering])

  return (
    <PlayerContext.Provider value={playerValue}>
      <PlaybackProgressContext.Provider value={progressValue}>
        {children}
        {/* preload="auto" — buffer audio frames. webkit-playsinline for iOS background audio */}
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio
          ref={audioRef}
          preload="auto"
          playsInline
          {...({'webkit-playsinline': ''} as any)}
          onWaiting={() => setIsBuffering(true)}
          onStalled={() => setIsBuffering(true)}
          onLoadStart={() => setIsBuffering(true)}
          onCanPlay={() => setIsBuffering(false)}
          onPlaying={() => setIsBuffering(false)}
        />
        {/* Hidden YouTube Player IFrame container (Must have non-zero dimensions to prevent YouTube SDK 4s auto-pause) */}
        <div className="fixed top-0 left-0 w-1 h-1 opacity-0 pointer-events-none overflow-hidden -z-50">
          <div id="yt-player-container" />
        </div>
      </PlaybackProgressContext.Provider>
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
