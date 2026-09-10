'use client'

import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Track } from '@/types'
import { createClient } from '@/lib/supabase/client'
import { extractDriveFileId, isPreviewUrl, verifyDriveFile, triggerDrivePrewarm, getClientCdnCache, buildDriveStreamUrl } from '@/lib/googleDriveUpload'
import { useSession } from 'next-auth/react'
import { getValidUserId } from '@/lib/accessControl'
import { deduplicateQueueTracks } from '@/lib/utils'
import { resolveExternalTrackId, isExternalTrack } from '@/lib/trackPersistence'
import { findBestYouTubeMatch, extractYouTubeVideoId, fetchViewCountForVideo } from '@/lib/youtube'
import { fetchUnifiedSearch } from '@/lib/searchApi'
import { getSmartRecommendedTracks } from '@/lib/smartRecommend'
import { NextQueueResponse, queueTrackToTrack } from '@/types/queue'
import { getMusicOfftopicSegments, calculateIntroOffset } from '@/lib/sponsorblock'
import { isIOSDevice, playAudioElement, shouldUseHtml5Audio } from '@/lib/audioPlayback'
import { isCurrentPlayback } from '@/lib/playbackRaceGuards'
import { getNhacCuaTuiStreamUrl, resolveNhacCuaTuiSong, resolveNhacCuaTuiTrack, prewarmNctStreamUrl, getCachedNctStreamUrl, clearCachedNctStreamUrl } from '@/lib/nhaccuatuiClient'
import { prewarmTrackBatch } from '@/lib/prewarmTrackBatch'
import { isFastConnection } from './prewarmAdaptive'
import { toMinimalPersistedTrack, PlaybackPersistenceScheduler } from './playbackPersistenceScheduler'
import { resolveStreamCached, invalidateStreamResolution } from '@/lib/resolveStreamClient'
import { saveStreamUrl, getStreamUrl, saveTrackResolution, getTrackResolution, getCachedYouTubeId, savePlaybackState, loadPlaybackState } from '@/lib/playbackPersistence'
import { setAudioSourceForPlayback } from './audioSourceSwitch'
import {
  classifyTrack,
  inferTrackSource,
  isBackgroundPlayableTrack,
  isFullYouTubeQueue,
} from '@/lib/trackSourceClassifier'
import { Html5AudioEngine, YouTubeIframeEngine } from './engines'
import { buildYouTubeStreamUrl } from '@/lib/youtubeStreamUrl'

export { isBackgroundPlayableTrack, isFullYouTubeQueue, inferTrackSource }
export type RepeatMode = 'off' | 'all' | 'one'

export const DEFAULT_VOLUME = 0.8
export const MAX_CONSECUTIVE_SKIPS = 4
export const AUDIO_STALL_WATCHDOG_TIMEOUT_MS = 6500

export interface PlayerControlsContextType {
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
  toggleShuffle: () => void
  toggleRepeat: () => void
  toggleFavoriteCurrentTrack: () => Promise<void>
  addToQueue: (track: Track) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  toggleQueue: () => void
  closeQueue: () => void
  toggleNowPlayingOverlay: () => void
  openNowPlayingOverlay: () => void
  closeNowPlayingOverlay: () => void
}

export interface PlayerTrackContextType {
  currentTrack: Track | null
  isPlaying: boolean
  isBuffering: boolean
  volume: number
  isShuffle: boolean
  repeatMode: RepeatMode
  playbackError: string | null
  frequencyData: Uint8Array
  audioRef: React.RefObject<HTMLAudioElement | null>
  mvIntroOffset: number
}

export interface PlayerQueueContextType {
  queue: Track[]
  currentIndex: number
  isQueueOpen: boolean
  isNowPlayingOpen: boolean
  addToQueue: (track: Track) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
}

export interface PlayerContextType extends PlayerTrackContextType, PlayerControlsContextType {
  queue: Track[]
  currentIndex: number
  isQueueOpen: boolean
  isNowPlayingOpen: boolean
}

interface PlaybackProgressContextType {
  currentTime: number
  duration: number
}

const PlayerControlsContext = createContext<PlayerControlsContextType | undefined>(undefined)
const PlayerTrackContext = createContext<PlayerTrackContextType | undefined>(undefined)
const PlayerQueueContext = createContext<PlayerQueueContextType | undefined>(undefined)
const PlayerContext = createContext<PlayerContextType | undefined>(undefined)
const PlaybackProgressContext = createContext<PlaybackProgressContextType>({
  currentTime: 0,
  duration: 0,
})

export function usePlayerControls() {
  const context = useContext(PlayerControlsContext)
  if (!context) {
    throw new Error('usePlayerControls must be used within a PlayerProvider')
  }
  return context
}

export function usePlayerTrack() {
  const context = useContext(PlayerTrackContext)
  if (!context) {
    throw new Error('usePlayerTrack must be used within a PlayerProvider')
  }
  return context
}

export function usePlayerQueue() {
  const context = useContext(PlayerQueueContext)
  if (!context) {
    throw new Error('usePlayerQueue must be used within a PlayerProvider')
  }
  return context
}

export function usePlaybackProgress() {
  return useContext(PlaybackProgressContext)
}

const persistenceScheduler = new PlaybackPersistenceScheduler()

const savePlayerStateToStorage = (
  track: Track | null,
  time: number,
  trackQueue: Track[],
  index: number,
  vol: number,
  immediate: boolean = false
) => {
  if (!track) return
  const payload = {
    track,
    currentTime: time,
    queue: trackQueue,
    currentIndex: index,
    volume: vol,
  }
  if (immediate) {
    persistenceScheduler.saveImmediate(payload)
  } else {
    persistenceScheduler.scheduleDebounced(payload)
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
  const [isBuffering, setIsBufferingState] = useState<boolean>(false)
  const isBufferingRef = useRef<boolean>(false)
  const setIsBuffering = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    setIsBufferingState((prev) => {
      const next = typeof val === 'function' ? val(prev) : val
      isBufferingRef.current = next
      return next
    })
  }, [])
  const [queue, setQueue] = useState<Track[]>([])
  const [currentIndex, setCurrentIndex] = useState<number>(-1)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [duration, setDuration] = useState<number>(0)
  const [volume, setVolumeState] = useState<number>(0.8)
  const [playbackError, setPlaybackError] = useState<string | null>(null)
  const [mvIntroOffset, setMvIntroOffset] = useState<number>(0)
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState<boolean>(false)
  const frequencyData = React.useMemo(() => new Uint8Array(16), [])

  const toggleNowPlayingOverlay = useCallback(() => setIsNowPlayingOpen((prev) => !prev), [])
  const openNowPlayingOverlay = useCallback(() => setIsNowPlayingOpen(true), [])
  const closeNowPlayingOverlay = useCallback(() => setIsNowPlayingOpen(false), [])

  useEffect(() => {
    if (!isPlaying) {
      frequencyData.fill(0)
      return
    }
    let animId: number

    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        // Tab hidden — skip fake frequency computation (no visual consumers)
        animId = requestAnimationFrame(tick)
        return
      }
      const now = Date.now() / 120
      for (let i = 0; i < 16; i++) {
        frequencyData[i] = Math.floor(Math.sin(now + i * 0.8) * 80 + 150 + Math.random() * 25)
      }
      animId = requestAnimationFrame(tick)
    }

    animId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animId)
  }, [isPlaying, frequencyData])

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
  const currentTimeRef = useRef<number>(0)

  const toggleQueue = useCallback(() => setIsQueueOpen((prev) => !prev), [])
  const closeQueue = useCallback(() => setIsQueueOpen(false), [])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const isWebAudioConnectedRef = useRef<boolean>(false)
  const audioRetryCountRef = useRef(0)
  const ytPlayerRef = useRef<any>(null)
  const ytReadyRef = useRef<boolean>(false)
  const ytStuckTimerRef = useRef<any>(null)
  const playRequestRef = useRef(0)
  const ytLoadedIdRef = useRef<string | null>(null)
  const pendingYtPlayRef = useRef<{ videoId: string; startTime: number; requestId: number } | null>(null)
  const audioRequestRef = useRef(0)
  const audioGenerationRef = useRef(0)
  const audioOwnershipRef = useRef<{
    generation: number
    requestId: number
    trackId: string | null
  }>({
    generation: 0,
    requestId: 0,
    trackId: null,
  })
  const resolutionIdentityRef = useRef<{
    trackId: string
    title: string
    artist: string
    duration?: number
    album?: string
  } | null>(null)
  const pendingSeekRef = useRef<number | null>(null)
  // True when a YouTube-sourced track is playing through the HTML5 <audio> proxy
  // (iOS only — the iframe engine is paused by iOS when the screen locks/app backgrounds)
  const ytHtml5ModeRef = useRef<boolean>(false)

  const html5EngineRef = useRef<Html5AudioEngine>(new Html5AudioEngine())
  const ytEngineRef = useRef<YouTubeIframeEngine>(new YouTubeIframeEngine())
  const consecutiveSkipRef = useRef<number>(0)

  const currentTrackRef = useRef<Track | null>(null)
  const queueRef = useRef<Track[]>([])
  const currentIndexRef = useRef<number>(-1)
  const volumeRef = useRef<number>(DEFAULT_VOLUME)
  const lastSavedTimeRef = useRef<number>(0)
  const lastPrevClickRef = useRef<number>(0)
  const playedHistoryStackRef = useRef<Track[]>([])
  const forwardHistoryStackRef = useRef<Track[]>([])
  const isPrevNextActionRef = useRef<boolean>(false)
  const isBackwardActionRef = useRef<boolean>(false)
  const playTrackRef = useRef<
    (track: Track, newQueue?: Track[], forceIndex?: number, startFromTime?: number) => Promise<void>
  >(async () => {})
  const nextTrackRef = useRef<() => void>(() => {})
  const prevTrackRef = useRef<() => void>(() => {})
  const pendingResumeRef = useRef<boolean>(false)
  const audioStallWatchdogRef = useRef<NodeJS.Timeout | null>(null)
  const toggleActionIdRef = useRef<number>(0)
  const desiredPlayStateRef = useRef<'playing' | 'paused' | null>(null)

  const isCurrentAudioOwnership = useCallback(() => {
    const token = audioOwnershipRef.current
    const activeId = currentTrackRef.current?.id
    if (!activeId || !token.trackId) return false
    return (
      token.generation === audioGenerationRef.current &&
      token.requestId === playRequestRef.current &&
      token.trackId === activeId
    )
  }, [])

  const getActualYouTubeVideoId = useCallback((): string | null => {
    try {
      const data = ytPlayerRef.current?.getVideoData?.()
      const id = data?.video_id
      return typeof id === 'string' && id.length > 0 ? id : null
    } catch {
      return null
    }
  }, [])

  const isCurrentYouTubeVideo = useCallback(() => {
    const active = currentTrackRef.current
    if (!active?.youtube_id) return false
    const actualVideoId = getActualYouTubeVideoId()
    return (actualVideoId && actualVideoId === active.youtube_id) || (ytLoadedIdRef.current === active.youtube_id)
  }, [getActualYouTubeVideoId])

  const invalidateCurrentResolution = useCallback(async () => {
    const identity = resolutionIdentityRef.current
    if (identity) {
      await invalidateStreamResolution(identity)
      return
    }
    const track = currentTrackRef.current
    if (track) {
      await invalidateStreamResolution({
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        album: track.album,
      })
    }
  }, [])

  // "YouTube iframe engine active" — false when the same track streams via HTML5 audio (iOS background mode)
  const isYtIframeEngine = useCallback((): boolean => {
    const t = currentTrackRef.current
    return (t?.source === 'youtube' || Boolean(t?.youtube_id)) && !ytHtml5ModeRef.current
  }, [])

  // ⚡ Teardown helper for mutual exclusion and unmount cleanup across HTML5 & YouTube
  const stopActivePlaybackEngines = useCallback((targetEngine: 'html5' | 'youtube' | 'all') => {
    if (targetEngine === 'youtube' || targetEngine === 'all') {
      pendingYtPlayRef.current = null
      const ytPlayer = ytPlayerRef.current
      if (ytPlayer) {
        try {
          if (ytPlayer.stopVideo) ytPlayer.stopVideo()
          if (ytPlayer.pauseVideo) ytPlayer.pauseVideo()
        } catch {}
      }
      try {
        ytEngineRef.current.stop()
      } catch {}
    }

    if (targetEngine === 'html5' || targetEngine === 'all') {
      const audio = audioRef.current
      if (audio) {
        try {
          audio.pause()
          audio.removeAttribute('src')
          audio.load()
        } catch (err: any) {
          if (err?.name !== 'AbortError') {
            // Silently absorb AbortError from interrupted play()
          }
        }
      }
      try {
        html5EngineRef.current.stop()
      } catch {}
    }
  }, [])

  // Web Audio API GainNode initialization for software volume attenuation (works on iOS Safari)
  const ensureWebAudioGain = useCallback(() => {
    if (typeof window === 'undefined' || !audioRef.current) return
    try {
      if (!audioContextRef.current) {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
        if (!AudioCtxClass) return
        audioContextRef.current = new AudioCtxClass()
      }

      const ctx = audioContextRef.current
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }

      if (!gainNodeRef.current && ctx) {
        const gainNode = ctx.createGain()
        gainNode.gain.value = volumeRef.current
        gainNodeRef.current = gainNode

        if (!isWebAudioConnectedRef.current && audioRef.current) {
          try {
            const source = ctx.createMediaElementSource(audioRef.current)
            source.connect(gainNode)
            gainNode.connect(ctx.destination)
            isWebAudioConnectedRef.current = true
          } catch (connErr) {
            console.warn('[WebAudio] MediaElementSource connection deferred:', connErr)
          }
        }
      }
    } catch (err) {
      console.warn('[WebAudio] GainNode setup error:', err)
    }
  }, [])

  const autoFetchSmartQueueRef = useRef(false)
  const activeQueueRequestIdRef = useRef(0)

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
    if (repeatModeRef.current !== 'off') return
    autoFetchSmartQueueRef.current = true
    const requestId = ++activeQueueRequestIdRef.current
    try {
      const seedId = seedTrack.id
      const artist = seedTrack.artist || ''
      const title = seedTrack.title || ''
      const isrc = (seedTrack as any).isrc || ''
      // Giới hạn 50 id gần nhất để tránh URL quá dài
      const historyIds = currentQ.slice(-50).map((t) => t.id).join(',')
      let url = `/api/queue/next?current_track_id=${encodeURIComponent(seedId)}&artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}&limit=12`
      if (isrc) url += `&isrc=${encodeURIComponent(isrc)}`
      if (historyIds) url += `&history_ids=${encodeURIComponent(historyIds)}`
      const res = await fetch(url)
      if (requestId !== activeQueueRequestIdRef.current) return
      if (currentTrackRef.current?.id !== seedId) return
      if (res.ok) {
        const data: NextQueueResponse = await res.json()
        if (requestId !== activeQueueRequestIdRef.current) return
        if (data.tracks && data.tracks.length > 0) {
          const appTracks = data.tracks.map((qt) => queueTrackToTrack(qt))
          setQueue((prev) => deduplicateQueueTracks([...prev, ...appTracks]))
          return
        }
      }
      const recs = await getSmartRecommendedTracks(seedTrack, currentQ, 8)
      if (requestId !== activeQueueRequestIdRef.current) return
      if (recs && recs.length > 0) {
        setQueue((prev) => deduplicateQueueTracks([...prev, ...recs]))
      }
    } catch (err) {
      console.warn('Smart queue auto-fill error:', err)
    } finally {
      autoFetchSmartQueueRef.current = false
    }
  }, [])

  const supabase = createClient()

  const lastRecordedTrackRef = useRef<{ trackId: string; ts: number } | null>(null)

  // Helper to record listening history in background
  const recordHistory = useCallback((track: Track) => {
    if (!track || !track.id) return
    const now = Date.now()
    // Debounce 3s tránh ghi lặp
    if (
      lastRecordedTrackRef.current &&
      lastRecordedTrackRef.current.trackId === track.id &&
      now - lastRecordedTrackRef.current.ts < 3000
    ) {
      return
    }
    lastRecordedTrackRef.current = { trackId: track.id, ts: now }

    setTimeout(async () => {
      try {
        const res = await fetch('/api/history/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ track }),
        })
        if (!res.ok) {
          // Chưa đăng nhập (401) hoặc lỗi khác — không cần báo user, chỉ log để debug
          const data = await res.json().catch(() => null)
          console.warn('[PlayerContext] History record failed:', res.status, data?.error)
        }
      } catch (historyErr) {
        console.warn('History tracking error:', historyErr)
      }
    }, 100)
  }, [])

  // Synchronous state committer to avoid out-of-sync states
  const commitNavigation = useCallback((track: Track, index: number, targetQueue: Track[], time = 0) => {
    // 1. Manage played track history stack transition
    const oldTrack = currentTrackRef.current
    if (oldTrack && oldTrack.id !== track.id) {
      if (!isBackwardActionRef.current) {
        playedHistoryStackRef.current.push(oldTrack)
        if (playedHistoryStackRef.current.length > 50) {
          playedHistoryStackRef.current.shift()
        }
      }
    }
    isBackwardActionRef.current = false

    // 2. Clear forward history if not explicit prev/next navigation
    if (!isPrevNextActionRef.current) {
      forwardHistoryStackRef.current = []
    }
    isPrevNextActionRef.current = false

    // 3. Synchronously commit state and references
    currentTrackRef.current = track
    setCurrentTrack(track)

    const targetIndex = typeof index === 'number' && index >= 0 ? index : -1
    currentIndexRef.current = targetIndex
    setCurrentIndex(targetIndex)

    setCurrentTime(time)
    setDuration(track.duration || 0)
    setPlaybackError(null)
    setIsBuffering(true)

    savePlayerStateToStorage(track, time, targetQueue, targetIndex, volumeRef.current ?? 0.8, true)
  }, [])

  const fallbackAttemptedRef = useRef<Set<number>>(new Set())
  const ytRetriedRef = useRef<Set<number>>(new Set())
  const nctRetriedRef = useRef<Set<number>>(new Set())
  const scRetriedRef = useRef<Set<number>>(new Set())
  const scStallRecoveredRef = useRef<Set<number>>(new Set())

  const recordRequestIdFlag = (set: Set<number>, id: number, max = 50) => {
    set.add(id)
    if (set.size > max) {
      const oldest = set.values().next().value
      if (oldest !== undefined) set.delete(oldest)
    }
  }

  const beginNewPlaybackRequest = useCallback((track: Track): number => {
    const requestId = ++playRequestRef.current
    audioRequestRef.current = requestId
    clearPlaybackTimers()
    audioRetryCountRef.current = 0

    audioOwnershipRef.current = {
      generation: ++audioGenerationRef.current,
      requestId,
      trackId: track.id,
    }
    resolutionIdentityRef.current = null

    const nextIsYouTubeEngine = (track.source === 'youtube' || Boolean(track.youtube_id)) && !isIOSDevice()
    if (!nextIsYouTubeEngine && ytPlayerRef.current) {
      try {
        if (ytPlayerRef.current.pauseVideo) ytPlayerRef.current.pauseVideo()
      } catch {}
    }

    return requestId
  }, [])

  const AUDIO_URL_MAX_ENTRIES = 200
  const TRACK_RESOLUTION_MAX_ENTRIES = 200

  // Set với giới hạn số lượng entry — khi vượt ngưỡng, xoá entry cũ nhất (insertion order = Map mặc định).
  // Đồng thời "refresh" vị trí LRU khi ghi đè key đã tồn tại (delete rồi set lại để đẩy xuống cuối).
  function setBounded<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number) {
    if (map.has(key)) map.delete(key)
    map.set(key, value)
    if (map.size > maxEntries) {
      const oldestKey = map.keys().next().value
      if (oldestKey !== undefined) map.delete(oldestKey)
    }
  }

  // Refresh LRU position on read — only evict if entry is expired.
  // LRU eviction for size > maxEntries is handled exclusively in setBounded.
  function getBoundedRefreshed<K, V>(
    map: Map<K, V>,
    key: K,
    isExpired?: (val: V) => boolean
  ): V | undefined {
    if (!map.has(key)) return undefined
    const value = map.get(key) as V
    if (isExpired && isExpired(value)) {
      map.delete(key)
      return undefined
    }
    // Refresh LRU: move to end without evicting
    map.delete(key)
    map.set(key, value)
    return value
  }

  const audioUrlCacheRef = useRef<Map<string, { url: string; ts: number }>>(new Map())
  const URL_CACHE_TTL = 30 * 60 * 1000 // 30 mins

  // Cached catalog-track resolution (NCT/Drive/YouTube matching) so switching back to a
  // previously resolved track skips the slow network matching entirely.
  const trackResolutionCacheRef = useRef<Map<string, { activeTrack: Track; expiresAt: number }>>(new Map())
  const TRACK_RESOLUTION_TTL = 30 * 60 * 1000

  // Theo dõi track đang được pre-resolve bằng ID — thay cho mutation `_preResolving` trên object.
  const resolvingTrackIdsRef = useRef<Set<string>>(new Set())
  // Chỉ pre-warm khi currentIndex thay đổi — tránh gọi lại cho cùng queue.
  const lastPrewarmIndexRef = useRef<number>(-1)
  // Gates the "30s-before-end" prewarm — reset per track so it fires exactly once.
  const nextTrackEndPrewarmedRef = useRef<boolean>(false)
  // Gates stable playback prewarm (triggered once per track after 5s stable play)
  const hasPrewarmedNextTrackRef = useRef<boolean>(false)

  const pendingAutoSkipTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const clearPlaybackTimers = () => {
    if (pendingAutoSkipTimeoutRef.current) {
      clearTimeout(pendingAutoSkipTimeoutRef.current)
      pendingAutoSkipTimeoutRef.current = null
    }
    if (ytStuckTimerRef.current) {
      clearTimeout(ytStuckTimerRef.current)
      ytStuckTimerRef.current = null
    }
    if (audioStallWatchdogRef.current) {
      clearTimeout(audioStallWatchdogRef.current)
      audioStallWatchdogRef.current = null
    }
  }

  // Resolve audio URL for local and external tracks
  const getAudioUrl = useCallback(
    async (track: Track, bypassCache = false): Promise<string | null> => {
      const nctStreamUrl = getNhacCuaTuiStreamUrl(track)
      if (nctStreamUrl) return nctStreamUrl

      if (
        track.source === 'soundcloud' ||
        Boolean(track.soundcloud_id) ||
        (track.file_path && (track.file_path.includes('soundcloud.com') || track.file_path.startsWith('soundcloud:'))) ||
        (track.source_url && track.source_url.includes('soundcloud.com')) ||
        (track.soundcloud_permalink_url && track.soundcloud_permalink_url.includes('soundcloud.com'))
      ) {
        let scTarget: string | number = track.soundcloud_id ?? ''
        if (!scTarget) {
          if (track.file_path && track.file_path.startsWith('soundcloud:')) {
            scTarget = track.file_path.replace('soundcloud:', '')
          } else if (track.file_path && track.file_path.includes('soundcloud.com')) {
            scTarget = track.file_path
          } else if (track.source_url && track.source_url.includes('soundcloud.com')) {
            scTarget = track.source_url
          } else if (track.soundcloud_permalink_url) {
            scTarget = track.soundcloud_permalink_url
          } else if (track.id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(track.id)) {
            scTarget = track.id.replace(/^sc-/, '')
          } else {
            scTarget = track.id
          }
        }

        const workerUrl = process.env.NEXT_PUBLIC_SOUNDCLOUD_WORKER_URL?.trim()
        const refreshQuery = bypassCache ? '&refresh=1' : ''

        try {
          const endpoint = workerUrl
            ? `${workerUrl.replace(/\/+$/, '')}/stream?id=${encodeURIComponent(scTarget)}&format=json${refreshQuery}`
            : `/api/soundcloud/stream?id=${encodeURIComponent(scTarget)}&format=json${refreshQuery}`
          const res = await fetch(endpoint)
          if (res.ok) {
            const data = await res.json()
            if (data.url) return data.url
          } else if (res.status === 404 || res.status === 403 || res.status === 502) {
            return null
          }
        } catch (e) {
          console.warn('[SoundCloud getAudioUrl] direct resolve error:', e)
        }

        if (workerUrl) {
          return `${workerUrl.replace(/\/+$/, '')}/stream?id=${encodeURIComponent(scTarget)}${refreshQuery}`
        }
        return `/api/soundcloud/stream?id=${encodeURIComponent(scTarget)}${refreshQuery}`
      }

      // iOS (Safari & Chrome): play YouTube through the HTML5 stream proxy so audio
      // keeps playing in the background — iOS pauses the iframe engine on lock/background.
      if (isIOSDevice() && track.youtube_id) {
        return buildYouTubeStreamUrl(track.youtube_id)
      }

      if (track.source === 'audius' || (track.audio_url && !isPreviewUrl(track.audio_url) && !track.youtube_id && !track.nhaccuatui_id && !track.soundcloud_id)) {
        return track.audio_url || track.file_path
      }

      // YouTube tracks use the IFrame engine. The old server-side audio proxy
      // relies on deprecated YouTube extraction clients.
      if (!shouldUseHtml5Audio(track)) return null

      const filePath = track.file_path || ''
      if (!filePath) return null

      // Spotify webpage URLs and 30s preview clips cannot be played directly by HTML5 <audio>
      if (
        filePath.includes('spotify.com') ||
        filePath.startsWith('spotify:') ||
        filePath.includes('p.scdn.co') ||
        track.source === 'spotify' ||
        Boolean(track.spotify_id) ||
        isPreviewUrl(filePath)
      ) {
        return null
      }

      const driveFileId = track.drive_file_id || extractDriveFileId(filePath)
      if (driveFileId) {
        // Note: The audio element has crossOrigin="anonymous" for Web Audio API support, which
        // requires CORS headers. Direct Drive CDN URLs (lh3.googleusercontent.com, etc.)
        // don't consistently send CORS headers → always route through CORS-safe proxy (Worker or /api/drive-stream).
        const ext =
          track.file_ext ||
          track.title?.match(/\.(flac|mp3|wav|m4a|aac|ogg|wma)(?:[?#]|$)/i)?.[1]?.toLowerCase() ||
          ''
        const filenameParam = ext ? `&filename=${encodeURIComponent(`stream.${ext}`)}` : ''
        const baseUrl = buildDriveStreamUrl(driveFileId)
        return filenameParam ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${filenameParam.slice(1)}` : baseUrl
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

  // TTL for NCT stream URL cache (mirrors server-side NCT_RESOLVE_CACHE_TTL = 5 min)
  const NCT_URL_CACHE_TTL = 5 * 60 * 1000

  const getAudioUrlCached = useCallback(
    async (track: Track): Promise<string | null> => {
      if (!track || !track.id) return null
      // Catalog/preview tracks should NOT cache preview URLs as playable full-length audio!
      if (
        (track.audio_url && isPreviewUrl(track.audio_url)) ||
        (track.file_path && isPreviewUrl(track.file_path)) ||
        track.source === 'spotify' ||
        track.source === 'itunes'
      ) {
        return null
      }

      const isNct = track.source === 'nhaccuatui'
      const isSoundCloud = Boolean(
        track.source === 'soundcloud' ||
        track.soundcloud_id ||
        track.id?.startsWith('sc-') ||
        (track.file_path && track.file_path.includes('soundcloud.com')) ||
        (track.source_url && track.source_url.includes('soundcloud.com'))
      )

      // 1. Check localStorage persistence (cross-session, survives app restart)
      // Only for permanent/stable URLs (skip ephemeral signed tokens from SoundCloud/NCT)
      if (!isSoundCloud && !isNct) {
        const persisted = getStreamUrl(track.id)
        if (persisted?.url) {
          return persisted.url
        }
      }

      // 2. NCT fast-path: check module-level nctStreamUrlCache (warmed by pre-warm effect).
      // Returns cached proxy URL with zero network latency.
      if (isNct && track.nhaccuatui_id) {
        const cachedNctUrl = getCachedNctStreamUrl(track.nhaccuatui_id)
        if (cachedNctUrl) return cachedNctUrl
      }

      // 3. Check audioUrlCacheRef for all other sources / cold NCT
      // SoundCloud tokens expire in ~15-20 min, so limit in-memory cache to 10 min
      const SC_URL_CACHE_TTL = 10 * 60 * 1000
      const cacheTtl = isNct ? NCT_URL_CACHE_TTL : isSoundCloud ? SC_URL_CACHE_TTL : URL_CACHE_TTL
      const cached = getBoundedRefreshed(
        audioUrlCacheRef.current,
        track.id,
        (entry) => Date.now() - entry.ts >= cacheTtl
      )
      if (cached) {
        return cached.url
      }

      // NCT with no nhaccuatui_id — can't resolve without an ID
      if (isNct && !track.nhaccuatui_id) return null

      const url = await getAudioUrl(track)
      if (url && !isPreviewUrl(url)) {
        // Persist to localStorage for cross-session restore (skip ephemeral signed SoundCloud/NCT URLs)
        if (!isSoundCloud && !isNct) {
          saveStreamUrl(track.id, url, {
            youtube_id: track.youtube_id,
          })
        }
        setBounded(audioUrlCacheRef.current, track.id, { url, ts: Date.now() }, AUDIO_URL_MAX_ENTRIES)
      }
      return url
    },
    [getAudioUrl]
  )

  // ⚡ Task 3: Adaptive single-track prewarm gated by network conditions and playback stability
  const triggerAdaptivePrewarm = useCallback(
    (q: Track[], idx: number) => {
      // Gate 1: Network-first check (0ms)
      if (!isFastConnection()) return
      if (!q || q.length === 0 || idx < -1 || idx >= q.length - 1) return

      const targetIdx = idx >= 0 ? idx + 1 : 0
      const nextTr = q[targetIdx]
      if (!nextTr || !nextTr.id) return

      // Prewarm single next track only
      const isDrive = Boolean(nextTr.drive_file_id || extractDriveFileId(nextTr.file_path || ''))
      if (isDrive) {
        triggerDrivePrewarm([nextTr])
        return
      }

      if (nextTr.source === 'nhaccuatui' && nextTr.nhaccuatui_id) {
        if (!getCachedNctStreamUrl(nextTr.nhaccuatui_id)) {
          prewarmNctStreamUrl(nextTr.nhaccuatui_id).catch(() => {})
        }
        return
      }

      const hasDirectPlayable = Boolean(
        nextTr.audio_url ||
        nextTr.youtube_id ||
        nextTr.source === 'soundcloud' ||
        Boolean(nextTr.soundcloud_id) ||
        (nextTr.file_path && (
          nextTr.file_path.includes('.mp3') ||
          nextTr.file_path.includes('preview') ||
          nextTr.file_path.includes('dzcdn.net') ||
          nextTr.file_path.includes('apple.com') ||
          nextTr.file_path.includes('drive-stream') ||
          nextTr.file_path.includes('audius')
        ))
      )

      if (hasDirectPlayable) {
        if (!audioUrlCacheRef.current.has(nextTr.id)) {
          getAudioUrlCached(nextTr).catch(() => {})
        }
        return
      }

      // Catalog track: resolve next single track
      const targetTrackId = nextTr.id
      if (!resolvingTrackIdsRef.current.has(targetTrackId)) {
        resolvingTrackIdsRef.current.add(targetTrackId)
        resolveStreamCached({
          title: nextTr.title,
          artist: nextTr.artist,
          duration: nextTr.duration,
          album: nextTr.album,
        })
          .then((resolved) => {
            if (!resolved) return
            let updatedTrack: Track | null = null
            if (resolved.source === 'nhaccuatui') {
              updatedTrack = { source: 'nhaccuatui', nhaccuatui_id: resolved.id } as Partial<Track> as Track
              if (!getCachedNctStreamUrl(resolved.id)) {
                prewarmNctStreamUrl(resolved.id).catch(() => {})
              }
            } else if (resolved.source === 'drive') {
              updatedTrack = { source: 'local' as const, file_path: resolved.id } as Partial<Track> as Track
            } else if (resolved.source === 'youtube') {
              updatedTrack = { source: 'youtube' as const, youtube_id: resolved.id } as Partial<Track> as Track
            }
            if (!updatedTrack) return
            const mergedTrack = { ...nextTr, ...updatedTrack }
            setBounded(
              trackResolutionCacheRef.current,
              targetTrackId,
              {
                activeTrack: mergedTrack,
                expiresAt: Date.now() + TRACK_RESOLUTION_TTL,
              },
              TRACK_RESOLUTION_MAX_ENTRIES
            )
          })
          .catch(() => {})
          .finally(() => {
            resolvingTrackIdsRef.current.delete(targetTrackId)
          })
      }
    },
    [getAudioUrlCached, resolveStreamCached]
  )



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

  /**
   * Core YouTube fallback logic.
   * - Checks localStorage cache for pre-resolved YouTube video ID (skips search = save ~700ms)
   * - Accepts optional preSearchedTrack from parallel search in handleError
   * - Saves resolved youtube_id to localStorage on success for future plays
   */
  const fallbackToYouTube = useCallback(async (
    track: Track,
    requestId: number,
    preSearchedTrack?: Track | null
  ) => {
    // ── Step 0: Check localStorage cache for YouTube video ID ───────────────
    // This is the fastest path — if we've resolved this track to YouTube before,
    // skip the YouTube Data API search entirely and go straight to streaming.
    let bestMatch = preSearchedTrack ?? null

    if (!bestMatch) {
      const cachedYtId = getCachedYouTubeId(track.title, track.artist, track.album)
      if (cachedYtId) {
        console.log(`[fallbackToYouTube] Cache hit for YouTube ID: ${cachedYtId} — skipping search`)
        bestMatch = {
          ...track,
          youtube_id: cachedYtId,
          source: 'youtube',
          // Duration unknown from cache — use track's known duration or 0
          duration: track.duration || 0,
        }
      }
    }

    // ── Step 1: YouTube Data API search (if no cached ID) ────────────────────
    if (!bestMatch) {
      try {
        const query = `${track.title} ${track.artist || ''}`.trim()
        const data = await fetchUnifiedSearch(query, 'youtube')
        if (!isCurrentAudioOwnership()) return
        if (!isCurrentPlayback({
          requestId,
          currentRequestId: playRequestRef.current,
          trackId: track.id,
          currentTrackId: currentTrackRef.current?.id,
        })) return
        const ytList: Track[] = data.youtube || []
        bestMatch = findBestYouTubeMatch(ytList, track.title, track.artist, track.duration, track.album)
      } catch {
        // Search failed — fall through to error message below
      }
    }

    if (!bestMatch) {
      if (!isCurrentAudioOwnership()) return
      if (requestId !== playRequestRef.current) return
      setIsPlaying(false)
      setIsBuffering(false)
      setPlaybackError(`Không thể phát bài hát "${track.title}". Vui lòng chọn bài khác.`)
      return
    }

    if (!bestMatch.youtube_id) {
      if (!isCurrentAudioOwnership()) return
      if (requestId !== playRequestRef.current) return
      setIsPlaying(false)
      setIsBuffering(false)
      setPlaybackError(`Không thể phát bài hát "${track.title}". Vui lòng chọn bài khác.`)
      return
    }

    const candidateDuration = bestMatch.duration || 0
    const isTargetShort = !track.duration || track.duration < 900
    if (isTargetShort && candidateDuration > 1200) {
      // Target is a short track but YouTube match is > 2min — reject (likely wrong match)
      if (!isCurrentAudioOwnership()) return
      if (requestId !== playRequestRef.current) return
      setIsPlaying(false)
      setIsBuffering(false)
      setPlaybackError(`Không thể phát bài hát "${track.title}". Vui lòng chọn bài khác.`)
      return
    }

    const activeTrack: Track = {
      ...track,
      youtube_id: bestMatch.youtube_id,
      source: 'youtube',
    }

    // ── Step 2: Save youtube_id to localStorage for future plays ─────────────
    // Long TTL (24h) — YouTube video IDs are stable. This saves ~700ms on replay.
    try {
      saveTrackResolution(
        `${track.title.trim().toLowerCase()}___${(track.artist || '').trim().toLowerCase()}___${(track.album || '').trim().toLowerCase()}`,
        { source: 'youtube', resolvedId: bestMatch.youtube_id, ttl: 24 * 60 * 60 * 1000, youtubeVideoId: bestMatch.youtube_id }
      )
    } catch {
      // Best-effort — cache miss on next play is not critical
    }

    // ── Step 3: Background R2 population trigger ────────────────────────────
    // ⚠️ Disabled for YouTube — YouTube streams are less stable and the
    // Range pre-warm can cause the browser to reload playback when the
    // InnerTube resolution completes. The actual audio.play() below triggers
    // InnerTube naturally. R2 population will happen as a side-effect of
    // normal playback, making the NEXT play instant.
    //
    // If you want to re-enable, ensure the Range request doesn't interfere
    // with the browser's audio element by using a different mechanism.
    const streamUrl = buildYouTubeStreamUrl(bestMatch.youtube_id)
    // fetch(streamUrl, { headers: { Range: 'bytes=0-0' } }).catch(() => {}) // Disabled

    // Invalidate the broken stream resolution so subsequent plays don't re-fetch the dead stream
    await invalidateCurrentResolution()
    trackResolutionCacheRef.current.delete(track.id)
    audioUrlCacheRef.current.delete(track.id)
    if (track.nhaccuatui_id) {
      clearCachedNctStreamUrl(track.nhaccuatui_id)
    }

    // Cache the new working youtube resolution
    setBounded(
      trackResolutionCacheRef.current,
      track.id,
      { activeTrack, expiresAt: Date.now() + TRACK_RESOLUTION_TTL },
      TRACK_RESOLUTION_MAX_ENTRIES
    )

    setCurrentTrack(activeTrack)
    currentTrackRef.current = activeTrack
    setPlaybackError(null)

    if (isIOSDevice()) {
      // iOS: Play YouTube through HTML5 stream proxy so it continues in background / lock screen
      ytHtml5ModeRef.current = true
      if (audioRef.current) {
        setAudioSourceForPlayback(audioRef.current, streamUrl, volumeRef.current ?? 0.8, 0)
        try {
          await playAudioElement(audioRef.current)
          if (!isCurrentAudioOwnership()) {
            audioRef.current.pause()
            return
          }
          if (requestId !== playRequestRef.current) {
            audioRef.current.pause()
            return
          }
          setIsPlaying(true)
          setIsBuffering(false)
          return
        } catch (iosPlayErr) {
          console.warn('iOS YouTube fallback stream playback error:', iosPlayErr)
        }
      }
    } else {
      // Desktop / Android: Play through YouTube iframe engine
      ytHtml5ModeRef.current = false
      if (audioRef.current) {
        try {
          audioRef.current.pause()
          audioRef.current.removeAttribute('src')
        } catch {}
      }
      const tryLoadYt = (retries = 5) => {
        if (requestId !== playRequestRef.current) return
        if (ytPlayerRef.current?.loadVideoById) {
          ytLoadedIdRef.current = bestMatch.youtube_id || null
          const currentVol = volumeRef.current ?? DEFAULT_VOLUME
          if (currentVol > 0) {
            if (ytPlayerRef.current.unMute) ytPlayerRef.current.unMute()
            if (ytPlayerRef.current.isMuted && ytPlayerRef.current.isMuted()) {
              ytPlayerRef.current.unMute()
            }
          } else {
            if (ytPlayerRef.current.mute) ytPlayerRef.current.mute()
          }
          if (ytPlayerRef.current.setVolume) {
            ytPlayerRef.current.setVolume(currentVol * 100)
          }
          ytPlayerRef.current.loadVideoById({
            videoId: bestMatch.youtube_id,
          })
          if (ytPlayerRef.current.playVideo) {
            try { ytPlayerRef.current.playVideo() } catch {}
          }
          setIsPlaying(true)
          setIsBuffering(false)
        } else if (retries > 0) {
          setTimeout(() => tryLoadYt(retries - 1), 150)
        }
      }
      tryLoadYt()
      return
    }
  }, [invalidateCurrentResolution, isCurrentAudioOwnership])

  const toggleShuffle = useCallback(() => {
    setIsShuffle((prev) => !prev)
  }, [])

  const toggleRepeat = useCallback(() => {
    setRepeatMode((prev) => {
      const next: RepeatMode = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'
      try {
        localStorage.setItem('musicweb_repeat_mode', next)
      } catch {}
      return next
    })
  }, [])

  const toggleFavoriteCurrentTrack = useCallback(async () => {
    const current = currentTrackRef.current
    if (!current) return
    const nextValue = !current.is_favorite
    setCurrentTrack((prev) => (prev ? { ...prev, is_favorite: nextValue } : null))

    try {
      let dbTrackId = current.id

      // If track is from external source (YouTube, iTunes, Audius), ensure it exists in tracks table
      if (current.source && current.source !== 'local') {
        const { data: { user: currentUser } } = await supabase.auth.getUser()
        const activeUser =
          currentUser ||
          (nextAuthSession?.user
            ? { id: nextAuthSession.user.email, email: nextAuthSession.user.email }
            : null)
        const userId = activeUser ? getValidUserId(activeUser) : null
        if (userId) {
          const resolvedId = await resolveExternalTrackId(supabase, current, userId)
          if (resolvedId) dbTrackId = resolvedId
        }
      }

      const res = await fetch('/api/favorites/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId: dbTrackId, nextValue }),
      })

      if (!res.ok) {
        console.warn('[Favorite] toggle failed', await res.json().catch(() => null))
        setCurrentTrack((prev) => (prev ? { ...prev, is_favorite: !nextValue } : null))
      }
    } catch (err) {
      console.warn('Toggle favorite error:', err)
      // Rollback optimistic update — DB không lưu được nên UI phải phản ánh đúng trạng thái cũ.
      setCurrentTrack((prev) => (prev ? { ...prev, is_favorite: !nextValue } : null))
    }
  }, [nextAuthSession?.user, supabase])

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
              ytEngineRef.current.setPlayerInstance(ytPlayerRef.current)
              try {
                const currentVol = volumeRef.current ?? DEFAULT_VOLUME
                if (currentVol > 0 && ytPlayerRef.current?.unMute) {
                  ytPlayerRef.current.unMute()
                }
                if (ytPlayerRef.current?.setVolume) {
                  ytPlayerRef.current.setVolume(currentVol * 100)
                }
              } catch {}
              // 🚀 If there is a pending play request waiting for player to initialize on cold start:
              const pending = pendingYtPlayRef.current
              if (pending && pending.requestId === playRequestRef.current && isCurrentYouTubeVideo()) {
                pendingYtPlayRef.current = null
                try {
                  ytLoadedIdRef.current = pending.videoId
                  ytPlayerRef.current.loadVideoById({
                    videoId: pending.videoId,
                    startSeconds: pending.startTime,
                  })
                  if (ytPlayerRef.current.playVideo) {
                    try { ytPlayerRef.current.playVideo() } catch {}
                  }
                  setIsPlaying(true)
                  setIsBuffering(false)
                  return
                } catch (loadErr) {
                  console.warn('[YT onReady] pending play error:', loadErr)
                }
              }

              // Pre-arm restored track ONLY if player is completely idle and user has not started playback
              const active = currentTrackRef.current
              const isUserPlaying = desiredPlayStateRef.current === 'playing' || isPlaying
              if (!isUserPlaying && active && active.source === 'youtube' && active.youtube_id) {
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
              const isYouTubeEngine = active && (active.source === 'youtube' || Boolean(active.youtube_id)) && !ytHtml5ModeRef.current
              // If active track is NOT running YouTube engine, ensure YouTube player is stopped immediately
              if (!isYouTubeEngine) {
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
                if (!active?.youtube_id) return

                if (desiredPlayStateRef.current === 'paused') {
                  try {
                    ytPlayerRef.current?.pauseVideo?.()
                  } catch {}
                  setIsPlaying(false)
                  setIsBuffering(false)
                  return
                }

                const actualVideoId = getActualYouTubeVideoId()
                const matchesVideo = (actualVideoId && actualVideoId === active.youtube_id) || (ytLoadedIdRef.current === active.youtube_id)
                if (!matchesVideo) {
                  return
                }

                if (
                  !isCurrentPlayback({
                    requestId: playRequestRef.current,
                    currentRequestId: playRequestRef.current,
                    trackId: active.id,
                    currentTrackId: currentTrackRef.current?.id,
                  })
                ) {
                  return
                }

                // 🔊 Ensure YouTube player is UNMUTED and volume is synced on PLAYING state
                try {
                  const currentVol = volumeRef.current ?? DEFAULT_VOLUME
                  if (currentVol > 0) {
                    if (ytPlayerRef.current?.unMute) ytPlayerRef.current.unMute()
                    if (ytPlayerRef.current?.isMuted && ytPlayerRef.current.isMuted()) {
                      ytPlayerRef.current.unMute()
                    }
                  } else {
                    if (ytPlayerRef.current?.mute) ytPlayerRef.current.mute()
                  }
                  if (ytPlayerRef.current?.setVolume) {
                    ytPlayerRef.current.setVolume(currentVol * 100)
                  }
                } catch {}

                if (ytStuckTimerRef.current) clearTimeout(ytStuckTimerRef.current)
                consecutiveSkipRef.current = 0
                setIsPlaying(true)
                setIsBuffering(false)
                if (ytPlayerRef.current?.getDuration) {
                  setDuration(ytPlayerRef.current.getDuration() || 0)
                }
              } else if (event.data === 3) {
                if (!isCurrentYouTubeVideo()) return
                setIsBuffering(true)

                // Cold-start / kẹt-buffering watchdog: nếu BUFFERING kéo dài > 1500ms,
                // tự nudge playVideo() để giải cứu
                if (ytStuckTimerRef.current) clearTimeout(ytStuckTimerRef.current)
                const requestId = playRequestRef.current
                const trackId = active?.id
                ytStuckTimerRef.current = setTimeout(() => {
                  const currentActive = currentTrackRef.current
                  if (!currentActive?.youtube_id) return
                  if (!isCurrentYouTubeVideo()) return

                  if (
                    isCurrentPlayback({
                      requestId,
                      currentRequestId: playRequestRef.current,
                      trackId,
                      currentTrackId: currentActive.id,
                    })
                  ) {
                    try {
                      ytPlayerRef.current?.playVideo?.()
                    } catch (e) {}
                  }
                }, 1500)
              } else if (event.data === 2) {
                if (!isCurrentYouTubeVideo()) return
                if (ytStuckTimerRef.current) clearTimeout(ytStuckTimerRef.current)
                setIsBuffering(false)
                if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                  return
                }
                setIsPlaying(false)
              } else if (event.data === 0) {
                const activeForEnded = currentTrackRef.current
                if (!activeForEnded?.youtube_id) return

                const actualVideoId = getActualYouTubeVideoId()
                const matchesVideo = (actualVideoId && actualVideoId === activeForEnded.youtube_id) || (ytLoadedIdRef.current === activeForEnded.youtube_id)
                if (!matchesVideo) {
                  return
                }

                if (ytStuckTimerRef.current) clearTimeout(ytStuckTimerRef.current)
                setIsPlaying(false)
                recordListenEvent(activeForEnded, true)
                const endedRequestId = playRequestRef.current
                const endedTrackId = activeForEnded?.id
                const mode = repeatModeRef.current
                if (mode === 'one') {
                  setTimeout(() => {
                    if (currentTrackRef.current && isCurrentPlayback({
                      requestId: endedRequestId,
                      currentRequestId: playRequestRef.current,
                      trackId: endedTrackId,
                      currentTrackId: currentTrackRef.current.id,
                    })) {
                      playTrackRef.current(currentTrackRef.current)
                    }
                  }, 0)
                } else if (mode === 'all') {
                  setTimeout(() => {
                    if (isCurrentPlayback({
                      requestId: endedRequestId,
                      currentRequestId: playRequestRef.current,
                      trackId: endedTrackId,
                      currentTrackId: currentTrackRef.current?.id,
                    })) nextTrackRef.current()
                  }, 0)
                } else if (autoPlayNextRef.current) {
                  const q = queueRef.current
                  const idx = currentIndexRef.current
                  if (isShuffleRef.current || idx < q.length - 1) {
                    setTimeout(() => {
                      if (isCurrentPlayback({
                        requestId: endedRequestId,
                        currentRequestId: playRequestRef.current,
                        trackId: endedTrackId,
                        currentTrackId: currentTrackRef.current?.id,
                      })) nextTrackRef.current()
                    }, 0)
                  }
                }
              } else if (event.data === -1 || event.data === 5) {
                // Cold-start watchdog: if stuck in cued/unstarted for > 1500ms, auto-trigger playVideo() ONLY if active track is YouTube and user wants to play
                if (ytStuckTimerRef.current) clearTimeout(ytStuckTimerRef.current)
                if (desiredPlayStateRef.current !== 'playing') return
                const requestId = playRequestRef.current
                const trackId = active?.id
                ytStuckTimerRef.current = setTimeout(() => {
                  const currentActive = currentTrackRef.current
                  if (!currentActive?.youtube_id) return
                  if (!isCurrentYouTubeVideo()) return
                  if (desiredPlayStateRef.current !== 'playing') return

                  if (
                    isCurrentPlayback({
                      requestId,
                      currentRequestId: playRequestRef.current,
                      trackId,
                      currentTrackId: currentActive.id,
                    })
                  ) {
                    try {
                      ytPlayerRef.current?.playVideo?.()
                    } catch (e) {}
                  }
                }, 1500)
              }
            },
            onError: async (err: any) => {
              console.warn('YouTube Player Error:', err)
              const active = currentTrackRef.current
              if (!active?.youtube_id) return

              const actualVideoId = getActualYouTubeVideoId()
              const matchesVideo = (actualVideoId && actualVideoId === active.youtube_id) || (ytLoadedIdRef.current === active.youtube_id)
              if (!matchesVideo) {
                return
              }

              const requestId = playRequestRef.current
              const trackId = active?.id
              const errorCode = err?.data
              const isEmbedError = errorCode === 150 || errorCode === 101 || errorCode === 100

              if (active && isEmbedError) {
                await invalidateCurrentResolution()
                trackResolutionCacheRef.current.delete(active.id)
              }

              if (active && isEmbedError && !ytRetriedRef.current.has(requestId)) {
                console.log('[YouTube Fallback] Error 150/101/100 encountered, attempting automatic fallback match...')
                recordRequestIdFlag(ytRetriedRef.current, requestId)
                try {
                  const queryStr = `${active.title} ${active.artist || ''}`.trim()
                  const searchRes = await fetchUnifiedSearch(queryStr, 'youtube')
                  if (!isCurrentPlayback({
                    requestId,
                    currentRequestId: playRequestRef.current,
                    trackId,
                    currentTrackId: currentTrackRef.current?.id,
                  })) return
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

              if (requestId !== playRequestRef.current || trackId !== currentTrackRef.current?.id) return
              consecutiveSkipRef.current += 1
              setIsPlaying(false)
              setIsBuffering(false)
              if (consecutiveSkipRef.current >= MAX_CONSECUTIVE_SKIPS) {
                console.warn(`[Circuit Breaker] Tripped after ${consecutiveSkipRef.current} consecutive YouTube errors.`)
                setPlaybackError(
                  `Đã tạm dừng phát do có ${consecutiveSkipRef.current} bài hát liên tiếp gặp sự cố kết nối/nguồn phát. Vui lòng chọn bài khác.`
                )
                return
              }
              setPlaybackError(
                errorCode === 150 || errorCode === 101
                  ? 'Video này bị cấm nhúng phát ngoài YouTube. Vui lòng chọn bài khác.'
                  : errorCode === 100
                    ? 'Video này không còn tồn tại trên YouTube. Vui lòng chọn bài khác.'
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
          currentTimeRef.current = time
          if (ytPlayerRef.current.getDuration) {
            const dur = ytPlayerRef.current.getDuration() || 0
            setDuration((prev) => (Math.abs(prev - dur) > 1 ? dur : prev))
          }

          // ⚡ Task 3: Trigger single next-track prewarm only after 5s stable play
          if (!hasPrewarmedNextTrackRef.current && time >= 5 && !isBufferingRef.current) {
            hasPrewarmedNextTrackRef.current = true
            triggerAdaptivePrewarm(queueRef.current, currentIndexRef.current)
          }

          if (Math.abs(time - lastSavedTimeRef.current) > 15) {
            lastSavedTimeRef.current = time
            savePlayerStateToStorage(
              currentTrackRef.current,
              currentTimeRef.current,
              queueRef.current,
              currentIndexRef.current,
              volumeRef.current,
              false
            )
          }
        }
      }, 250) // 250ms cadence for responsive lyric highlighting & smooth scrubber
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [currentTrack?.id, currentTrack?.source, currentTrack?.youtube_id, isPlaying])

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
      const savedRepeat = localStorage.getItem('musicweb_repeat_mode') as RepeatMode | null
      if (savedRepeat === 'all' || savedRepeat === 'one' || savedRepeat === 'off') {
        setRepeatMode(savedRepeat)
        repeatModeRef.current = savedRepeat
      }

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

          const dedupedQueue = deduplicateQueueTracks(restoredQueue)
          currentTrackRef.current = restoredTrack
          queueRef.current = dedupedQueue
          currentIndexRef.current = restoredIndex
          currentTimeRef.current = restoredTime
          volumeRef.current = restoredVol
          audioOwnershipRef.current = {
            generation: audioGenerationRef.current,
            requestId: restoreRequestId,
            trackId: restoredTrack.id,
          }

          setCurrentTrack(restoredTrack)
          setQueue(dedupedQueue)
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
                if (desiredPlayStateRef.current === 'playing' || (audioRef.current && !audioRef.current.paused)) return
                if (playableTrack !== restoredTrack) {
                  setCurrentTrack(playableTrack)
                  currentTrackRef.current = playableTrack
                  audioOwnershipRef.current = {
                    generation: audioGenerationRef.current,
                    requestId: restoreRequestId,
                    trackId: playableTrack.id,
                  }
                }
                return getAudioUrl(playableTrack)
              })
              .then((url) => {
                if (playRequestRef.current !== restoreRequestId) return
                if (desiredPlayStateRef.current === 'playing' || (audioRef.current && !audioRef.current.paused)) return
                const audio = audioRef.current
                if (url && audio && (!audio.src || audio.src === window.location.href)) {
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
        let finalTime = currentTimeRef.current
        if (currentTrackRef.current.source === 'youtube' && !ytHtml5ModeRef.current && ytPlayerRef.current?.getCurrentTime) {
          finalTime = ytPlayerRef.current.getCurrentTime() || finalTime
        } else if (audioRef.current) {
          finalTime = audioRef.current.currentTime || finalTime
        }
        savePlayerStateToStorage(
          currentTrackRef.current,
          finalTime,
          queueRef.current,
          currentIndexRef.current,
          volumeRef.current,
          true
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

  const playTrack = useCallback(async (
    rawTrack: Track,
    newQueue?: Track[],
    forceIndex?: number,
    startFromTime?: number
  ) => {
    // ⚡ FIX #1: snapshot engine của track SẮP BỊ THAY THẾ trước khi reset state.
    const previousTrackUsedYouTubeHtml5 = ytHtml5ModeRef.current
    const track = inferTrackSource(rawTrack)

    consecutiveSkipRef.current = 0
    nextTrackEndPrewarmedRef.current = false // reset near-end prewarm guard for new track
    hasPrewarmedNextTrackRef.current = false
    desiredPlayStateRef.current = 'playing'
    const requestId = beginNewPlaybackRequest(track)

    // 🚀 Push currentTrack onto true playback history stack when user changes track
    if (currentTrackRef.current && currentTrackRef.current.id !== track.id) {
      let activeTime = currentTimeRef.current
      if (
        currentTrackRef.current.source === 'youtube' &&
        !previousTrackUsedYouTubeHtml5 &&
        ytPlayerRef.current?.getCurrentTime
      ) {
        try { activeTime = ytPlayerRef.current.getCurrentTime() || currentTimeRef.current } catch {}
      } else if (audioRef.current) {
        activeTime = audioRef.current.currentTime || currentTimeRef.current
      }
      const trackDur = currentTrackRef.current.duration || 0
      if (activeTime > 2 && (trackDur === 0 || activeTime < trackDur - 5)) {
        recordListenEvent(currentTrackRef.current, false, activeTime)
      }
    }

    // ⚡ Reset engine state CHỈ SAU KHI đã dùng xong snapshot ở trên.
    ytHtml5ModeRef.current = false

    // ⚡ 1. PAUSE & STOP ALL PREVIOUS AUDIO ENGINES IMMEDIATELY (ZERO DELAY OVERLAP)
    stopActivePlaybackEngines('all')

    let nextQueue = queueRef.current
    let nextIndex = currentIndexRef.current

    if (newQueue) {
      nextQueue = deduplicateQueueTracks(newQueue)
      setQueue(nextQueue)
      const index = nextQueue.findIndex((t) => t.id === track.id)
      nextIndex = index >= 0 ? index : 0
    } else if (typeof forceIndex === 'number') {
      nextIndex = forceIndex
    } else if (nextQueue.length === 0) {
      nextQueue = [track]
      setQueue(nextQueue)
      nextIndex = 0
    } else {
      const index = nextQueue.findIndex((t) => t.id === track.id)
      nextIndex = index >= 0 ? index : -1
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

    // ⚡ 2. UPDATE UI INSTANTLY (< 5ms) via commitNavigation
    commitNavigation(track, nextIndex, nextQueue, initialTime)
    setIsPlaying(false)

    // 🧠 SMART AUTOPLAY: Automatically fill queue with matching genre & region tracks when near queue end or queue is short
    if (nextIndex >= nextQueue.length - 2 || nextQueue.length <= 5) {
      triggerSmartQueueFill(track, nextQueue)
    }

    // 🎵 Full-Length Stream Resolver for iTunes & Spotify tracks (Resolves DRM/metadata into 100% playable full song)
    let activeTrack = track
    const classification = classifyTrack(track, isIOSDevice())
    const shouldResolveExternalCatalog = classification.needsCatalogResolution

    // For catalog tracks (Spotify / Deezer / iTunes) that need external stream resolution:
    // Ensure previous audio is stopped and show buffering while resolving full stream
    if (shouldResolveExternalCatalog && audioRef.current) {
      try {
        audioRef.current.pause()
        audioRef.current.removeAttribute('src')
      } catch {}
      setIsBuffering(true)
    }

    // ⚡ Fast path: reuse a previously resolved catalog match for this track.id
    const cachedResolution = shouldResolveExternalCatalog
      ? getBoundedRefreshed(
          trackResolutionCacheRef.current,
          track.id,
          (entry) => Date.now() >= entry.expiresAt
        )
      : undefined
    const useCachedResolution = Boolean(cachedResolution)
    if (cachedResolution && requestId === playRequestRef.current) {
      activeTrack = cachedResolution.activeTrack
      resolutionIdentityRef.current = {
        trackId: track.id,
        title: track.title,
        artist: track.artist || '',
        duration: track.duration || undefined,
        album: track.album || undefined,
      }
      audioUrlCacheRef.current.delete(track.id)
      setCurrentTrack(activeTrack)
      syncQueueEntry(activeTrack)
    }

    if (shouldResolveExternalCatalog && !useCachedResolution) {
      resolutionIdentityRef.current = {
        trackId: track.id,
        title: track.title,
        artist: track.artist || '',
        duration: track.duration || undefined,
        album: track.album || undefined,
      }

      // 🚀 Single-call resolution via /api/resolve-stream (L1→L2→full resolve)
      const resolved = await resolveStreamCached({
        title: track.title,
        artist: track.artist,
        duration: track.duration,
        album: track.album,
      })

      if (requestId !== playRequestRef.current) return

      let streamResult = resolved
      if (!streamResult) {
        try {
          const cleanTitleOnly = track.title
            .replace(/[\(\[\{].*?[\)\]\}]/g, '')
            .replace(/\s*-\s*.*?\b(remaster(ed)?|live|bonus track|single version|mono|stereo|official\s+(audio|video|mv))\b.*/i, '')
            .trim()
          const cleanArtistOnly = (track.artist || '')
            .replace(/[\(\[\{].*?[\)\]\}]/g, '')
            .replace(/\s*feat(\.|\s).*$/i, '')
            .trim()
          const cleanQ = `${cleanTitleOnly || track.title} ${cleanArtistOnly || track.artist || ''}`.trim()
          const fbRes = await fetch(`/api/search?q=${encodeURIComponent(cleanQ)}&source=all`)
          if (fbRes.ok) {
            const fbData = await fbRes.json()
            const nctMatch = fbData.nhaccuatui?.[0]
            const ytMatch = fbData.youtube?.[0] || fbData.spotify?.find((s: any) => s.youtube_id)
            const scMatch = fbData.soundcloud?.[0]
            if (nctMatch?.nhaccuatui_id) {
              streamResult = {
                source: 'nhaccuatui',
                id: nctMatch.nhaccuatui_id,
                title: nctMatch.title,
                artist: nctMatch.artist,
                duration: nctMatch.duration,
                coverUrl: nctMatch.cover_url,
              }
            } else if (ytMatch?.youtube_id) {
              streamResult = {
                source: 'youtube',
                id: ytMatch.youtube_id,
                title: ytMatch.title,
                artist: ytMatch.artist,
                duration: ytMatch.duration,
                coverUrl: ytMatch.cover_url,
              }
            } else if (scMatch?.soundcloud_id || scMatch?.id) {
              const scId = scMatch.soundcloud_id ? String(scMatch.soundcloud_id) : scMatch.id.replace(/^sc-/, '')
              streamResult = {
                source: 'soundcloud',
                id: scId,
                title: scMatch.title,
                artist: scMatch.artist,
                duration: scMatch.duration,
                coverUrl: scMatch.cover_url,
              }
            }
          }
        } catch (fbErr) {
          console.warn('Emergency search fallback error:', fbErr)
        }
      }

      // ⚠️ Critical guard: if a newer track was clicked while awaiting resolution, drop this stale resolution immediately!
      if (requestId !== playRequestRef.current) return

      if (streamResult) {
        resolutionIdentityRef.current = {
          trackId: track.id,
          title: track.title,
          artist: track.artist || '',
          duration: track.duration || undefined,
          album: track.album || undefined,
        }

        // Evict any stale audio URL cache entry for this catalog track ID so the player fetches the new stream!
        audioUrlCacheRef.current.delete(track.id)

        if (streamResult.source === 'nhaccuatui') {
          activeTrack = {
            ...track,
            source: 'nhaccuatui',
            nhaccuatui_id: streamResult.id,
            audio_url: undefined,
            file_path: '',
            title: streamResult.title || track.title,
            artist: streamResult.artist || track.artist,
            duration: streamResult.duration || track.duration,
            cover_url: streamResult.coverUrl || track.cover_url || null,
          }
        } else if (streamResult.source === 'drive') {
          activeTrack = {
            ...track,
            source: 'local' as const,
            file_path: streamResult.id,
            audio_url: undefined,
            title: streamResult.title || track.title,
            artist: streamResult.artist || track.artist,
            duration: streamResult.duration || track.duration,
            cover_url: streamResult.coverUrl || track.cover_url || null,
            album: track.album || null,
            spotify_album_id: track.spotify_album_id || null,
          }
        } else if (streamResult.source === 'soundcloud') {
          activeTrack = {
            ...track,
            source: 'soundcloud' as const,
            soundcloud_id: streamResult.id,
            audio_url: undefined,
            file_path: '',
            title: streamResult.title || track.title,
            artist: streamResult.artist || track.artist,
            duration: streamResult.duration || track.duration,
            cover_url: streamResult.coverUrl || track.cover_url || null,
          }
        } else if (streamResult.source === 'youtube') {
          activeTrack = {
            ...track,
            youtube_id: streamResult.id,
            source: 'youtube',
            audio_url: undefined,
            file_path: '',
          }
          rawTrack.youtube_id = streamResult.id
          track.youtube_id = streamResult.id
        }

        setBounded(trackResolutionCacheRef.current, track.id, { activeTrack, expiresAt: Date.now() + TRACK_RESOLUTION_TTL }, TRACK_RESOLUTION_MAX_ENTRIES)

        if (requestId === playRequestRef.current) {
          setCurrentTrack(activeTrack)
          currentTrackRef.current = activeTrack
          syncQueueEntry(activeTrack)
        }
      } else {
        // Resolution returned NULL (Miss or Resolution Failure for catalog track)
        audioUrlCacheRef.current.delete(track.id)
        activeTrack = {
          ...track,
          audio_url: undefined,
          file_path: '',
        }
      }
    }

    // ⚠️ Critical guard: ensure no newer play request has taken ownership
    if (requestId !== playRequestRef.current) return

    // 🎵 1. Try SYNCHRONOUS URL cache hit first (Zero-await gap for unbroken iOS Safari background playback gesture chain)
    let url: string | null = audioUrlCacheRef.current.get(activeTrack.id)?.url || null
    if (!url) {
      try {
        url = await getAudioUrlCached(activeTrack)
      } catch (error: any) {}
    }

    // ⚠️ Critical guard: if a newer track was clicked while resolving audio URL, drop this stale request immediately!
    if (requestId !== playRequestRef.current) return

    const audio = audioRef.current

    if (url && audio && requestId === playRequestRef.current) {
      ytHtml5ModeRef.current = isIOSDevice() && (activeTrack.source === 'youtube' || Boolean(activeTrack.youtube_id))
      // Note: intentionally NO audio.pause() here — pausing first can revoke the active
      // iOS audio session and make the following play() require a fresh user gesture.
      const targetStartTime = consumePendingSeek(initialTime > 0 ? initialTime : 0)
      setAudioSourceForPlayback(
        audio,
        url,
        volumeRef.current ?? 0.8,
        targetStartTime,
      )
      // If setAudioSourceForPlayback deferred the seek (because source changed
      // and startTime > 0), apply it once metadata is available.
      if (targetStartTime > 0 && audio.currentTime === 0) {
        const onMeta = () => {
          audio.removeEventListener('loadedmetadata', onMeta)
          if (requestId !== playRequestRef.current) return
          try { audio.currentTime = targetStartTime } catch {}
        }
        audio.addEventListener('loadedmetadata', onMeta)
      }

      try {
        await playAudioElement(audio)
        if (requestId !== playRequestRef.current) {
          audio.pause()
          return
        }
        consecutiveSkipRef.current = 0
        setIsPlaying(true)
        setIsBuffering(false)
        recordHistory(track)
        return
      } catch (err: any) {
        if (err?.name === 'AbortError' || String(err).includes('interrupted')) {
          return // Ignore play interruption silently
        }
        setIsPlaying(false)
        setIsBuffering(false)
        if (err?.name === 'NotAllowedError' || String(err?.message || '').includes('not allowed')) {
          // Background autoplay / User gesture restriction: Keep stream loaded and resume on next user gesture or visibility restore
          console.warn('[Audio Autoplay Restricted] play() waiting for user activation:', err?.name || err?.message)
          pendingResumeRef.current = true
          return
        }
        if (audioRef.current) {
          try {
            await invalidateCurrentResolution()
            trackResolutionCacheRef.current.delete(activeTrack.id)
            audioUrlCacheRef.current.delete(activeTrack.id)
            if (activeTrack.nhaccuatui_id) {
              clearCachedNctStreamUrl(activeTrack.nhaccuatui_id)
            }
            audioRef.current.pause()
            audioRef.current.removeAttribute('src')
          } catch {}
        }
        console.warn('HTML5 audio stream playback info:', err)
        if (!fallbackAttemptedRef.current.has(requestId)) {
          recordRequestIdFlag(fallbackAttemptedRef.current, requestId)
          void fallbackToYouTube(activeTrack, requestId)
          return
        }
        if (requestId === playRequestRef.current) {
          setIsPlaying(false)
          setIsBuffering(false)
          setPlaybackError(`Không thể phát bài hát "${activeTrack.title}". Vui lòng chọn bài khác.`)
        }
        return
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

      const initialStartTime = consumePendingSeek(initialTime)
      pendingYtPlayRef.current = { videoId: ytId, startTime: initialStartTime, requestId }

      const tryLoadYt = (retries = 25) => {
        if (requestId !== playRequestRef.current) return
        if (ytPlayerRef.current && ytPlayerRef.current.loadVideoById) {
          pendingYtPlayRef.current = null
          try {
            const currentVol = volumeRef.current ?? DEFAULT_VOLUME
            if (currentVol > 0) {
              if (ytPlayerRef.current.unMute) ytPlayerRef.current.unMute()
              if (ytPlayerRef.current.isMuted && ytPlayerRef.current.isMuted()) {
                ytPlayerRef.current.unMute()
              }
            } else {
              if (ytPlayerRef.current.mute) ytPlayerRef.current.mute()
            }
            if (ytPlayerRef.current.setVolume) {
              ytPlayerRef.current.setVolume(currentVol * 100)
            }
            ytLoadedIdRef.current = ytId
            ytPlayerRef.current.loadVideoById({
              videoId: ytId,
              startSeconds: initialStartTime,
            })
            if (ytPlayerRef.current.playVideo) {
              try { ytPlayerRef.current.playVideo() } catch {}
            }
            setIsPlaying(true)
            setIsBuffering(false)
            recordHistory(track)
          } catch (e) {
            console.warn('YT loadVideoById error:', e)
            if (requestId === playRequestRef.current) {
              setIsPlaying(false)
              setIsBuffering(false)
            }
          }
        } else if (retries > 0) {
          setTimeout(() => tryLoadYt(retries - 1), 200)
        } else {
          pendingYtPlayRef.current = null
          if (requestId === playRequestRef.current) {
            setIsPlaying(false)
            setIsBuffering(false)
            setPlaybackError(`Không thể kết nối đến trình phát YouTube cho bài hát "${activeTrack.title}".`)
          }
        }
      }
      tryLoadYt()
    } else {
      if (!fallbackAttemptedRef.current.has(requestId)) {
        recordRequestIdFlag(fallbackAttemptedRef.current, requestId)
        void fallbackToYouTube(activeTrack, requestId)
        return
      }
      if (requestId === playRequestRef.current) {
        setIsPlaying(false)
        setIsBuffering(false)
        setPlaybackError(`Không thể tìm thấy nguồn phát trực tiếp cho bài hát "${activeTrack.title}". Vui lòng chọn bài khác.`)
      }
    }
  }, [
    beginNewPlaybackRequest,
    commitNavigation,
    fallbackToYouTube,
    getAudioUrlCached,
    invalidateCurrentResolution,
    recordHistory,
    recordListenEvent,
    resolveStreamCached,
    stopActivePlaybackEngines,
    triggerSmartQueueFill,
  ])

  // Keep playTrackRef in sync so YouTube onStateChange closure always calls latest version
  playTrackRef.current = playTrack

  const togglePlay = useCallback(async () => {
    const current = currentTrackRef.current
    if (!current) return

    const actionId = ++toggleActionIdRef.current
    const track = inferTrackSource(current)
    const isYt = isYtIframeEngine()
    const audio = audioRef.current

    // Check actual engine playback state to prevent desynchronization when tab is backgrounded
    const isAudioPlaying = Boolean(audio && !audio.paused && !audio.ended && audio.readyState > 1)
    const isYtPlaying = Boolean(isYt && ytPlayerRef.current?.getPlayerState?.() === 1)
    const isCurrentlyActive =
      (isPlaying || isAudioPlaying || isYtPlaying || desiredPlayStateRef.current === 'playing') &&
      desiredPlayStateRef.current !== 'paused'

    if (isCurrentlyActive) {
      // 🛑 PAUSE ACTION: User explicitly intends to pause
      desiredPlayStateRef.current = 'paused'
      if (audio) {
        try {
          audio.pause()
        } catch {}
      }
      if (ytPlayerRef.current?.pauseVideo) {
        try {
          ytPlayerRef.current.pauseVideo()
        } catch {}
      }
      setIsPlaying(false)
      setIsBuffering(false)
      return
    }

    // ▶️ PLAY / RESUME ACTION: User explicitly intends to play
    desiredPlayStateRef.current = 'playing'
    consecutiveSkipRef.current = 0
    if (playRequestRef.current === 0) {
      playRequestRef.current = 1
    }

    if (isYt) {
      if (ytPlayerRef.current && ytReadyRef.current) {
        try {
          const state = ytPlayerRef.current.getPlayerState ? ytPlayerRef.current.getPlayerState() : -1
          // 1 = playing, 2 = paused, 3 = buffering, 5 = video cued
          if (state === 5 || state === 2 || state === 1 || state === 3) {
            ytPlayerRef.current.playVideo()
            if (actionId === toggleActionIdRef.current && desiredPlayStateRef.current === 'playing') {
              setIsPlaying(true)
            }
            return
          }
        } catch (e) {
          console.warn('YT playVideo state check failed:', e)
        }
      }
      // Fallback: If YT player was unstarted (-1), empty, or not cued, start via playTrack
      await playTrack(track, queueRef.current, currentIndexRef.current, currentTimeRef.current)
      return
    }

    // HTML5 audio engine (SoundCloud, NCT, Drive, Local, iOS YouTube proxy)
    if (!audio || !audio.src || audio.src === window.location.href || audio.error) {
      // If audio source is missing, invalid, or errored out (e.g. after reload)
      await playTrack(track, queueRef.current, currentIndexRef.current, currentTimeRef.current)
      return
    }

    // Ensure audio ownership token and volume are synchronized with current track
    audioOwnershipRef.current = {
      generation: audioGenerationRef.current,
      requestId: playRequestRef.current,
      trackId: track.id,
    }
    const safeVolume = volumeRef.current ?? DEFAULT_VOLUME
    audio.volume = safeVolume
    audio.muted = safeVolume === 0
    ensureWebAudioGain()

    try {
      await playAudioElement(audio)
      // Guard: If user clicked Pause while playAudioElement was in-flight, immediately pause and drop
      if (actionId !== toggleActionIdRef.current || (desiredPlayStateRef.current as 'playing' | 'paused' | null) === 'paused') {
        audio.pause()
        setIsPlaying(false)
        return
      }
      setIsPlaying(true)
    } catch (err: any) {
      if (err?.name === 'AbortError' || String(err).includes('interrupted')) {
        if ((desiredPlayStateRef.current as 'playing' | 'paused' | null) === 'paused') {
          setIsPlaying(false)
        }
        return
      }
      if (actionId !== toggleActionIdRef.current || (desiredPlayStateRef.current as 'playing' | 'paused' | null) === 'paused') {
        return
      }
      console.warn('audio.play() failed, re-loading track:', err)
      await playTrack(track, queueRef.current, currentIndexRef.current, currentTimeRef.current)
    }
  }, [isPlaying, isYtIframeEngine, playTrack])

  const seek = useCallback((time: number) => {
    setCurrentTime(time)
    currentTimeRef.current = time

    const active = currentTrackRef.current
    const isYouTubeEngine = (active?.source === 'youtube' || Boolean(active?.youtube_id)) && !ytHtml5ModeRef.current
    const audio = audioRef.current
    const ytEngine = isYouTubeEngine && ytPlayerRef.current?.seekTo
    if (ytEngine && active?.youtube_id === ytLoadedIdRef.current) {
      try {
        ytPlayerRef.current.seekTo(time, true)
      } catch {}
    } else if (audio && audio.src && audio.src !== window.location.href && !audio.error) {
      audio.currentTime = time
    } else {
      // Track still resolving — apply the seek once playback starts
      pendingSeekRef.current = time
    }

    if (active) {
      savePlayerStateToStorage(
        active,
        time,
        queueRef.current,
        currentIndexRef.current,
        volumeRef.current,
        true
      )
    }
  }, [])

  const setVolume = useCallback((val: number) => {
    const safeVol = typeof val === 'number' && !isNaN(val) ? Math.max(0, Math.min(1, val)) : DEFAULT_VOLUME
    volumeRef.current = safeVol
    setVolumeState(safeVol)
    if (audioRef.current) {
      audioRef.current.volume = safeVol
      audioRef.current.muted = safeVol === 0
    }
    // Web Audio GainNode volume attenuation (works on iOS Safari where audio.volume is ignored)
    if (gainNodeRef.current) {
      try {
        gainNodeRef.current.gain.value = safeVol
      } catch {}
    }
    if (ytPlayerRef.current) {
      try {
        if (safeVol === 0) {
          if (ytPlayerRef.current.mute) ytPlayerRef.current.mute()
        } else {
          if (ytPlayerRef.current.unMute) ytPlayerRef.current.unMute()
          if (ytPlayerRef.current.isMuted && ytPlayerRef.current.isMuted()) {
            ytPlayerRef.current.unMute()
          }
        }
        if (ytPlayerRef.current.setVolume) {
          ytPlayerRef.current.setVolume(safeVol * 100)
        }
      } catch {}
    }
  }, [])

  // ⚡ Fast-path: play a track synchronously from the URL cache
  const tryQuickPlayFromCache = useCallback((rawTrack: Track, idx?: number): boolean => {
    if (!rawTrack || typeof window === 'undefined') return false

    // Check if this track was already pre-resolved in cache (e.g. Spotify -> NCT / YouTube / Drive)
    const cachedRes = getBoundedRefreshed(
      trackResolutionCacheRef.current,
      rawTrack.id,
      (entry) => Date.now() >= entry.expiresAt
    )
    const track = cachedRes?.activeTrack || rawTrack

    const classification = classifyTrack(track, isIOSDevice())
    if (classification.needsCatalogResolution && !classification.isDirectPlayable) {
      return false
    }

    let cached = audioUrlCacheRef.current.get(track.id)?.url
    if (!cached && track.source === 'nhaccuatui' && track.nhaccuatui_id) {
      cached = getCachedNctStreamUrl(track.nhaccuatui_id) || undefined
    }

    if (!cached || isPreviewUrl(cached) || !audioRef.current) return false
    const audio = audioRef.current

    const requestId = beginNewPlaybackRequest(track)

    const q = queueRef.current
    let targetIdx = typeof idx === 'number' && idx >= 0 ? idx : q.findIndex((t) => t.id === track.id)
    if (targetIdx < 0) targetIdx = -1

    hasPrewarmedNextTrackRef.current = false
    ytHtml5ModeRef.current = isIOSDevice() && (track.source === 'youtube' || Boolean(track.youtube_id))

    // Commit navigation state synchronously
    commitNavigation(track, targetIdx, q, 0)

    if (targetIdx >= 0 && targetIdx < q.length) {
      setQueue((prevQ) => {
        const synced = [...prevQ]
        synced[targetIdx] = { ...synced[targetIdx], ...track }
        return synced
      })
    }

    stopActivePlaybackEngines('youtube')
    setAudioSourceForPlayback(audio, cached, volumeRef.current ?? DEFAULT_VOLUME, 0)

    audio.play()
      .then(() => {
        if (!isCurrentAudioOwnership()) {
          audio.pause()
          return
        }
        if (requestId !== playRequestRef.current) {
          audio.pause()
          return
        }
        setIsBuffering(false)
        setIsPlaying(true)
        audioRetryCountRef.current = 0
        consecutiveSkipRef.current = 0
        recordHistory(track)
      })
      .catch((err: any) => {
        if (err?.name === 'AbortError' || String(err?.message || '').includes('interrupted')) {
          return // Rapid track change interrupted audio.play() — ignore silently
        }
        if (!isCurrentAudioOwnership()) return
        if (requestId !== playRequestRef.current) return
        setIsBuffering(false)
        setIsPlaying(false)
        if (err?.name === 'NotAllowedError' || String(err?.message || '').includes('not allowed')) {
          pendingResumeRef.current = true
        } else {
          console.warn('Quick-play audio failed, falling back to full resolve:', err?.message || err)
          audioUrlCacheRef.current.delete(track.id)
          if (track.nhaccuatui_id) {
            clearCachedNctStreamUrl(track.nhaccuatui_id)
          }
          playTrack(track, undefined, targetIdx >= 0 ? targetIdx : undefined)
        }
      })

    return true
  }, [beginNewPlaybackRequest, commitNavigation, isCurrentAudioOwnership, playTrack, recordHistory, stopActivePlaybackEngines])

  // Centralized playback controller for navigation convergence
  const playResolvedTrack = useCallback((track: Track, index: number) => {
    const targetIdx = index >= 0 ? index : -1
    if (!tryQuickPlayFromCache(track, targetIdx >= 0 ? targetIdx : undefined)) {
      playTrack(track, undefined, targetIdx >= 0 ? targetIdx : undefined)
    }
  }, [tryQuickPlayFromCache, playTrack])

  const nextTrack = useCallback(() => {
    consecutiveSkipRef.current = 0
    isPrevNextActionRef.current = true
    isBackwardActionRef.current = false

    // 🚀 STEP 1: Check forward history stack first (if user clicked Previous earlier)
    if (forwardHistoryStackRef.current.length > 0) {
      const forwardSong = forwardHistoryStackRef.current.pop()
      if (forwardSong) {
        const q = queueRef.current
        const forwardIndex = q.findIndex((t) => t.id === forwardSong.id)
        playResolvedTrack(forwardSong, forwardIndex)
        if (forwardIndex >= 0 && forwardIndex >= q.length - 2) {
          triggerSmartQueueFill(forwardSong, q)
        }
        return
      }
    }

    // STEP 2: Fallback to queue if forward history is empty
    const q = queueRef.current
    if (q.length === 0) return

    let idx = currentIndexRef.current >= 0 ? currentIndexRef.current : 0
    if (idx < 0) {
      if (currentTrackRef.current) {
        idx = q.findIndex((t) => t.id === currentTrackRef.current?.id)
      }
      if (idx < 0) idx = 0
    }

    let nextIdx = 0
    const preserveOrder = isFullYouTubeQueue(q)
    if (isShuffleRef.current && q.length > 1) {
      if (preserveOrder) {
        do {
          nextIdx = Math.floor(Math.random() * q.length)
        } while (nextIdx === idx)
      } else {
        const candidates: { track: Track; index: number }[] = []
        const fallbackCandidates: { track: Track; index: number }[] = []

        q.forEach((t, i) => {
          if (i === idx) return
          fallbackCandidates.push({ track: t, index: i })
          if (isBackgroundPlayableTrack(t)) {
            candidates.push({ track: t, index: i })
          }
        })

        if (candidates.length > 0) {
          const chosen = candidates[Math.floor(Math.random() * candidates.length)]
          nextIdx = chosen.index
        } else if (fallbackCandidates.length > 0) {
          const chosen = fallbackCandidates[Math.floor(Math.random() * fallbackCandidates.length)]
          nextIdx = chosen.index
        } else {
          nextIdx = idx
        }
      }
    } else {
      nextIdx = (idx + 1) % q.length
    }

    playResolvedTrack(q[nextIdx], nextIdx)

    if (nextIdx >= q.length - 2) {
      triggerSmartQueueFill(q[nextIdx], q)
    }
  }, [playResolvedTrack, triggerSmartQueueFill])

  const prevTrack = useCallback(() => {
    consecutiveSkipRef.current = 0
    isPrevNextActionRef.current = true
    isBackwardActionRef.current = true

    const now = Date.now()
    const isRecentClick = now - lastPrevClickRef.current < 2500
    lastPrevClickRef.current = now

    // Determine current play time across YouTube & HTML5 engines
    let activeTime = currentTimeRef.current
    if ((currentTrackRef.current?.source === 'youtube' || currentTrackRef.current?.youtube_id) && !ytHtml5ModeRef.current) {
      if (ytPlayerRef.current?.getCurrentTime) {
        try {
          activeTime = ytPlayerRef.current.getCurrentTime() || currentTimeRef.current
        } catch {}
      }
    } else if (audioRef.current) {
      activeTime = audioRef.current.currentTime || currentTimeRef.current
    }

    // If played > 3 seconds AND not clicked recently, restart track at 0:00.
    if (activeTime > 3 && !isRecentClick) {
      seek(0)
      isPrevNextActionRef.current = false
      isBackwardActionRef.current = false
      return
    }

    // 🚀 STEP 1: Pop and play true previously played track from history stack!
    if (playedHistoryStackRef.current.length > 0) {
      const prevSong = playedHistoryStackRef.current.pop()
      if (prevSong) {
        if (currentTrackRef.current) {
          forwardHistoryStackRef.current.push(currentTrackRef.current)
        }
        const q = queueRef.current
        const prevIndex = q.findIndex((t) => t.id === prevSong.id)
        playResolvedTrack(prevSong, prevIndex)
        return
      }
    }

    // STEP 2: Fallback to queue if history stack is empty
    const q = queueRef.current
    if (q.length === 0) return

    let idx = currentIndexRef.current >= 0 ? currentIndexRef.current : 0
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

    // Push current track to forward history so Next can restore it
    if (currentTrackRef.current) {
      forwardHistoryStackRef.current.push(currentTrackRef.current)
    }

    playResolvedTrack(q[prevIdx], prevIdx)
  }, [playResolvedTrack, seek])

  nextTrackRef.current = nextTrack
  prevTrackRef.current = prevTrack

  const addToQueue = useCallback((track: Track) => {
    setQueue((prev) => {
      const insertIdx = currentIndexRef.current >= 0 ? currentIndexRef.current + 1 : prev.length
      const newQ = [...prev]
      newQ.splice(insertIdx, 0, track)
      return deduplicateQueueTracks(newQ)
    })
    // Pre-warm the added track's stream URL only if network connection is fast
    if (isFastConnection()) {
      triggerAdaptivePrewarm([track], -1)
    }
  }, [triggerAdaptivePrewarm])

  const removeFromQueue = useCallback((indexToRemove: number) => {
    const activeIndex = currentIndexRef.current
    const isRemovingCurrent = indexToRemove === activeIndex
    setQueue((prev) => prev.filter((_, idx) => idx !== indexToRemove))

    if (activeIndex > indexToRemove) {
      setCurrentIndex((prev) => prev - 1)
      currentIndexRef.current = currentIndexRef.current - 1
    } else if (isRemovingCurrent) {
      // Xoá đúng bài đang phát
      const q = queueRef.current.filter((_, idx) => idx !== indexToRemove)
      if (q.length === 0) {
        setCurrentTrack(null)
        setCurrentIndex(-1)
        currentIndexRef.current = -1
        if (audioRef.current) audioRef.current.pause()
        if (ytPlayerRef.current?.pauseVideo) {
          try { ytPlayerRef.current.pauseVideo() } catch {}
        }
        setIsPlaying(false)
      } else {
        const nextIdx = indexToRemove >= q.length ? q.length - 1 : indexToRemove
        if (!tryQuickPlayFromCache(q[nextIdx], nextIdx)) {
          setCurrentIndex(nextIdx)
          currentIndexRef.current = nextIdx
          playTrack(q[nextIdx], undefined, nextIdx)
        }
      }
    }
  }, [playTrack, tryQuickPlayFromCache])

  const clearQueue = useCallback(() => {
    if (currentTrackRef.current) {
      setQueue([currentTrackRef.current])
      setCurrentIndex(0)
      currentIndexRef.current = 0
    } else {
      setQueue([])
      setCurrentIndex(-1)
      currentIndexRef.current = -1
    }
  }, [])

  const isTabHiddenRef = useRef<boolean>(false)

  // HTML5 Audio Event Listeners
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    html5EngineRef.current.setAudioElement(audio)

    if (typeof document !== 'undefined') {
      isTabHiddenRef.current = document.hidden
      if (document.hidden) {
        document.documentElement.setAttribute('data-tab-hidden', 'true')
      } else {
        document.documentElement.removeAttribute('data-tab-hidden')
      }
    }

    const handleTimeUpdate = () => {
      if (!isCurrentAudioOwnership()) return
      if (!isYtIframeEngine()) {
        const time = audio.currentTime
        currentTimeRef.current = time

        // When tab is hidden (gaming / background mode), skip updating React state
        // to prevent dozens of components from re-rendering on every timeupdate.
        if (!isTabHiddenRef.current) {
          setCurrentTime(time)
        }

        if (time >= 3 && consecutiveSkipRef.current > 0) {
          consecutiveSkipRef.current = 0
        }

        if (Math.abs(time - lastSavedTimeRef.current) > 15 && currentTrackRef.current) {
          lastSavedTimeRef.current = time
          savePlayerStateToStorage(
            currentTrackRef.current,
            currentTimeRef.current,
            queueRef.current,
            currentIndexRef.current,
            volumeRef.current,
            false
          )
        }

        // ⚡ Task 3: Trigger single next-track prewarm only after 5s stable play
        if (!hasPrewarmedNextTrackRef.current && time >= 5 && !isBufferingRef.current) {
          hasPrewarmedNextTrackRef.current = true
          triggerAdaptivePrewarm(queueRef.current, currentIndexRef.current)
        }

        // ── Near-end prewarm: 30s before track ends, warm next track URL ─────────
        // Fires exactly once per track (guard: nextTrackEndPrewarmedRef).
        // Critical on iOS: tryQuickPlayFromCache must get a synchronous hit when
        // handleEnded fires — async resolution triggers NotAllowedError because
        // iOS requires the play() call to happen within the user-gesture chain.
        if (!nextTrackEndPrewarmedRef.current && isFastConnection()) {
          const dur = audio.duration
          if (dur && !isNaN(dur) && dur > 0 && dur !== Infinity) {
            const remaining = dur - time
            if (remaining <= 30 && remaining >= 0) {
              nextTrackEndPrewarmedRef.current = true
              const q = queueRef.current
              const idx = currentIndexRef.current
              // Only prewarm for sequential playback — shuffle order is unpredictable
              if (!isShuffleRef.current && idx >= 0 && q.length > 1) {
                const nextIdx = repeatModeRef.current === 'one' ? idx : (idx + 1) % q.length
                const nextTr = q[nextIdx]
                if (nextTr && nextTr.id) {
                  if (nextTr.source === 'nhaccuatui' && nextTr.nhaccuatui_id) {
                    // Refresh NCT stream URL cache (5-min TTL — may have expired since track start)
                    prewarmNctStreamUrl(nextTr.nhaccuatui_id).catch(() => {})
                  } else if (isIOSDevice() && (nextTr.source === 'youtube' || Boolean(nextTr.youtube_id))) {
                    // ⚠️ Disabled: HEAD requests for YouTube can cause the browser to reload
                    // playback when InnerTube resolution completes. YouTube streams should
                    // be resolved naturally on play, not pre-warmed.
                    // const ytId = nextTr.youtube_id
                    // if (ytId) { fetch(buildYouTubeStreamUrl(ytId), { method: 'HEAD' }).catch(() => {}) }
                  } else if (!audioUrlCacheRef.current.has(nextTr.id)) {
                    // Other sources: warm the in-memory audio URL cache
                    getAudioUrlCached(nextTr).catch(() => {})
                  }
                }
              }
            }
          }
        }
      }
    }


    const handleLoadedMetadata = () => {
      if (!isCurrentAudioOwnership()) return
      if (!isYtIframeEngine()) {
        const loadedDuration = audio.duration || 0
        if (loadedDuration > 0 && !isNaN(loadedDuration) && loadedDuration !== Infinity) {
          setDuration(loadedDuration)
        }

        if (currentTrackRef.current && loadedDuration > 3 && (!currentTrackRef.current.duration || currentTrackRef.current.duration === 0)) {
          currentTrackRef.current.duration = Math.round(loadedDuration)
        }
      }
    }

    const handleError = async () => {
      // Ignore error events from cleared audio sources (fired after
      // removeAttribute('src') + load() during track switching).
      if (!audio.src || audio.src === window.location.href) return
      if (!isCurrentAudioOwnership()) return
      const requestId = playRequestRef.current
      if (!isYtIframeEngine()) {
        const current = currentTrackRef.current
        if (!current) return

        // Invalidate broken stream resolution from caches immediately
        await invalidateCurrentResolution()
        trackResolutionCacheRef.current.delete(current.id)
        audioUrlCacheRef.current.delete(current.id)

        // ── Parallel: NCT retry + YouTube search simultaneously ─────────────────
        // This saves ~700ms because YouTube search runs while NCT retry is pending.
        // If NCT succeeds → cancel YouTube search. If NCT fails → use pre-fetched result.
        const isNct = Boolean(
          current?.source === 'nhaccuatui' ||
          current?.nhaccuatui_id
        )
        if (isNct && current && current.nhaccuatui_id && !nctRetriedRef.current.has(requestId)) {
          recordRequestIdFlag(nctRetriedRef.current, requestId)

          const searchQuery = `${current.title} ${current.artist || ''}`.trim()
          // Start YouTube search IMMEDIATELY — don't wait for NCT to fail first
          const searchPromise = (async () => {
            try {
              const data = await fetchUnifiedSearch(searchQuery, 'youtube')
              if (!data?.youtube?.length) return null
              return findBestYouTubeMatch(data.youtube, current.title, current.artist, current.duration, current.album)
            } catch {
              return null
            }
          })()

          if (
            audioRef.current &&
            isCurrentAudioOwnership() &&
            isCurrentPlayback({
              requestId,
              currentRequestId: playRequestRef.current,
              trackId: current.id,
              currentTrackId: currentTrackRef.current?.id,
            })
          ) {
            const fallbackUrl = `/api/nhaccuatui/stream?id=${encodeURIComponent(current.nhaccuatui_id)}`
            console.log('[NCT Auto-Retry] Worker stream failed, switching to native Next.js stream proxy (YouTube search running in parallel):', fallbackUrl)
            audioRef.current.src = fallbackUrl
            audioRef.current.load()

            // Race: wait for NCT play OR timeout. If NCT fails → use pre-searched YouTube result.
            let nctSucceeded = false
            const NCT_RACE_TIMEOUT_MS = 4000 // Give NCT 4s to start playing before bailing

            audioRef.current.play().then(() => {
              nctSucceeded = true
              if (!isCurrentAudioOwnership()) return
              setIsPlaying(true)
              setIsBuffering(false)
              setPlaybackError(null)
            }).catch(() => {})

            try {
              await Promise.race([
                new Promise<void>((resolve) => {
                  const check = () => {
                    if (nctSucceeded || !isCurrentAudioOwnership()) {
                      resolve()
                      return
                    }
                    if (requestId !== playRequestRef.current) {
                      resolve()
                      return
                    }
                    setTimeout(check, 100)
                  }
                  setTimeout(check, 100)
                }),
                new Promise<void>((resolve) => setTimeout(() => resolve(), NCT_RACE_TIMEOUT_MS))
              ])
            } catch {}

            if (!nctSucceeded && isCurrentAudioOwnership() && requestId === playRequestRef.current) {
              console.log('[NCT Auto-Retry] NCT play timeout, using pre-fetched YouTube result...')
              const preSearchedTrack = await searchPromise
              void fallbackToYouTube(current, requestId, preSearchedTrack)
            }
            return
          }
        }

        if (!isCurrentAudioOwnership()) return

        // Self-healing for SoundCloud: If signed stream token expired (403), auto re-resolve with bypass cache ONCE
        const isSoundCloud = Boolean(
          current?.source === 'soundcloud' ||
          current?.soundcloud_id ||
          current?.id?.startsWith('sc-')
        )
        if (isSoundCloud && current && !scRetriedRef.current.has(requestId)) {
          console.log('[SoundCloud Auto-Retry] Audio playback error, requesting fresh stream URL with bypass cache...')
          recordRequestIdFlag(scRetriedRef.current, requestId)
          try {
            audioUrlCacheRef.current.delete(current.id)
            const freshUrl = await getAudioUrl(current, true)
            if (!isCurrentAudioOwnership()) return
            if (
              freshUrl &&
              audioRef.current &&
              isCurrentPlayback({
                requestId,
                currentRequestId: playRequestRef.current,
                trackId: current.id,
                currentTrackId: currentTrackRef.current?.id,
              })
            ) {
              const savedTime = currentTimeRef.current || audioRef.current.currentTime || 0
              audioRef.current.src = freshUrl
              audioRef.current.load()
              if (savedTime > 0) {
                audioRef.current.currentTime = savedTime
              }
              audioRef.current.play().then(() => {
                if (!isCurrentAudioOwnership()) return
                setIsPlaying(true)
                setIsBuffering(false)
                setPlaybackError(null)
              }).catch((err) => {
                if (!isCurrentAudioOwnership()) return
                console.warn('[SoundCloud Auto-Retry] play failed:', err)
                void fallbackToYouTube(current, requestId)
              })
              return
            }
          } catch (retryErr) {
            console.warn('[SoundCloud Auto-Retry] Error fetching fresh audio URL:', retryErr)
          }
        }

        if (!isCurrentAudioOwnership()) return

        // Fallback to YouTube for ANY failed audio track (NCT, SoundCloud, Drive, Local, Catalog)
        if (!fallbackAttemptedRef.current.has(requestId)) {
          recordRequestIdFlag(fallbackAttemptedRef.current, requestId)
          await fallbackToYouTube(current, requestId)
          return
        }

        if (!isCurrentAudioOwnership()) return
        if (requestId !== playRequestRef.current) return
        consecutiveSkipRef.current += 1
        setIsPlaying(false)
        setIsBuffering(false)
        setDuration(0)
        if (consecutiveSkipRef.current >= MAX_CONSECUTIVE_SKIPS) {
          console.warn(`[Circuit Breaker] Tripped after ${consecutiveSkipRef.current} consecutive errors. Stopping auto-advance.`)
          setPlaybackError(
            `Đã dừng tự động chuyển bài do có ${consecutiveSkipRef.current} bài hát liên tiếp gặp sự cố kết nối/nguồn phát. Vui lòng chọn bài khác.`
          )
          return
        }
        const mediaError = audio.error
        setPlaybackError(
          `Audio lỗi${mediaError?.code ? ` (mã ${mediaError.code})` : ''}: ${
            mediaError?.message || 'không đọc được file'
          }`
        )
      }
    }

    const clearAudioStallWatchdog = () => {
      if (audioStallWatchdogRef.current) {
        clearTimeout(audioStallWatchdogRef.current)
        audioStallWatchdogRef.current = null
      }
    }

    const triggerAudioStallWatchdog = () => {
      if (audioStallWatchdogRef.current) return
      audioStallWatchdogRef.current = setTimeout(async () => {
        audioStallWatchdogRef.current = null
        if (!isCurrentAudioOwnership()) return
        const current = currentTrackRef.current
        if (!current) return

        const isSoundCloud = Boolean(
          current.source === 'soundcloud' ||
          current.soundcloud_id ||
          current.id?.startsWith('sc-')
        )

        const activeRequestId = playRequestRef.current
        if (isSoundCloud && !scStallRecoveredRef.current.has(activeRequestId)) {
          console.warn(`[SoundCloud Watchdog] Playback stalled for >${AUDIO_STALL_WATCHDOG_TIMEOUT_MS}ms, auto-refreshing stream URL...`)
          recordRequestIdFlag(scStallRecoveredRef.current, activeRequestId)
          try {
            audioUrlCacheRef.current.delete(current.id)
            const freshUrl = await getAudioUrl(current, true)
            if (!isCurrentAudioOwnership()) return
            if (freshUrl && audioRef.current) {
              const savedTime = currentTimeRef.current || audioRef.current.currentTime || 0
              audioRef.current.src = freshUrl
              audioRef.current.load()
              if (savedTime > 0) {
                audioRef.current.currentTime = savedTime
              }
              audioRef.current.play().then(() => {
                if (!isCurrentAudioOwnership()) return
                setIsPlaying(true)
                setIsBuffering(false)
              }).catch(() => {})
            }
          } catch (e) {
            console.warn('[SoundCloud Watchdog] Recovery failed:', e)
          }
          return
        }

        // Universal stall recovery for all other sources (NCT, Drive, Local, Catalog)
        if (!fallbackAttemptedRef.current.has(activeRequestId)) {
          console.warn(`[Audio Watchdog] ${current.source || 'Audio'} stream stalled >${AUDIO_STALL_WATCHDOG_TIMEOUT_MS}ms — attempting YouTube fallback...`)
          recordRequestIdFlag(fallbackAttemptedRef.current, activeRequestId)

          const searchQuery = `${current.title} ${current.artist || ''}`.trim()
          const searchPromise = (async () => {
            try {
              const data = await fetchUnifiedSearch(searchQuery, 'youtube')
              if (!data?.youtube?.length) return null
              return findBestYouTubeMatch(data.youtube, current.title, current.artist, current.duration, current.album)
            } catch {
              return null
            }
          })()

          void searchPromise.then((preSearchedTrack) => {
            if (isCurrentAudioOwnership() && playRequestRef.current === activeRequestId) {
              void fallbackToYouTube(current, activeRequestId, preSearchedTrack)
            }
          })
          return
        }

        // Circuit breaker: Fallback already attempted or failed on this request, stop spinning
        if (isCurrentAudioOwnership() && playRequestRef.current === activeRequestId) {
          consecutiveSkipRef.current += 1
          setIsPlaying(false)
          setIsBuffering(false)
          if (consecutiveSkipRef.current >= MAX_CONSECUTIVE_SKIPS) {
            console.warn(`[Circuit Breaker] Tripped after ${consecutiveSkipRef.current} consecutive errors. Stopping auto-advance.`)
            setPlaybackError(
              `Đã dừng tự động chuyển bài do có ${consecutiveSkipRef.current} bài hát liên tiếp gặp sự cố kết nối/nguồn phát. Vui lòng chọn bài khác.`
            )
          } else {
            setPlaybackError(`Không thể tải luồng phát cho bài hát "${current.title}". Vui lòng thử lại hoặc chọn bài khác.`)
          }
        }
      }, AUDIO_STALL_WATCHDOG_TIMEOUT_MS)

    }

    const handleEnded = () => {
      clearAudioStallWatchdog()
      if (!isYtIframeEngine()) {
        if (!isCurrentAudioOwnership()) return
        if (!audio.ended) return
        if (consecutiveSkipRef.current >= MAX_CONSECUTIVE_SKIPS) {
          console.warn('[Circuit Breaker] Auto-advance blocked by consecutive skip limit.')
          setIsPlaying(false)
          return
        }
        recordListenEvent(currentTrackRef.current, true)
        const mode = repeatModeRef.current
        if (mode === 'one') {
          if (audioRef.current) {
            audioRef.current.currentTime = 0
            audioRef.current.play().then(() => {
              setIsPlaying(true)
            }).catch(() => {})
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

    const handlePlay = () => {
      if (!isCurrentAudioOwnership()) return
      if (!isYtIframeEngine()) {
        setIsPlaying(true)
      }
    }

    const handlePause = () => {
      if (!isCurrentAudioOwnership()) return
      if (!isYtIframeEngine()) {
        setIsPlaying(false)
      }
    }

    const handleWaiting = () => {
      if (!isCurrentAudioOwnership()) return
      setIsBuffering(true)
      triggerAudioStallWatchdog()
    }
    const handleStalled = () => {
      if (!isCurrentAudioOwnership()) return
      setIsBuffering(true)
      triggerAudioStallWatchdog()
    }
    const handleLoadStart = () => {
      if (!isCurrentAudioOwnership()) return
      setIsBuffering(true)
    }
    const handleCanPlay = () => {
      clearAudioStallWatchdog()
      if (!isCurrentAudioOwnership()) return
      setIsBuffering(false)
      // Retry a background play() that was rejected by iOS for lacking a fresh gesture
      if (pendingResumeRef.current && audioRef.current && audioRef.current.paused) {
        pendingResumeRef.current = false
        audioRef.current.play().then(() => {
          setIsPlaying(true)
        }).catch(() => {
          pendingResumeRef.current = true
        })
      }
    }
    const handlePlaying = () => {
      clearAudioStallWatchdog()
      if (!isCurrentAudioOwnership()) return
      setIsBuffering(false)
      setIsPlaying(true)
      audioRetryCountRef.current = 0
    }
    const handleVisibilityChange = () => {
      const isHidden = typeof document !== 'undefined' && document.hidden
      isTabHiddenRef.current = isHidden

      if (typeof document !== 'undefined') {
        if (isHidden) {
          document.documentElement.setAttribute('data-tab-hidden', 'true')
          // ⚡ Task 4: Immediate flush on tab hidden / iOS app backgrounding
          if (currentTrackRef.current) {
            savePlayerStateToStorage(
              currentTrackRef.current,
              currentTimeRef.current,
              queueRef.current,
              currentIndexRef.current,
              volumeRef.current,
              true
            )
          } else {
            persistenceScheduler.flushPending()
          }
        } else {
          document.documentElement.removeAttribute('data-tab-hidden')
        }
      }

      if (!isHidden) {
        const activeAudio = audioRef.current
        const ytActive = isYtIframeEngine()

        // 1. Wake up Web Audio AudioContext if suspended by the browser while hidden
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
          audioContextRef.current.resume().catch((e) => {
            console.warn('[WebAudio] Visibility resume error:', e)
          })
        }

        // 2. Tab restored: immediately sync UI currentTime & duration to real audio/video position
        if (ytActive && ytPlayerRef.current?.getCurrentTime) {
          try {
            const ytTime = ytPlayerRef.current.getCurrentTime() || 0
            currentTimeRef.current = ytTime
            setCurrentTime(ytTime)
            if (ytPlayerRef.current.getDuration) {
              const dur = ytPlayerRef.current.getDuration() || 0
              if (dur > 0) setDuration(dur)
            }
          } catch {}
        } else if (activeAudio) {
          const actualTime = activeAudio.currentTime || 0
          currentTimeRef.current = actualTime
          setCurrentTime(actualTime)
          if (activeAudio.duration && !isNaN(activeAudio.duration) && activeAudio.duration > 0) {
            setDuration(Math.round(activeAudio.duration))
          }
        }

        // 3. Reconcile playback state with user intent (desiredPlayStateRef)
        const userWantsToPlay = desiredPlayStateRef.current === 'playing'

        if (ytActive) {
          try {
            const ytState = ytPlayerRef.current?.getPlayerState?.()
            if (ytState === 1) {
              setIsPlaying(true)
              setIsBuffering(false)
            } else if (userWantsToPlay && (ytState === 2 || ytState === 3 || ytState === -1)) {
              // YouTube player was paused or buffering due to background throttling while user still intends to play
              try {
                ytPlayerRef.current?.playVideo?.()
                setIsPlaying(true)
                setIsBuffering(false)
              } catch (ytErr) {
                console.warn('[YouTube Visibility Resume] playVideo() failed:', ytErr)
                setIsPlaying(false)
                setIsBuffering(false)
              }
            } else if (ytState === 2 && !userWantsToPlay) {
              setIsPlaying(false)
              setIsBuffering(false)
            }
          } catch (e) {
            console.warn('[YouTube Visibility Sync] error:', e)
          }
        } else if (activeAudio) {
          if (!activeAudio.paused && !activeAudio.ended && activeAudio.readyState > 1) {
            setIsPlaying(true)
            setIsBuffering(false)
          } else if (userWantsToPlay && activeAudio.paused && !activeAudio.ended && activeAudio.src) {
            pendingResumeRef.current = false
            activeAudio.play().then(() => {
              setIsPlaying(true)
              setIsBuffering(false)
            }).catch((playErr: any) => {
              console.warn('[HTML5 Audio Visibility Resume] play() rejected:', playErr?.name || playErr?.message || playErr)
              pendingResumeRef.current = true
              setIsPlaying(false)
              setIsBuffering(false)
            })
          } else if (activeAudio.paused && !pendingResumeRef.current) {
            setIsPlaying(false)
          }
        }

        // 4. Resume audio if pending user-gesture / background resume
        if (pendingResumeRef.current && activeAudio && activeAudio.paused && activeAudio.src) {
          pendingResumeRef.current = false
          activeAudio.play().then(() => {
            setIsPlaying(true)
            setIsBuffering(false)
          }).catch((resumeErr: any) => {
            console.warn('[Pending Resume] play() requires user activation:', resumeErr?.name || resumeErr?.message)
            pendingResumeRef.current = true
          })
        }
      }
    }

    // Direct User Activation Handler: Wakes up pending playback on first click/touch if browser blocked autoplay
    const handleUserActivation = () => {
      if (!pendingResumeRef.current) return
      const activeAudio = audioRef.current
      const ytActive = isYtIframeEngine()
      pendingResumeRef.current = false

      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {})
      }

      if (ytActive) {
        try {
          ytPlayerRef.current?.playVideo?.()
          setIsPlaying(true)
          setIsBuffering(false)
        } catch {}
      } else if (activeAudio && activeAudio.paused && !activeAudio.ended && activeAudio.src) {
        activeAudio.play().then(() => {
          setIsPlaying(true)
          setIsBuffering(false)
        }).catch((err: any) => {
          console.warn('[User Activation Resume] play() failed:', err?.name || err?.message)
          pendingResumeRef.current = true
        })
      }
    }

    const handlePageHide = () => {
      if (currentTrackRef.current) {
        savePlayerStateToStorage(
          currentTrackRef.current,
          currentTimeRef.current,
          queueRef.current,
          currentIndexRef.current,
          volumeRef.current,
          true
        )
      } else {
        persistenceScheduler.flushPending()
      }
    }

    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
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
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handlePageHide)
    window.addEventListener('pointerdown', handleUserActivation, { passive: true })
    window.addEventListener('keydown', handleUserActivation, { passive: true })

    return () => {
      stopActivePlaybackEngines('all')
      clearAudioStallWatchdog()
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
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
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handlePageHide)
      persistenceScheduler.flushPending()
      window.removeEventListener('pointerdown', handleUserActivation)
      window.removeEventListener('keydown', handleUserActivation)
      if (typeof document !== 'undefined') {
        document.documentElement.removeAttribute('data-tab-hidden')
      }
    }
  }, [])

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

  // Media Session API Sync: Metadata (Title, Artist, Album, Artwork)
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
    } catch (err) {
      console.warn('MediaSession metadata update error:', err)
    }
  }, [currentTrack?.title, currentTrack?.artist, currentTrack?.cover_url, currentTrack?.album])

  // Media Session API Sync: Action Handlers (Lock Screen Controls & Mobile Background Playback)
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator) || !currentTrack?.id) return

    try {
      // Helper to determine if YouTube iframe engine is active (vs iOS HTML5 proxy mode)
      const isYouTubeIframeActive = () =>
        (currentTrackRef.current?.source === 'youtube' || Boolean(currentTrackRef.current?.youtube_id)) && !ytHtml5ModeRef.current

      // Helper to determine if iOS HTML5 YouTube mode is active
      const isIOSYouTubeHtml5Mode = () =>
        (currentTrackRef.current?.source === 'youtube' || Boolean(currentTrackRef.current?.youtube_id)) && ytHtml5ModeRef.current

      navigator.mediaSession.setActionHandler('play', () => {
        void (async () => {
          // iOS HTML5 YouTube mode: audio element handles playback, no iframe needed
          if (isIOSYouTubeHtml5Mode()) {
            if (!audioRef.current) return
            try {
              await playAudioElement(audioRef.current)
              setIsPlaying(true)
            } catch (err) {
              setIsPlaying(false)
              console.warn('Media Session iOS YouTube audio play failed:', err)
            }
            return
          }

          // Standard YouTube iframe engine
          if (isYouTubeIframeActive() && ytPlayerRef.current?.playVideo) {
            try {
              ytPlayerRef.current.playVideo()
              setIsPlaying(true)
            } catch (err) {
              setIsPlaying(false)
              console.warn('Media Session YouTube play failed:', err)
            }
            return
          }

          // All other audio sources (NCT, SoundCloud, Drive, local, etc.)
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
        // iOS HTML5 YouTube mode: use audio element
        if (isIOSYouTubeHtml5Mode()) {
          if (audioRef.current) audioRef.current.pause()
          setIsPlaying(false)
          return
        }

        // Standard YouTube iframe engine
        if (isYouTubeIframeActive() && ytPlayerRef.current?.pauseVideo) {
          try { ytPlayerRef.current.pauseVideo() } catch {}
        } else if (audioRef.current) {
          audioRef.current.pause()
        }
        setIsPlaying(false)
      })

      navigator.mediaSession.setActionHandler('previoustrack', () => prevTrackRef.current())
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrackRef.current())

      // We deliberately DO NOT set 'seekto', 'seekbackward', or 'seekforward' handlers.
      // Setting 'seekto' causes Chrome on Android to replace the Next/Prev track buttons
      // with 10-second rewind/forward buttons in the background media notification.
      // By omitting them, the OS defaults to displaying the 'previoustrack' and 'nexttrack' buttons.
      try {
        navigator.mediaSession.setActionHandler('seekbackward', null)
        navigator.mediaSession.setActionHandler('seekforward', null)
        navigator.mediaSession.setActionHandler('seekto', null)
      } catch (e) {}

      try {
        navigator.mediaSession.setActionHandler('stop', () => {
          // iOS HTML5 YouTube mode: use audio element
          if (isIOSYouTubeHtml5Mode()) {
            if (audioRef.current) audioRef.current.pause()
            setIsPlaying(false)
            return
          }

          // Standard YouTube iframe engine
          if (isYouTubeIframeActive() && ytPlayerRef.current?.pauseVideo) {
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
  }, [currentTrack?.id, seek])

  // Playback state — only re-run when play state changes (NOT every frame)
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator) || !currentTrack) return
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused'
    } catch (err) {
      // silently ignore
    }
  }, [currentTrack, isPlaying])

  // MediaSession position — poll via 1s interval to avoid 60fps useEffect overhead
  useEffect(() => {
    if (typeof window === 'undefined' || !('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return
    if (!isPlaying || !currentTrack) return

    const interval = setInterval(() => {
      try {
        const d = duration > 0 ? duration : (currentTrack?.duration || 0)
        const t = currentTime
        if (d > 0 && t >= 0) {
          navigator.mediaSession.setPositionState({
            duration: Math.max(d, 0),
            playbackRate: 1,
            position: Math.min(Math.max(t, 0), d),
          })
        }
      } catch (e) {}
    }, 1000)

    return () => clearInterval(interval)
  }, [currentTrack, isPlaying]) // eslint-disable-line react-hooks/exhaustive-deps



  const effectiveDuration = duration > 0 ? duration : (currentTrack?.duration || 0)

  const progressValue = useMemo(() => ({ currentTime, duration: effectiveDuration }), [currentTime, duration, currentTrack?.duration])

  const controlsValue = useMemo<PlayerControlsContextType>(
    () => ({
      playTrack,
      togglePlay,
      seek,
      setVolume,
      nextTrack,
      prevTrack,
      toggleShuffle,
      toggleRepeat,
      toggleFavoriteCurrentTrack,
      addToQueue,
      removeFromQueue,
      clearQueue,
      toggleQueue,
      closeQueue,
      toggleNowPlayingOverlay,
      openNowPlayingOverlay,
      closeNowPlayingOverlay,
    }),
    [
      playTrack,
      togglePlay,
      seek,
      setVolume,
      nextTrack,
      prevTrack,
      toggleShuffle,
      toggleRepeat,
      toggleFavoriteCurrentTrack,
      addToQueue,
      removeFromQueue,
      clearQueue,
      toggleQueue,
      closeQueue,
      toggleNowPlayingOverlay,
      openNowPlayingOverlay,
      closeNowPlayingOverlay,
    ]
  )

  const trackValue = useMemo<PlayerTrackContextType>(
    () => ({
      currentTrack,
      isPlaying,
      isBuffering,
      volume,
      isShuffle,
      repeatMode,
      playbackError,
      frequencyData,
      audioRef,
      mvIntroOffset,
    }),
    [
      currentTrack,
      isPlaying,
      isBuffering,
      volume,
      isShuffle,
      repeatMode,
      playbackError,
      frequencyData,
      mvIntroOffset,
    ]
  )

  const queueValue = useMemo<PlayerQueueContextType>(
    () => ({
      queue,
      currentIndex,
      isQueueOpen,
      isNowPlayingOpen,
      addToQueue,
      removeFromQueue,
      clearQueue,
    }),
    [
      queue,
      currentIndex,
      isQueueOpen,
      isNowPlayingOpen,
      addToQueue,
      removeFromQueue,
      clearQueue,
    ]
  )

  const playerValue = useMemo<PlayerContextType>(
    () => ({
      ...trackValue,
      ...controlsValue,
      ...queueValue,
    }),
    [trackValue, controlsValue, queueValue]
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
    <PlayerControlsContext.Provider value={controlsValue}>
      <PlayerTrackContext.Provider value={trackValue}>
        <PlayerQueueContext.Provider value={queueValue}>
          <PlayerContext.Provider value={playerValue}>
            <PlaybackProgressContext.Provider value={progressValue}>
              {children}
              {/* preload="auto" — buffer audio frames. webkit-playsinline for iOS background audio */}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio
                ref={audioRef}
                preload="auto"
                playsInline
                crossOrigin="anonymous"
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
        </PlayerQueueContext.Provider>
      </PlayerTrackContext.Provider>
    </PlayerControlsContext.Provider>
  )
}

export function usePlayer() {
  const context = useContext(PlayerContext)
  if (!context) {
    throw new Error('usePlayer must be used within a PlayerProvider')
  }
  return context
}
