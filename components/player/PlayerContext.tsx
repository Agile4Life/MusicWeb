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
import { isIOSDevice, playAudioElement, redactAudioSource, shouldUseHtml5Audio, toPersistedTrack } from '@/lib/audioPlayback'
import { isCurrentPlayback } from '@/lib/playbackRaceGuards'
import { getNhacCuaTuiStreamUrl, resolveNhacCuaTuiSong, resolveNhacCuaTuiTrack } from '@/lib/nhaccuatuiClient'
import { resolveStreamCached, invalidateStreamResolution } from '@/lib/resolveStreamClient'
import { setAudioSourceForPlayback } from './audioSourceSwitch'

export type RepeatMode = 'off' | 'all' | 'one'

// Tracks that can keep playing in the background (resolvable to a direct HTML5 stream
// without runtime matching). YouTube tracks resolve through the /api/youtube/stream proxy.
function isBackgroundPlayableTrack(t: Track | null | undefined): boolean {
  if (!t) return false
  if (t.youtube_id || t.source === 'youtube') return true
  if (t.nhaccuatui_id || t.source === 'nhaccuatui') return true
  if (t.soundcloud_id || t.source === 'soundcloud') return true
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
  isNowPlayingOpen: boolean
  toggleNowPlayingOverlay: () => void
  openNowPlayingOverlay: () => void
  closeNowPlayingOverlay: () => void
  frequencyData: Uint8Array
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

  const toggleQueue = useCallback(() => setIsQueueOpen((prev) => !prev), [])
  const closeQueue = useCallback(() => setIsQueueOpen(false), [])

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioRetryCountRef = useRef(0)
  const ytPlayerRef = useRef<any>(null)
  const ytReadyRef = useRef<boolean>(false)
  const ytStuckTimerRef = useRef<any>(null)
  const playRequestRef = useRef(0)
  const ytLoadedIdRef = useRef<string | null>(null)
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

  const currentTrackRef = useRef<Track | null>(null)
  const queueRef = useRef<Track[]>([])
  const currentIndexRef = useRef<number>(-1)
  const volumeRef = useRef<number>(0.8)
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

  const isCurrentAudioOwnership = useCallback(() => {
    const token = audioOwnershipRef.current
    return (
      token.generation === audioGenerationRef.current &&
      token.requestId === playRequestRef.current &&
      token.trackId === currentTrackRef.current?.id
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
    if (!actualVideoId) return false
    return actualVideoId === active.youtube_id
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

    savePlayerStateToStorage(track, time, targetQueue, targetIndex, volumeRef.current || volume)
  }, [volume])

  // Centralized playback controller for navigation convergence
  const playResolvedTrack = (track: Track, index: number) => {
    const targetIdx = index >= 0 ? index : -1
    if (!tryQuickPlayFromCache(track, targetIdx >= 0 ? targetIdx : undefined)) {
      playTrack(track, undefined, targetIdx >= 0 ? targetIdx : undefined)
    }
  }

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

  // Refresh vị trí LRU khi đọc — nếu entry đã hết hạn (TTL), tự xoá (evict) và trả về undefined.
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

  // Track consecutive auto skips to prevent infinite skip loops when multiple tracks fail
  const consecutiveSkipRef = useRef(0)
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
        return `/api/youtube/stream?id=${encodeURIComponent(track.youtube_id)}`
      }

      if (track.source === 'audius' || (track.audio_url && !isPreviewUrl(track.audio_url) && !track.youtube_id && !track.nhaccuatui_id && !track.soundcloud_id)) {
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

  const getAudioUrlCached = useCallback(
    async (track: Track): Promise<string | null> => {
      if (!track || !track.id) return null
      // NCT stream URLs are dynamic/signed XML tokens; SoundCloud can now be cached safely in memory
      if (track.source === 'nhaccuatui') return getAudioUrl(track)
      // Catalog/preview tracks should NOT cache preview URLs as playable full-length audio!
      if (
        (track.audio_url && isPreviewUrl(track.audio_url)) ||
        (track.file_path && isPreviewUrl(track.file_path)) ||
        track.source === 'spotify' ||
        track.source === 'itunes'
      ) {
        return null
      }
      const cached = getBoundedRefreshed(
        audioUrlCacheRef.current,
        track.id,
        (entry) => Date.now() - entry.ts >= URL_CACHE_TTL
      )
      if (cached) {
        return cached.url
      }
      const url = await getAudioUrl(track)
      if (url && !isPreviewUrl(url)) {
        setBounded(audioUrlCacheRef.current, track.id, { url, ts: Date.now() }, AUDIO_URL_MAX_ENTRIES)
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
        const targetTrackId = nextTr.id
        const hasDirectPlayable = Boolean(
          nextTr.audio_url ||
          nextTr.drive_file_id ||
          extractDriveFileId(nextTr.file_path || '') ||
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

        if (!hasDirectPlayable && !resolvingTrackIdsRef.current.has(targetTrackId)) {
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
              } else if (resolved.source === 'drive') {
                updatedTrack = { source: 'local' as const, file_path: resolved.id } as Partial<Track> as Track
              } else if (resolved.source === 'youtube') {
                updatedTrack = { source: 'youtube' as const, youtube_id: resolved.id } as Partial<Track> as Track
              }
              if (!updatedTrack) return

              // Cache resolution in trackResolutionCacheRef for instant playback
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
      }
    }
  }, [currentIndex, queue.map((t) => t.id).join(','), getAudioUrlCached]) // eslint-disable-line react-hooks/exhaustive-deps



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

  const toggleShuffle = useCallback(() => {
    setIsShuffle((prev) => !prev)
  }, [])

  const toggleRepeat = useCallback(() => {
    setRepeatMode((prev) => {
      if (prev === 'off') return 'all'
      if (prev === 'all') return 'one'
      return 'off'
    })
  }, [])

  const toggleFavoriteCurrentTrack = async () => {
    if (!currentTrack) return
    const nextValue = !currentTrack.is_favorite
    setCurrentTrack((prev) => (prev ? { ...prev, is_favorite: nextValue } : null))

    try {
      let dbTrackId = currentTrack.id

      // If track is from external source (YouTube, iTunes, Audius), ensure it exists in tracks table
      if (currentTrack.source && currentTrack.source !== 'local') {
        const { data: { user: currentUser } } = await supabase.auth.getUser()
        const activeUser =
          currentUser ||
          (nextAuthSession?.user
            ? { id: nextAuthSession.user.email, email: nextAuthSession.user.email }
            : null)
        const userId = activeUser ? getValidUserId(activeUser) : null
        if (userId) {
          const resolvedId = await resolveExternalTrackId(supabase, currentTrack, userId)
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

                const actualVideoId = getActualYouTubeVideoId()
                if (!actualVideoId || actualVideoId !== active.youtube_id) {
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

                // Cold-start / kẹt-buffering watchdog: nếu BUFFERING kéo dài > 800ms,
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
                }, 800)
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
                if (!actualVideoId || actualVideoId !== activeForEnded.youtube_id) {
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
                // Cold-start watchdog: if stuck in cued/unstarted for > 800ms, auto-trigger playVideo() ONLY if active track is YouTube
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
                }, 800)
              }
            },
            onError: async (err: any) => {
              console.warn('YouTube Player Error:', err)
              const active = currentTrackRef.current
              if (!active?.youtube_id) return

              const actualVideoId = getActualYouTubeVideoId()
              if (actualVideoId && actualVideoId !== active.youtube_id) {
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

              if (active && isEmbedError && !(active as any)._ytRetried) {
                console.log('[YouTube Fallback] Error 150/101/100 encountered, attempting automatic fallback match...')
                ;(active as any)._ytRetried = true
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
    audioRequestRef.current = requestId
    clearPlaybackTimers()
    audioRetryCountRef.current = 0

    // ⚡ FIX #1: snapshot engine của track SẮP BỊ THAY THẾ trước khi reset state.
    const previousTrackUsedYouTubeHtml5 = ytHtml5ModeRef.current
    const track = inferTrackSource(rawTrack)

    audioOwnershipRef.current = {
      generation: ++audioGenerationRef.current,
      requestId,
      trackId: track.id,
    }
    resolutionIdentityRef.current = null

    // 🚀 Push currentTrack onto true playback history stack when user changes track
    if (currentTrackRef.current && currentTrackRef.current.id !== track.id) {
      let activeTime = currentTime
      if (
        currentTrackRef.current.source === 'youtube' &&
        !previousTrackUsedYouTubeHtml5 &&
        ytPlayerRef.current?.getCurrentTime
      ) {
        try { activeTime = ytPlayerRef.current.getCurrentTime() || currentTime } catch {}
      } else if (audioRef.current) {
        activeTime = audioRef.current.currentTime || currentTime
      }
      const trackDur = currentTrackRef.current.duration || 0
      if (activeTime > 2 && (trackDur === 0 || activeTime < trackDur - 5)) {
        recordListenEvent(currentTrackRef.current, false, activeTime)
      }
    }

    // ⚡ Reset engine state CHỈ SAU KHI đã dùng xong snapshot ở trên.
    ytHtml5ModeRef.current = false

    // ⚡ 1. PAUSE & STOP ALL PREVIOUS AUDIO ENGINES IMMEDIATELY (ZERO DELAY OVERLAP)
    clearPlaybackTimers()
    if (audioRef.current) {
      try {
        audioRef.current.pause()
        // Không gọi removeAttribute('src') + load() ở đây — nếu track mới cũng dùng
        // HTML5 audio thì vài dòng sau sẽ gán audio.src = url ngay lập tức, trình duyệt
        // tự huỷ nguồn cũ khi src đổi. Gọi load() thừa ở đây tốn thời gian DOM/native
        // không cần thiết → làm chuyển bài chậm hơn cảm nhận được, nhất là trên mobile.
        audioRef.current.currentTime = 0
      } catch {}
    }
    if (ytPlayerRef.current) {
      try {
        // mute() gần như tức thời (tác động thẳng lên audio output), trong khi
        // stopVideo()/pauseVideo() phải chờ round-trip postMessage tới iframe.
        // Mute trước để không có khoảng hở nghe được, rồi mới stop/pause thật sự.
        if (ytPlayerRef.current.mute) ytPlayerRef.current.mute()
        if (ytPlayerRef.current.stopVideo) ytPlayerRef.current.stopVideo()
        if (ytPlayerRef.current.pauseVideo) ytPlayerRef.current.pauseVideo()
      } catch {}
    }

    let nextQueue = queueRef.current.length > 0 ? queueRef.current : queue
    let nextIndex = currentIndexRef.current >= 0 ? currentIndexRef.current : currentIndex

    if (newQueue) {
      nextQueue = deduplicateQueueTracks(newQueue)
      setQueue(nextQueue)
      const index = nextQueue.findIndex((t) => t.id === track.id)
      nextIndex = index >= 0 ? index : 0
    } else if (typeof forceIndex === 'number') {
      nextIndex = forceIndex
    } else if (queue.length === 0) {
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
      track.source === 'soundcloud' ||
      Boolean(track.soundcloud_id) ||
      track.drive_file_id ||
      extractDriveFileId(track.file_path || '') ||
      (track.file_path && (
        track.file_path.includes('drive-stream') ||
        track.file_path.includes('drive.google')
      ))
    )

    const shouldResolveExternalCatalog = (!hasDirectPlayableAudio || isPreviewAudio) && (
      track.source === 'itunes' ||
      track.source === 'spotify' ||
      (track as any).source === 'deezer' ||
      isPreviewAudio ||
      (!track.youtube_id && !track.nhaccuatui_id && (track.spotify_id || track.itunes_id))
    ) && !track.youtube_id && !(track.source === 'nhaccuatui' && Boolean(track.nhaccuatui_id))

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
          const cleanQ = `${track.title} ${track.artist}`.replace(/[\(\[\{].*?[\)\]\}]/g, '').trim()
          const fbRes = await fetch(`/api/search?q=${encodeURIComponent(cleanQ)}&source=all`)
          if (fbRes.ok) {
            const fbData = await fbRes.json()
            const nctMatch = fbData.nhaccuatui?.[0]
            const ytMatch = fbData.youtube?.[0] || fbData.spotify?.find((s: any) => s.youtube_id)
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
      setAudioSourceForPlayback(
        audio,
        url,
        volume,
        consumePendingSeek(initialTime > 0 ? initialTime : 0),
      )

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
        if (isIOSDevice() && (err?.name === 'NotAllowedError' || String(err?.message || '').includes('not allowed'))) {
          // iOS background: play() needs a fresh user gesture. Keep the stream loaded and
          // resume on the next media-session action (lock-screen play button) or when visible.
          pendingResumeRef.current = true
          return
        }
        if (audioRef.current) {
          try {
            const mediaErr = audioRef.current.error
            if (!mediaErr || mediaErr.code !== 2) { // 2 = MEDIA_ERR_NETWORK (transient)
              await invalidateCurrentResolution()
              trackResolutionCacheRef.current.delete(activeTrack.id)
            }
            audioRef.current.pause()
            audioRef.current.removeAttribute('src')
          } catch {}
        }
        console.warn('HTML5 audio stream playback info:', err)
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
          setTimeout(() => tryLoadYt(retries - 1), 100)
        } else {
          if (requestId === playRequestRef.current) {
            setIsPlaying(false)
            setIsBuffering(false)
            setPlaybackError(`Không thể kết nối đến trình phát YouTube cho bài hát "${activeTrack.title}".`)
          }
        }
      }
      tryLoadYt()
    } else {
      if (requestId === playRequestRef.current) {
        setIsPlaying(false)
        setIsBuffering(false)
        setPlaybackError(`Không thể tìm thấy nguồn phát trực tiếp cho bài hát "${activeTrack.title}". Vui lòng chọn bài khác.`)
      }
    }
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
    } else if (audio && audio.src && audio.src !== window.location.href && !audio.error) {
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

  const setVolume = useCallback((val: number) => {
    setVolumeState(val)
    if (audioRef.current) {
      audioRef.current.volume = val
    }
    if (ytPlayerRef.current?.setVolume) {
      try {
        ytPlayerRef.current.setVolume(val * 100)
      } catch {}
    }
  }, [])

  // ⚡ Fast-path: play a track synchronously from the URL cache so lock-screen / background
  // next/prev actions keep their iOS user-gesture chain (no awaits before play()).
  const tryQuickPlayFromCache = (track: Track, idx?: number): boolean => {
    if (!track || typeof window === 'undefined') return false

    // ⚠️ Catalog & preview tracks MUST NOT bypass full-length stream resolution via tryQuickPlayFromCache.
    // They MUST go through playTrack() to resolve full-length streams via /api/resolve-stream!
    const isCatalogOrPreview = Boolean(
      (track.audio_url && isPreviewUrl(track.audio_url)) ||
      (track.file_path && isPreviewUrl(track.file_path)) ||
      track.source === 'spotify' ||
      track.source === 'itunes' ||
      (track as any).source === 'deezer'
    )
    const hasFullLengthSource = Boolean(
      track.youtube_id ||
      track.nhaccuatui_id ||
      track.drive_file_id ||
      extractDriveFileId(track.file_path || '') ||
      (track.source === 'local' && track.file_path && !isPreviewUrl(track.file_path))
    )

    if (isCatalogOrPreview && !hasFullLengthSource) {
      return false
    }

    const cached = audioUrlCacheRef.current.get(track.id)?.url
    if (!cached || isPreviewUrl(cached) || !audioRef.current) return false
    const audio = audioRef.current

    // Capture requestId — cancels any pending async play requests AND lets
    // this call's own play().then/catch verify it's still the active request.
    const requestId = ++playRequestRef.current
    audioRequestRef.current = requestId
    audioOwnershipRef.current = {
      generation: ++audioGenerationRef.current,
      requestId,
      trackId: track.id,
    }
    resolutionIdentityRef.current = null
    clearPlaybackTimers()

    if (ytStuckTimerRef.current) {
      clearTimeout(ytStuckTimerRef.current)
      ytStuckTimerRef.current = null
    }
    if (ytPlayerRef.current) {
      try {
        if (ytPlayerRef.current.mute) ytPlayerRef.current.mute()
        if (ytPlayerRef.current.stopVideo) ytPlayerRef.current.stopVideo()
        if (ytPlayerRef.current.pauseVideo) ytPlayerRef.current.pauseVideo()
      } catch {}
    }

    const q = queueRef.current.length > 0 ? queueRef.current : queue
    let targetIdx = typeof idx === 'number' && idx >= 0 ? idx : q.findIndex((t) => t.id === track.id)
    if (targetIdx < 0) targetIdx = -1

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

    audio.src = cached
    audio.volume = volumeRef.current || volume

    // Apply SponsorBlock MV intro offset for YouTube tracks if available
    const isYouTubeTrack = track.source === 'youtube' || Boolean(track.youtube_id)
    const introOffset = isYouTubeTrack ? mvIntroOffset : 0
    audio.currentTime = introOffset

    audio.play()
      .then(() => {
        if (!isCurrentAudioOwnership()) {
          audio.pause()
          return
        }
        if (requestId !== playRequestRef.current) {
          // A newer play request has taken over — don't touch playback state
          // and don't leave this element playing under it.
          audio.pause()
          return
        }
        setIsBuffering(false)
        setIsPlaying(true)
        audioRetryCountRef.current = 0
        recordHistory(track)
      })
      .catch((err: any) => {
        if (!isCurrentAudioOwnership()) return
        if (requestId !== playRequestRef.current) return
        setIsBuffering(false)
        setIsPlaying(false)
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
    isBackwardActionRef.current = false

    // 🚀 STEP 1: Check forward history stack first (if user clicked Previous earlier)
    if (forwardHistoryStackRef.current.length > 0) {
      const forwardSong = forwardHistoryStackRef.current.pop()
      if (forwardSong) {
        const q = queueRef.current.length > 0 ? queueRef.current : queue
        const forwardIndex = q.findIndex((t) => t.id === forwardSong.id)
        playResolvedTrack(forwardSong, forwardIndex)
        // FIX: trước đây thiếu kiểm tra auto-fill ở nhánh này, khiến queue
        // có thể cạn kiệt khi user đi qua forward stack tới gần cuối danh sách
        if (forwardIndex >= 0 && forwardIndex >= q.length - 2) {
          triggerSmartQueueFill(forwardSong, q)
        }
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
  }

  const prevTrack = () => {
    isPrevNextActionRef.current = true
    isBackwardActionRef.current = true

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
        const q = queueRef.current.length > 0 ? queueRef.current : queue
        const prevIndex = q.findIndex((t) => t.id === prevSong.id)
        playResolvedTrack(prevSong, prevIndex)
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

    // Push current track to forward history so Next can restore it
    if (currentTrackRef.current) {
      forwardHistoryStackRef.current.push(currentTrackRef.current)
    }

    playResolvedTrack(q[prevIdx], prevIdx)
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
    const activeIndex = currentIndexRef.current
    const isRemovingCurrent = indexToRemove === activeIndex
    setQueue((prev) => prev.filter((_, idx) => idx !== indexToRemove))

    if (activeIndex > indexToRemove) {
      setCurrentIndex((prev) => prev - 1)
      currentIndexRef.current = currentIndexRef.current - 1
    } else if (isRemovingCurrent) {
      // Xoá đúng bài đang phát: currentIndex bây giờ trỏ tự nhiên vào bài kế tiếp
      // trong mảng đã dịch trái — không cần chỉnh index, nhưng phải tự chuyển bài
      // (audio hiện tại vẫn đang phát bài vừa bị xoá khỏi queue).
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
  }

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

  // HTML5 Audio Event Listeners
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      if (!isCurrentAudioOwnership()) return
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

    const fallbackToYouTube = async (track: Track, requestId: number) => {
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

            // Invalidate the broken stream resolution so subsequent plays don't re-fetch the dead stream
            await invalidateCurrentResolution()
            trackResolutionCacheRef.current.delete(track.id)
            audioUrlCacheRef.current.delete(track.id)

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
              const streamUrl = `/api/youtube/stream?id=${encodeURIComponent(bestMatch.youtube_id)}`
              if (audioRef.current) {
                setAudioSourceForPlayback(audioRef.current, streamUrl, volumeRef.current, 0)
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
              if (ytPlayerRef.current?.loadVideoById) {
                ytLoadedIdRef.current = bestMatch.youtube_id
                ytPlayerRef.current.setVolume(volume * 100)
                ytPlayerRef.current.loadVideoById(bestMatch.youtube_id)
                if (ytPlayerRef.current.playVideo) {
                  try { ytPlayerRef.current.playVideo() } catch {}
                }
                setIsPlaying(true)
                setIsBuffering(false)
                return
              }
            }
          }
        }
      } catch (e) {
        console.warn('YouTube fallback failed:', e)
      }
      if (!isCurrentAudioOwnership()) return
      if (requestId !== playRequestRef.current) return
      setIsPlaying(false)
      setIsBuffering(false)
      setPlaybackError('Không thể phát bài hát này. Vui lòng chọn bài khác.')
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
      if (!isCurrentAudioOwnership()) return
      const requestId = playRequestRef.current
      if (!isYtIframeEngine()) {
        const current = currentTrackRef.current
        if (!current) return

        // Invalidate broken stream resolution from caches immediately
        await invalidateCurrentResolution()
        trackResolutionCacheRef.current.delete(current.id)
        audioUrlCacheRef.current.delete(current.id)

        // Self-healing for NhacCuaTui: If external worker returned 503 / 502 / failed, fallback to native Next.js stream proxy ONCE
        const isNct = Boolean(
          current?.source === 'nhaccuatui' ||
          current?.nhaccuatui_id
        )
        if (isNct && current && current.nhaccuatui_id && !(current as any)._nctRetried) {
          ;(current as any)._nctRetried = true
          const fallbackUrl = `/api/nhaccuatui/stream?id=${encodeURIComponent(current.nhaccuatui_id)}`
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
            console.log('[NCT Auto-Retry] Worker stream failed, switching to native Next.js stream proxy:', fallbackUrl)
            audioRef.current.src = fallbackUrl
            audioRef.current.load()
            audioRef.current.play().then(() => {
              if (!isCurrentAudioOwnership()) return
              setIsPlaying(true)
              setIsBuffering(false)
              setPlaybackError(null)
            }).catch((err) => {
              if (!isCurrentAudioOwnership()) return
              console.warn('[NCT Auto-Retry] Native stream playback failed:', err)
              void fallbackToYouTube(current, requestId)
            })
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
        if (isSoundCloud && current && !(current as any)._scRetried) {
          console.log('[SoundCloud Auto-Retry] Audio playback error, requesting fresh stream URL with bypass cache...')
          ;(current as any)._scRetried = true
          try {
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
              audioRef.current.src = freshUrl
              audioRef.current.load()
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
        if (!(current as any)._ytFallbackAttempted) {
          ;(current as any)._ytFallbackAttempted = true
          await fallbackToYouTube(current, requestId)
          return
        }

        if (!isCurrentAudioOwnership()) return
        if (requestId !== playRequestRef.current) return
        consecutiveSkipRef.current += 1
        setIsPlaying(false)
        setIsBuffering(false)
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
        if (!isCurrentAudioOwnership()) return
        if (!audio.ended) return
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

    const handleWaiting = () => {
      if (!isCurrentAudioOwnership()) return
      setIsBuffering(true)
    }
    const handleStalled = () => {
      if (!isCurrentAudioOwnership()) return
      setIsBuffering(true)
    }
    const handleLoadStart = () => {
      if (!isCurrentAudioOwnership()) return
      setIsBuffering(true)
    }
    const handleCanPlay = () => {
      if (!isCurrentAudioOwnership()) return
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
      if (!isCurrentAudioOwnership()) return
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

      try {
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime !== undefined) seek(details.seekTime)
        })
      } catch (e) {}

      // Explicitly unset seekbackward and seekforward so Safari (iOS & macOS) and OS lock screens /
      // Control Center always display the Next Track (⏭️) and Previous Track (⏮️) buttons instead of
      // replacing them with 10s/15s skip buttons.
      try {
        navigator.mediaSession.setActionHandler('seekbackward', null)
      } catch (e) {}

      try {
        navigator.mediaSession.setActionHandler('seekforward', null)
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
      isNowPlayingOpen,
      toggleNowPlayingOverlay,
      openNowPlayingOverlay,
      closeNowPlayingOverlay,
      frequencyData,
      audioRef,
      mvIntroOffset,
    }),
    [
      currentTrack,
      isPlaying,
      isBuffering,
      queue,
      currentIndex,
      currentTime,
      effectiveDuration,
      volume,
      isShuffle,
      repeatMode,
      playbackError,
      isQueueOpen,
      isNowPlayingOpen,
      frequencyData,
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
      toggleNowPlayingOverlay,
      openNowPlayingOverlay,
      closeNowPlayingOverlay,
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
