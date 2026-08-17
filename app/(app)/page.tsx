'use client'

import React, { useEffect, useState, useMemo, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Track, Playlist } from '@/types'
import { TrackList } from '@/components/track/TrackList'
import { TrackListSkeleton } from '@/components/common/SkeletonLoader'
import { usePlayer } from '@/components/player/PlayerContext'
import { deduplicateQueueTracks } from '@/lib/utils'
import { flattenUnifiedSearchResults } from '@/lib/searchFlow'
import { resolveExternalTrackId, isExternalTrack, addTrackToPlaylist } from '@/lib/trackPersistence'
import { getValidUserId, getAllValidUserIds } from '@/lib/accessControl'
import { toast } from '@/components/ui/ToastContext'
import { fetchListeningHistory, getRecentUniqueTracks } from '@/lib/listeningHistory'
import { MediaCard } from '@/components/common/MediaCard'
import { useGridGlideIndicator } from '@/components/common/useGlideIndicator'
import {
  Play,
  Upload,
  Search,
  Sparkles,
  Disc,
  Music,
  Flame,
  AlertTriangle,
  Globe,
  Radio,
  Loader2,
  TrendingUp,
  History,
  RotateCcw,
  Cloud,
  Shuffle,
  DiscAlbum,
  ChevronRight,
  ListMusic,
} from 'lucide-react'
import { SpotifyAlbumItem } from '@/lib/spotify'
import { useSession } from 'next-auth/react'
import { isAdmin as checkIsAdmin } from '@/lib/accessControl'
import { useSearchParams, usePathname } from 'next/navigation'
import { extractDriveFileId, parseFilenameToTitleArtist } from '@/lib/googleDriveUpload'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { useSearch } from '@/components/search/SearchContext'
import { LONG_COMPILATION_KEYWORDS } from '@/lib/youtube'

export default function HomePage() {
  const supabase = createClient()
  const { playTrack, currentTrack, isPlaying, isShuffle, toggleShuffle } = usePlayer()
  const { playlists } = usePlaylists()
  const albumGrid = useGridGlideIndicator()
  const playlistGrid = useGridGlideIndicator()
  const trendingGrid = useGridGlideIndicator()
  const {
    searchQuery,
    setSearchQuery,
    globalTracks,
    searchingGlobal,
    trendingTracks,
    loadingTrending,
  } = useSearch()
  const { data: nextAuthSession } = useSession()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const [tracks, setTracks] = useState<Track[]>([])
  const [recentTracks, setRecentTracks] = useState<Track[]>([])
  const [libraryTab, setLibraryTab] = useState<'all' | 'drive' | 'recent'>('recent')
  const [showAllResults, setShowAllResults] = useState(false)

  const searchQueryRef = useRef(searchQuery)
  useEffect(() => {
    searchQueryRef.current = searchQuery
  }, [searchQuery])

  useEffect(() => {
    setShowAllResults((prev) => (prev ? false : prev))
  }, [searchQuery])

  // Trending Albums state
  const [trendingAlbums, setTrendingAlbums] = useState<SpotifyAlbumItem[]>([])
  const [loadingAlbums, setLoadingAlbums] = useState(true)
  const albumDetailCacheRef = useRef(new Map<string, { detail: { tracks: Track[] } | null; at: number }>())

  const handlePlayAlbum = async (e: React.MouseEvent | React.KeyboardEvent, album: SpotifyAlbumItem) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      const cached = albumDetailCacheRef.current.get(album.id)
      const detail =
        cached && Date.now() - cached.at < 10 * 60 * 1000
          ? cached.detail
          : await fetch(`/api/albums/${album.id}`).then((r) => (r.ok ? r.json() : null))
      if (detail && Array.isArray(detail.tracks) && detail.tracks.length > 0) {
        albumDetailCacheRef.current.set(album.id, { detail, at: Date.now() })
        playTrack(detail.tracks[0], detail.tracks)
      } else {
        window.location.href = `/album/${album.id}`
      }
    } catch {
      window.location.href = `/album/${album.id}`
    }
  }

  useEffect(() => {
    fetch('/api/albums/new-releases')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (Array.isArray(data)) setTrendingAlbums(data.slice(0, 12))
      })
      .catch((err) => console.warn('Failed to fetch home trending albums:', err))
      .finally(() => setLoadingAlbums(false))
  }, [])

  useEffect(() => {
    const handleSearchEvent = (e: any) => {
      const q = e.detail || ''
      setSearchQuery(q)
    }

    const checkHashTab = () => {
      if (window.location.hash === '#drive') {
        setLibraryTab('drive')
      } else {
        setLibraryTab('recent')
      }
    }

    const handleTabHome = () => {
      setLibraryTab('recent')
      setSearchQuery('')
      setShowAllResults(false)
      if (window.location.hash === '#drive') {
        history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    }

    const handleTabDrive = () => {
      setLibraryTab('drive')
    }

    window.addEventListener('musicweb-search', handleSearchEvent)
    window.addEventListener('hashchange', checkHashTab)
    window.addEventListener('popstate', checkHashTab)
    window.addEventListener('musicweb-tab-home', handleTabHome)
    window.addEventListener('musicweb-tab-drive', handleTabDrive)

    checkHashTab()

    return () => {
      window.removeEventListener('hashchange', checkHashTab)
      window.removeEventListener('popstate', checkHashTab)
      window.removeEventListener('musicweb-tab-home', handleTabHome)
      window.removeEventListener('musicweb-tab-drive', handleTabDrive)
      window.removeEventListener('musicweb-search', handleSearchEvent)
    }
  }, [setSearchQuery, pathname])

  const [loading, setLoading] = useState(true)
  const [supabaseUser, setSupabaseUser] = useState<any>(null)
  const [cleaningDuplicates, setCleaningDuplicates] = useState(false)
  const [cleanStatusText, setCleanStatusText] = useState<string | null>(null)

  const user =
    supabaseUser ||
    (nextAuthSession?.user
      ? {
          id: nextAuthSession.user.email,
          email: nextAuthSession.user.email,
          user_metadata: { full_name: nextAuthSession.user.name },
        }
      : null)

  const [userFavTrackIds, setUserFavTrackIds] = useState<Set<string>>(new Set())

  const fetchSeqRef = useRef(0)

  const fetchData = async (showSkeleton = false) => {
    if (showSkeleton) setLoading(true)
    const mySeq = ++fetchSeqRef.current
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

      let userFavSet = new Set<string>()
      try {
        const favRes = await fetch('/api/favorites/status')
        if (favRes.ok) {
          const favData = await favRes.json()
          if (Array.isArray(favData.trackIds)) {
            userFavSet = new Set(favData.trackIds)
          }
        }
      } catch {}
      if (mySeq !== fetchSeqRef.current) return
      setUserFavTrackIds(userFavSet)

      // Query all tracks from database
      const { data: rawTracks, error: trackError } = await supabase
        .from('tracks')
        .select('*')
        .order('created_at', { ascending: false })

      if (!trackError && rawTracks) {
        // Drive tracks are shared publicly for everyone to view;
        // Non-drive personal uploads are filtered by user_id.
        const visibleTracks = rawTracks.filter((t: Track) => {
          const fp = t.file_path || ''
          const isDrive = Boolean(
            extractDriveFileId(fp) ||
            fp.includes('drive-stream') ||
            fp.includes('drive.google.com') ||
            fp.includes('lh3.googleusercontent.com')
          )
          if (isDrive) return true
          if (userId && t.user_id === userId) return true
          if (!t.user_id || (t as any).is_public) return true
          return false
        })

        const uniqueVisibleTracks: Track[] = []
        const seenTrackKeys = new Set<string>()

        for (const tr of visibleTracks) {
          const driveId = extractDriveFileId(tr.file_path || '')
          const normTitle = (tr.title || '').trim().toLowerCase().normalize('NFKC')
          const normArtist = (tr.artist || '').trim().toLowerCase().normalize('NFKC')
          const key = driveId ? `drive_${driveId}` : `title_${normTitle}|||${normArtist}`

          if (!seenTrackKeys.has(key)) {
            seenTrackKeys.add(key)
            uniqueVisibleTracks.push(tr)
          }
        }

        if (mySeq !== fetchSeqRef.current) return
        setTracks(
          uniqueVisibleTracks.map((t: Track) => ({
            ...t,
            source: t.source || 'local',
            is_favorite: userFavSet.has(t.id),
          }))
        )
      }

      try {
        const historyRes = await fetch('/api/history/list?limit=100')
        if (historyRes.ok) {
          const { items: historyItems } = await historyRes.json()
          const recent = getRecentUniqueTracks(historyItems ?? []).map((tr) => ({
            ...tr,
            source: tr.source || 'local',
          }))
          if (mySeq !== fetchSeqRef.current) return
          setRecentTracks(recent)
        } else {
          if (mySeq !== fetchSeqRef.current) return
          setRecentTracks([])
        }
      } catch (hErr) {
        console.error('Failed to fetch recent listening history:', hErr)
        if (mySeq !== fetchSeqRef.current) return
        setRecentTracks([])
      }
    } catch (err) {
      console.error('fetchData error in page.tsx:', err)
    } finally {
      if (mySeq === fetchSeqRef.current) setLoading(false)
    }
  }

  const combinedTrendingTracks: Track[] = useMemo(() => {
    const nct = trendingTracks.nhaccuatui || []
    const yt = trendingTracks.youtube || []
    const audius = trendingTracks.audius || []
    const itunes = trendingTracks.itunes || []
    const spotify = trendingTracks.spotify || []
    const rawList: Track[] = []
    const maxLen = Math.max(nct.length, yt.length, audius.length, itunes.length, spotify.length)
    for (let i = 0; i < maxLen; i++) {
      if (nct[i]) rawList.push(nct[i])
      if (spotify[i]) rawList.push(spotify[i])
      if (itunes[i]) rawList.push(itunes[i])
      if (audius[i]) rawList.push(audius[i])
      if (yt[i]) rawList.push(yt[i])
    }

    const seenKeys = new Set<string>()
    const result: Track[] = []

    for (const track of rawList) {
      const cleanTitle = (track.title || '')
        .normalize('NFC')
        .replace(/[\(\[\{].*?[\)\]\}]/g, '')
        .replace(/feat\.?|ft\.?/gi, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')

      const cleanArtist = (track.artist || '')
        .normalize('NFC')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ')

      const key = `${cleanTitle}_${cleanArtist}`

      // Filter out long compilation mixes, charts, or top 50 videos
      const isCompilation = LONG_COMPILATION_KEYWORDS.some((kw) =>
        cleanTitle.includes(kw) || cleanArtist.includes(kw)
      )

      if (!isCompilation && !seenKeys.has(key)) {
        seenKeys.add(key)
        result.push(track)
      }
    }

    return result
  }, [trendingTracks])

  const displayTrending: Track[] = useMemo(() => {
    if (combinedTrendingTracks.length === 0) return []
    if (combinedTrendingTracks.length >= 18) return combinedTrendingTracks.slice(0, 18)
    if (combinedTrendingTracks.length >= 12) return combinedTrendingTracks.slice(0, 12)
    const count = Math.floor(combinedTrendingTracks.length / 6) * 6
    return combinedTrendingTracks.slice(0, Math.max(count, 6))
  }, [combinedTrendingTracks])

  // Fetch initial page data
  useEffect(() => {
    fetchData()

    let timer: NodeJS.Timeout
    const debouncedFetch = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        fetchData()
      }, 800)
    }

    const channel = supabase
      .channel('home-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tracks' }, () => {
        if (!searchQueryRef.current.trim()) debouncedFetch()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'playlists' }, () => {
        if (!searchQueryRef.current.trim()) debouncedFetch()
      })
      .subscribe()

    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [])

  const userFavTrackIdsRef = React.useRef(userFavTrackIds)
  useEffect(() => {
    userFavTrackIdsRef.current = userFavTrackIds
  }, [userFavTrackIds])

  const handleAddToPlaylist = async (playlistId: string, track: Track) => {
    const result = await addTrackToPlaylist(playlistId, track)
    toast(result.message, result.success ? 'success' : 'error', track.title)
  }

  const handleDeleteTrack = async (trackId: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa bài hát này khỏi thư viện?')) return

    try {
      const res = await fetch('/api/tracks/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds: [trackId] }),
      })
      const result = await res.json()
      if (!res.ok) {
        alert('Lỗi xóa record DB: ' + (result.error || 'Không xác định'))
        return
      }
      setTracks(tracks.filter((t) => t.id !== trackId))
      setRecentTracks(recentTracks.filter((t) => t.id !== trackId))
    } catch (err) {
      alert('Lỗi xóa track: ' + (err as Error).message)
    }
  }

  const handleCleanDuplicates = async () => {
    if (!user) return
    if (
      !confirm(
        'Tìm và xóa tất cả bài hát bị trùng (cùng tên + nghệ sĩ), chỉ giữ lại bản mới nhất?\n\nThao tác này không thể hoàn tác!'
      )
    )
      return

    setCleaningDuplicates(true)
    try {
      const seen = new Map<string, Track>()
      const toDelete: Track[] = []

      for (const track of tracks) {
        const normTitle = (track.title || '')
          .normalize('NFKC')
          .toLowerCase()
          .replace(/\.[^/.]+$/, '')
          .replace(/^\d+[\s._-]+/, '')
          .replace(/\[(mv|official|audio|hq|hd|lyrics|flac|320kbps|320)\]/gi, '')
          .replace(
            /\((official audio|lyric video|audio|official music video|official video|video|mv|320kbps|mp3|flac|hq|hd)\)/gi,
            ''
          )
          .replace(/\s+/g, ' ')
          .trim()

        const normArtist = (track.artist || '').normalize('NFKC').toLowerCase().trim()
        const key = `${normTitle}|||${normArtist}`

        if (seen.has(key)) {
          toDelete.push(track)
        } else {
          seen.set(key, track)
        }
      }

      if (toDelete.length === 0) {
        alert('Không tìm thấy bài hát trùng nào!')
        return
      }

      const toDeleteIds = toDelete.map((t) => t.id)
      const res = await fetch('/api/tracks/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackIds: toDeleteIds }),
      })
      const result = await res.json()
      if (!res.ok) {
        alert('Lỗi xóa: ' + (result.error || 'Không xác định'))
        return
      }

      alert(`✅ Đã xóa ${result.deletedIds?.length ?? 0} bài trùng khỏi thư viện!`)
      await fetchData()
    } finally {
      setCleaningDuplicates(false)
    }
  }

  const handleCleanMissingDriveFiles = async () => {
    if (!user) return
    if (!confirm('Tự động quét, lấy lại tên bài hát chuẩn từ Google Drive & dọn dẹp các bài lỗi khỏi CSDL?')) return

    setCleaningDuplicates(true)
    setCleanStatusText('Đang quét...')

    try {
      let repairedCount = 0
      let deletedCount = 0
      let processedCount = 0
      const total = tracks.length

      const processTrack = async (track: Track) => {
        const fp = track.file_path || ''
        const isFolder = fp.includes('/folders/') || fp.includes('drive/folders')
        const driveFileId = extractDriveFileId(fp)

        let isInvalid = isFolder
        if (!isInvalid && driveFileId) {
          try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 3000)
            const checkUrl = `/api/drive-stream?id=${driveFileId}`
            const res = await fetch(checkUrl, { method: 'HEAD', signal: controller.signal })
            clearTimeout(timeoutId)
            if (res.status === 404 || res.status === 500) {
              isInvalid = true
            }
          } catch {
            // ignore network timeout
          }
        }

        if (isInvalid) {
          await fetch('/api/tracks/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackIds: [track.id] }),
          }).catch(() => {})
          deletedCount++
          processedCount++
          setCleanStatusText(`Đang dọn (${processedCount}/${total})...`)
          return
        }

        const needsTitleFix =
          !track.title ||
          /^Bài hát \d+$/i.test(track.title.trim()) ||
          track.artist === 'Chưa rõ nghệ sĩ' ||
          track.album === 'Google Drive' ||
          track.album === 'Google Drive Sync'

        if (needsTitleFix && driveFileId) {
          try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 3000)
            const viewRes = await fetch(`https://drive.google.com/file/d/${driveFileId}/view`, {
              signal: controller.signal,
            })
            clearTimeout(timeoutId)

            if (viewRes.ok) {
              const html = await viewRes.text()
              const ogTitleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i)
              if (ogTitleMatch && ogTitleMatch[1]) {
                let filename = ogTitleMatch[1].trim()
                filename = filename.replace(/\.(mp3|m4a|wav|flac|aac|ogg|opus|webm)$/i, '').trim()

                let newTitle = filename
                let newArtist = ''
                if (filename.includes(' - ')) {
                  const parts = filename.split(' - ')
                  newArtist = parts[0].trim()
                  newTitle = parts.slice(1).join(' - ').trim()
                }

                if (newTitle) {
                  const updates: Record<string, any> = { title: newTitle }
                  if (newArtist && newArtist !== 'Chưa rõ nghệ sĩ' && (track.artist === 'Chưa rõ nghệ sĩ' || !track.artist)) {
                    updates.artist = newArtist
                  }
                  if (track.album === 'Google Drive' || track.album === 'Google Drive Sync') {
                    updates.album = null
                  }

                  if (Object.keys(updates).length > 0) {
                    await fetch(`/api/tracks/${track.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(updates),
                    }).catch(() => {})
                    repairedCount++
                  }
                }
              }
            }
          } catch {
            // ignore
          }
        }

        const leadingNumRegex = /^\s*\d{1,3}[\.\_\-\:\)\s\|]+\s*/
        if (track.title && leadingNumRegex.test(track.title)) {
          const cleanTitle = track.title.replace(leadingNumRegex, '').trim()
          if (cleanTitle && cleanTitle !== track.title) {
            await fetch(`/api/tracks/${track.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: cleanTitle }),
            }).catch(() => {})
            repairedCount++
          }
        }

        processedCount++
        setCleanStatusText(`Đang dọn (${processedCount}/${total})...`)
      }

      // Concurrency worker pool (8 items in parallel)
      const concurrency = 8
      let index = 0
      const activePromises: Promise<void>[] = []

      const getNext = async (): Promise<void> => {
        if (index >= tracks.length) return
        const currentTrack = tracks[index++]
        await processTrack(currentTrack)
        return getNext()
      }

      const workers = Math.min(concurrency, tracks.length)
      for (let i = 0; i < workers; i++) {
        activePromises.push(getNext())
      }

      await Promise.all(activePromises)

      alert(
        `✅ Hoàn tất xử lý thư viện!\n- Đã sửa lại tên/nghệ sĩ chuẩn cho: ${repairedCount} bài hát cũ\n- Đã dọn dẹp: ${deletedCount} bài bị hỏng/lỗi link`
      )
      await fetchData()
    } finally {
      setCleaningDuplicates(false)
      setCleanStatusText(null)
    }
  }

  const handleTrackUpdated = (trackId: string, updates: Partial<Track>) => {
    setTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t)))
    setRecentTracks((prev) => prev.map((t) => (t.id === trackId ? { ...t, ...updates } : t)))
  }

  const handleBulkUpdated = (trackIds: string[], updates: Partial<Track>) => {
    const idSet = new Set(trackIds)
    setTracks((prev) => prev.map((t) => (idSet.has(t.id) ? { ...t, ...updates } : t)))
    setRecentTracks((prev) => prev.map((t) => (idSet.has(t.id) ? { ...t, ...updates } : t)))
  }

  const handleBulkDeleted = (trackIds: string[]) => {
    const idSet = new Set(trackIds)
    setTracks((prev) => prev.filter((t) => !idSet.has(t.id)))
    setRecentTracks((prev) => prev.filter((t) => !idSet.has(t.id)))
  }

  const isAdmin = checkIsAdmin(user?.email) || user?.app_metadata?.role === 'admin'

  const isSearching = searchQuery.trim().length > 0

  const driveTracks = useMemo(() => {
    return tracks.filter((t) => {
      const fp = t.file_path || ''
      return Boolean(
        extractDriveFileId(fp) ||
        fp.includes('drive-stream') ||
        fp.includes('drive.google.com') ||
        fp.includes('lh3.googleusercontent.com')
      )
    })
  }, [tracks])

  const searchResults: Track[] = useMemo(() => {
    return flattenUnifiedSearchResults(globalTracks)
  }, [globalTracks])

  const displayedTracks: Track[] = useMemo(() => {
    if (isSearching) {
      return searchResults
    }
    if (libraryTab === 'drive') return driveTracks
    if (libraryTab === 'recent') return recentTracks
    return tracks
  }, [isSearching, searchResults, libraryTab, driveTracks, recentTracks, tracks])

  const isShortQuery = isSearching && searchQuery.trim().length <= 2

  const finalTracksToRender: Track[] = useMemo(() => {
    if (isShortQuery && !showAllResults) {
      return displayedTracks.slice(0, 15)
    }
    return displayedTracks
  }, [isShortQuery, showAllResults, displayedTracks])

  const branch =
    loading
      ? 'skeleton'
      : isSearching && searchingGlobal && displayedTracks.length === 0
        ? 'spinner'
        : 'tracklist'

  return (
    <div className="px-2.5 py-3 sm:px-4 sm:py-3.5 md:px-6 md:py-4 lg:px-7 lg:py-5 flex flex-col gap-3 sm:gap-4 md:gap-5 max-w-7xl mx-auto w-full pb-36 lg:pb-16 select-none">
      {/* High-Impact Clean Hero Card with Editorial Vinyl Element */}
      <div className="hero-banner relative overflow-hidden rounded-2xl border border-white/[0.06] p-3.5 sm:p-4 md:p-5">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 lg:gap-5 relative z-10">
          <div className="hero-copy flex flex-col gap-1 sm:gap-1.5 max-w-xl">
            <span className="eyebrow text-[10px] sm:text-[11px] font-mono tracking-widest uppercase font-semibold text-[var(--spotify-glow,#22d3ee)]">
              Thư viện âm nhạc của bạn
            </span>
            <h1 className="text-lg sm:text-xl lg:text-2xl font-display font-bold text-white tracking-tight leading-tight">
              Xin chào{user ? `, ${user.user_metadata?.full_name || user.email?.split('@')[0]}` : ''}
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed max-w-md line-clamp-2 sm:line-clamp-none">
              Khám phá và nghe những bài hát yêu thích, được gom về từ một thư viện âm nhạc thống nhất.
            </p>
            <div className="flex items-center gap-3 mt-1.5">
              {isAdmin && (
                <Link
                  href="/upload"
                  className="btn-outline-accent font-bold px-3.5 py-1.5 rounded-xl flex items-center gap-2 text-xs"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload bài hát</span>
                </Link>
              )}
            </div>
          </div>

          {/* Editorial Decorative Vinyl Disc with Track Cover Center */}
          <div className="hero-vinyl hidden md:flex items-center justify-center shrink-0">
            <div className={`hero-vinyl-disc ${isPlaying ? 'is-spinning' : 'is-paused'}`}>
              <div className="hero-vinyl-label overflow-hidden rounded-full relative flex items-center justify-center">
                {currentTrack?.cover_url ? (
                  <>
                    <img
                      src={currentTrack.cover_url}
                      alt={currentTrack.title || 'Now Playing'}
                      className="w-full h-full object-cover rounded-full"
                    />
                    {/* Vinyl Center Spindle Hole */}
                    <div className="absolute inset-[38%] rounded-full bg-[#100C13] border border-white/20 shadow-inner" />
                  </>
                ) : (
                  <span className="font-display italic text-[11px] font-semibold text-center leading-tight text-[#2A1704]">
                    Now<br />Spinning
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Global Trending Albums Showcase Section */}
      {!isSearching && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between pb-1">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[var(--spotify-glow,#22d3ee)]/10 border border-[var(--spotify-glow,#22d3ee)]/25 flex items-center justify-center shadow-[0_0_12px_var(--theme-glow-shadow,#22d3ee)]">
                <DiscAlbum style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold font-display text-white tracking-tight">
                Trending & Hot Albums
              </h2>
            </div>
            <Link
              href="/albums"
              className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-all px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/10 hover:border-cyan-500/40 hover:bg-white/[0.08]"
            >
              <span>Xem tất cả</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {loadingAlbums ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 xs:gap-3.5 sm:gap-4 lg:gap-4.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white/[0.02] border border-white/[0.04] p-3 rounded-2xl animate-pulse flex flex-col gap-2.5">
                  <div className="aspect-square w-full bg-slate-800/80 rounded-xl" />
                  <div className="h-3 bg-slate-700/80 rounded w-3/4" />
                  <div className="h-2 bg-slate-800/80 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : trendingAlbums.length > 0 ? (
            <div
              ref={albumGrid.containerRef}
              onMouseLeave={albumGrid.handleContainerMouseLeave}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 xs:gap-3.5 sm:gap-4 lg:gap-4.5 relative"
            >
              <div
                className="grid-glide-indicator"
                style={{
                  transform: `translate3d(${albumGrid.indicator.left}px, ${albumGrid.indicator.top}px, 0) scale(${albumGrid.indicator.scaleX}, ${albumGrid.indicator.scaleY})`,
                  width: `${albumGrid.indicator.width}px`,
                  height: `${albumGrid.indicator.height}px`,
                  opacity: albumGrid.indicator.opacity,
                }}
              />
              {trendingAlbums.map((album, idx) => (
                <div
                  key={album.id}
                  onMouseEnter={albumGrid.handleItemMouseEnter}
                  className="relative z-[1] h-full"
                >
                  <MediaCard
                    id={album.id}
                    title={album.name}
                    subtitle={album.artist}
                    coverUrl={album.cover_url}
                    type={album.album_type === 'single' ? 'single' : 'album'}
                    badgeLabel={album.album_type === 'single' ? 'Single' : 'Album'}
                    href={`/album/${album.id}`}
                    onPlay={(e) => void handlePlayAlbum(e, album)}
                    index={idx}
                    fallbackIcon="album"
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* User Playlists Showcase Section */}
      {!isSearching && playlists && playlists.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between pb-1">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[var(--spotify-glow,#22d3ee)]/10 border border-[var(--spotify-glow,#22d3ee)]/25 flex items-center justify-center shadow-[0_0_12px_var(--theme-glow-shadow,#22d3ee)]">
                <ListMusic style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-4 h-4" />
              </div>
              <h2 className="text-base font-bold font-display text-white tracking-tight">
                Playlist Của Bạn
              </h2>
            </div>
            <span className="text-xs font-mono text-slate-500">
              {playlists.length} playlists
            </span>
          </div>

          <div
            ref={playlistGrid.containerRef}
            onMouseLeave={playlistGrid.handleContainerMouseLeave}
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 xs:gap-3.5 sm:gap-4 lg:gap-4.5 relative"
          >
            <div
              className="grid-glide-indicator"
              style={{
                transform: `translate3d(${playlistGrid.indicator.left}px, ${playlistGrid.indicator.top}px, 0) scale(${playlistGrid.indicator.scaleX}, ${playlistGrid.indicator.scaleY})`,
                width: `${playlistGrid.indicator.width}px`,
                height: `${playlistGrid.indicator.height}px`,
                opacity: playlistGrid.indicator.opacity,
              }}
            />
            {playlists.slice(0, 6).map((pl, idx) => (
              <div
                key={pl.id}
                onMouseEnter={playlistGrid.handleItemMouseEnter}
                className="relative z-[1] h-full"
              >
                <MediaCard
                  id={pl.id}
                  title={pl.name}
                  subtitle="Playlist cá nhân"
                  coverUrl={pl.cover_url || undefined}
                  type="playlist"
                  badgeLabel="Playlist"
                  href={`/playlist/${pl.id}`}
                  index={idx}
                  fallbackIcon="playlist"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Global Trending Music Showcase Section */}
      {!isSearching && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between pb-1">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/25 flex items-center justify-center shadow-[0_0_12px_rgba(244,63,94,0.3)]">
                <TrendingUp className="w-4 h-4 text-rose-400" />
              </div>
              <h2 className="text-base font-bold font-display text-white tracking-tight">
                Trending & Hot Songs
              </h2>
            </div>
            {loadingTrending && <Loader2 style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-3.5 h-3.5 animate-spin" />}
          </div>

          {loadingTrending ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 xs:gap-3.5 sm:gap-4 lg:gap-4.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white/[0.02] border border-white/[0.04] p-3 rounded-2xl animate-pulse flex flex-col gap-2.5">
                  <div className="aspect-square w-full bg-slate-800/80 rounded-xl" />
                  <div className="h-3 bg-slate-700/80 rounded w-3/4" />
                  <div className="h-2 bg-slate-800/80 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : displayTrending.length > 0 ? (
            <div
              ref={trendingGrid.containerRef}
              onMouseLeave={trendingGrid.handleContainerMouseLeave}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 xs:gap-3.5 sm:gap-4 lg:gap-4.5 relative"
            >
              <div
                className="grid-glide-indicator"
                style={{
                  transform: `translate3d(${trendingGrid.indicator.left}px, ${trendingGrid.indicator.top}px, 0) scale(${trendingGrid.indicator.scaleX}, ${trendingGrid.indicator.scaleY})`,
                  width: `${trendingGrid.indicator.width}px`,
                  height: `${trendingGrid.indicator.height}px`,
                  opacity: trendingGrid.indicator.opacity,
                }}
              />
              {displayTrending.map((t, idx) => (
                <div
                  key={t.id}
                  onMouseEnter={trendingGrid.handleItemMouseEnter}
                  className="relative z-[1] h-full"
                >
                  <MediaCard
                    id={t.id}
                    title={t.title}
                    subtitle={t.artist || 'Nghệ sĩ chưa xác định'}
                    coverUrl={t.cover_url}
                    type="track"
                    badgeLabel="Hot"
                    href="#"
                    onPlay={() => playTrack(t, combinedTrendingTracks)}
                    isPlaying={currentTrack?.id === t.id && isPlaying}
                    index={idx}
                    fallbackIcon="track"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 bg-white/[0.02] border border-white/10 rounded-2xl flex flex-col items-center justify-center text-center gap-2">
              <p className="text-xs text-slate-400">Đang cập nhật danh sách bài hát Trending...</p>
              <button
                onClick={() => window.location.reload()}
                className="text-xs text-cyan-400 hover:underline font-semibold"
              >
                Tải lại trang
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Tracks Table Section */}
      <div className="flex flex-col gap-4">
        {!isSearching && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar touch-pan-x pr-2 py-0.5">
              <button
                onClick={() => setLibraryTab('recent')}
                style={{
                  background: 'linear-gradient(135deg, var(--spotify-glow, #22d3ee), var(--primary-spotify, #06b6d4))',
                  boxShadow: '0 4px 14px var(--theme-glow-shadow, rgba(6,182,212,0.35))',
                }}
                className="px-4 py-2 rounded-full text-xs font-extrabold text-black border border-white/20 transition-all flex items-center gap-1.5 shrink-0"
              >
                <History className="w-3.5 h-3.5" />
                <span>Vừa Nghe Gần Đây ({recentTracks.length})</span>
              </button>
            </div>
          </div>
        )}
        {isAdmin && !isSearching && (
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleCleanMissingDriveFiles}
              disabled={cleaningDuplicates}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 px-3.5 py-1.5 rounded-full transition-all disabled:opacity-50"
              title="Tự động kiểm tra và xóa khỏi CSDL các bài hát đã bị xóa khỏi Google Drive"
            >
              {cleaningDuplicates ? (
                <span className="animate-spin w-3.5 h-3.5 border-2 border-cyan-400 border-t-transparent rounded-full inline-block" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              {cleaningDuplicates ? (cleanStatusText || 'Đang dọn...') : 'Sửa tên & Dọn bài lỗi'}
            </button>

            {(() => {
              const seen = new Set<string>()
              const hasDupes = tracks.some((t) => {
                const key = `${t.title?.toLowerCase().trim()}|||${(t.artist || '')
                  .toLowerCase()
                  .trim()}`
                if (seen.has(key)) return true
                seen.add(key)
                return false
              })
              return hasDupes ? (
                <button
                  onClick={handleCleanDuplicates}
                  disabled={cleaningDuplicates}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 px-3.5 py-1.5 rounded-full transition-all disabled:opacity-50"
                >
                  {cleaningDuplicates ? (
                    <span className="animate-spin w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full inline-block" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                  {cleaningDuplicates ? 'Đang dọn...' : 'Dọn bài trùng'}
                </button>
              ) : null
            })()}
          </div>
        )}
        {isSearching && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold font-display text-white flex items-center gap-2">
                <Search className="w-5 h-5 text-cyan-400" />
                Kết Quả Tìm Kiếm Toàn Cầu
              </h2>
              {searchingGlobal && <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />}
            </div>
          </div>
        )}

        {loading ? (
          <TrackListSkeleton count={8} />
        ) : isSearching && searchingGlobal && displayedTracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400 bg-[#181818]/60 border border-white/5 rounded-2xl gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            <p className="text-sm font-medium text-white">Đang tìm kiếm bài hát...</p>
          </div>
        ) : (
          <>
            <TrackList
              tracks={finalTracksToRender}
              userPlaylists={playlists}
              onAddToPlaylist={handleAddToPlaylist}
              onDeleteTrack={handleDeleteTrack}
              onTrackUpdated={handleTrackUpdated}
              isAdmin={isAdmin}
              onBulkUpdated={handleBulkUpdated}
              onBulkDeleted={handleBulkDeleted}
            />

            {isShortQuery && !showAllResults && displayedTracks.length > 15 && (
              <div className="flex justify-center pt-3 pb-2">
                <button
                  onClick={() => setShowAllResults(true)}
                  className="bg-white/5 hover:bg-white/10 text-cyan-400 hover:text-cyan-300 border border-white/10 text-xs font-bold px-6 py-2.5 rounded-full transition-all flex items-center gap-2 shadow-lg hover:scale-105"
                >
                  <span>Xem thêm {displayedTracks.length - 15} kết quả cho &quot;{searchQuery.trim()}&quot;</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
