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
import { toast } from '@/components/ui/ToastContext'
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
} from 'lucide-react'
import { SpotifyAlbumItem } from '@/lib/spotify'
import { useSession } from 'next-auth/react'
import { getValidUserId, isAdmin as checkIsAdmin } from '@/lib/accessControl'
import { useSearchParams, usePathname } from 'next/navigation'
import { extractDriveFileId, parseFilenameToTitleArtist } from '@/lib/googleDriveUpload'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { useSearch } from '@/components/search/SearchContext'
import { LONG_COMPILATION_KEYWORDS } from '@/lib/youtube'

export default function HomePage() {
  const supabase = createClient()
  const { playTrack, isShuffle, toggleShuffle } = usePlayer()
  const { playlists } = usePlaylists()
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
      if (pathname === '/' && window.location.hash !== '#drive') {
        return
      }
      setLibraryTab('recent')
      setSearchQuery('')
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
      if (userId) {
        const { data: userFavs } = await supabase
          .from('favorite_tracks')
          .select('track_id')
          .eq('user_id', userId)
        if (userFavs) {
          userFavSet = new Set(userFavs.map((f: any) => f.track_id))
        }
      }
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

      if (userId) {
        // Query Recently Played Songs strictly for CURRENT user_id
        const { data: historyData } = await supabase
          .from('listening_history')
          .select('id, played_at, tracks:track_id(*)')
          .eq('user_id', userId)
          .order('played_at', { ascending: false })
          .limit(100)

        if (historyData && historyData.length > 0) {
          const seen = new Set<string>()
          const recent: Track[] = []
          for (const item of historyData) {
            const tr = item.tracks as any
            if (tr && tr.id && !seen.has(tr.id)) {
              seen.add(tr.id)
              recent.push({ ...tr, source: tr.source || 'local' })
            }
          }
          if (mySeq !== fetchSeqRef.current) return
          setRecentTracks(recent)
        } else {
          if (mySeq !== fetchSeqRef.current) return
          setRecentTracks([])
        }
      } else {
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listening_history' }, () => {
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
    const activeUser = user ? { id: user.id, email: user.email } : null
    const userId = activeUser ? getValidUserId(activeUser) : ''
    const result = await addTrackToPlaylist(supabase, playlistId, track, userId)
    toast(result.message, result.success ? 'success' : 'error', track.title)
  }

  const handleDeleteTrack = async (trackId: string) => {
    if (!confirm('Bạn có chắc chắn muốn xóa bài hát này khỏi thư viện?')) return

    const trackToDelete = tracks.find((t) => t.id === trackId)
    if (!trackToDelete) return

    await supabase.from('playlist_tracks').delete().eq('track_id', trackId)
    await supabase.from('favorite_tracks').delete().eq('track_id', trackId)
    await supabase.from('listening_history').delete().eq('track_id', trackId)

    const { error: dbError } = await supabase.from('tracks').delete().eq('id', trackId)

    if (dbError) {
      alert('Lỗi xóa record DB: ' + dbError.message)
      return
    }

    if (trackToDelete.file_path && !trackToDelete.file_path.startsWith('http')) {
      await supabase.storage.from('music-files').remove([trackToDelete.file_path])
    }

    setTracks(tracks.filter((t) => t.id !== trackId))
    setRecentTracks(recentTracks.filter((t) => t.id !== trackId))
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

      let deletedCount = 0
      for (const track of toDelete) {
        const { error } = await supabase.from('tracks').delete().eq('id', track.id)
        if (!error) {
          if (track.file_path && !track.file_path.startsWith('http')) {
            await supabase.storage.from('music-files').remove([track.file_path])
          }
          deletedCount++
        }
      }

      alert(`✅ Đã xóa ${deletedCount} bài trùng khỏi thư viện!`)
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
          await supabase.from('playlist_tracks').delete().eq('track_id', track.id)
          await supabase.from('favorite_tracks').delete().eq('track_id', track.id)
          await supabase.from('listening_history').delete().eq('track_id', track.id)
          await supabase.from('tracks').delete().eq('id', track.id)
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
              headers: {
                'User-Agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
              },
              cache: 'no-store',
              signal: controller.signal,
            })
            clearTimeout(timeoutId)

            if (viewRes.ok) {
              const html = await viewRes.text()
              const ogMatch =
                html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                html.match(/<title>([^<]+?)(?:\s*-\s*Google Drive)?<\/title>/i)

              if (ogMatch && ogMatch[1]) {
                const rawName = ogMatch[1].replace(/\s*-\s*Google Drive$/i, '').trim()
                if (rawName && rawName !== 'Google Drive' && !rawName.toLowerCase().includes('google drive')) {
                  const { title: newTitle, artist: newArtist } = parseFilenameToTitleArtist(rawName)
                  const updates: Partial<Track> = {}

                  if (newTitle && (/^Bài hát \d+$/i.test(track.title.trim()) || !track.title)) {
                    updates.title = newTitle
                  }
                  if (newArtist && newArtist !== 'Chưa rõ nghệ sĩ' && (track.artist === 'Chưa rõ nghệ sĩ' || !track.artist)) {
                    updates.artist = newArtist
                  }
                  if (track.album === 'Google Drive' || track.album === 'Google Drive Sync') {
                    updates.album = null
                  }

                  if (Object.keys(updates).length > 0) {
                    await supabase.from('tracks').update(updates).eq('id', track.id)
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
            await supabase.from('tracks').update({ title: cleanTitle }).eq('id', track.id)
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
    <div className="p-3.5 sm:p-6 md:p-8 flex flex-col gap-4 sm:gap-6 md:gap-8 max-w-7xl mx-auto w-full pb-36 md:pb-8 select-none">
      {/* High-Impact Clean Hero Card */}
      <div className="hero-banner relative overflow-hidden rounded-2xl border border-white/[0.06] p-4 sm:p-6 md:p-10">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 md:gap-6">
          <div className="flex flex-col gap-1.5 sm:gap-2 max-w-xl">
            <h1 className="text-xl sm:text-2xl md:text-4xl font-extrabold text-white tracking-tight leading-tight">
              Xin chào{user ? `, ${user.user_metadata?.full_name || user.email?.split('@')[0]}` : ''}
            </h1>
            <p className="text-xs md:text-sm text-slate-400 leading-relaxed">
              Khám phá và nghe những bài hát yêu thích từ một thư viện âm nhạc thống nhất.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {isAdmin && (
              <Link
                href="/upload"
                className="btn-outline-accent font-bold px-4 py-2.5 rounded-full flex items-center gap-2 text-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Global Trending Albums Showcase Section */}
      {!isSearching && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <DiscAlbum style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-4 h-4" />
              <span>Trending & Hot Albums</span>
            </h2>
            <Link
              href="/albums"
              className="text-xs font-semibold text-slate-400 hover:text-white hover:underline flex items-center gap-1 transition-colors"
            >
              <span>Xem tất cả</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {loadingAlbums ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white/[0.02] border border-white/[0.04] p-3 rounded-2xl animate-pulse flex flex-col gap-2">
                  <div className="aspect-square bg-slate-800 rounded-xl" />
                  <div className="h-3 bg-slate-700 rounded w-3/4" />
                  <div className="h-2 bg-slate-800 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : trendingAlbums.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {trendingAlbums.map((album, idx) => (
                <Link
                  key={album.id}
                  href={`/album/${album.id}`}
                  style={{ '--i': idx } as React.CSSProperties}
                  className="media-card group p-3 flex flex-col gap-2 cursor-pointer outline-none"
                >
                  <div className="aspect-square bg-slate-800 rounded-xl overflow-hidden relative border border-white/10 flex items-center justify-center">
                    {album.cover_url ? (
                      <img
                        src={album.cover_url}
                        alt={album.name}
                        width={300}
                        height={300}
                        decoding="async"
                        className="cover-img w-full h-full object-cover"
                        style={{ aspectRatio: '1 / 1' }}
                      />
                    ) : (
                      <DiscAlbum className="cover-img w-8 h-8 text-slate-500" />
                    )}
                    <div className="cover-overlay" />
                    <div className="badge-glass absolute top-2 left-2 px-1.5 py-0.5 rounded-full text-[8px] font-mono text-[var(--accent)] uppercase tracking-wider z-10">
                      {album.album_type === 'single' ? 'Single' : 'Album'}
                    </div>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`Phát album ${album.name}`}
                      onClick={(e) => void handlePlayAlbum(e, album)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') void handlePlayAlbum(e, album)
                      }}
                      className="play-btn z-10"
                    >
                      <Play className="w-4 h-4 ml-0.5 fill-current" />
                    </div>
                  </div>
                  <div className="truncate">
                    <p className="card-title text-xs font-bold text-white truncate">
                      {album.name}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {album.artist}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Global Trending Music Showcase Section */}
      {!isSearching && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <TrendingUp style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-4 h-4" />
              <span>Trending & Hot Songs</span>
            </h2>
            {loadingTrending && <Loader2 style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-3.5 h-3.5 animate-spin" />}
          </div>

          {loadingTrending ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-white/[0.02] border border-white/[0.04] p-3 rounded-2xl animate-pulse flex flex-col gap-2">
                  <div className="aspect-square bg-slate-800 rounded-xl" />
                  <div className="h-3 bg-slate-700 rounded w-3/4" />
                  <div className="h-2 bg-slate-800 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : displayTrending.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {displayTrending.map((t, idx) => (
                <div
                  key={t.id}
                  onClick={() => playTrack(t, combinedTrendingTracks)}
                  style={{ '--i': idx } as React.CSSProperties}
                  className="media-card group p-3 flex flex-col gap-2 cursor-pointer outline-none"
                >
                  <div className="aspect-square bg-slate-800 rounded-xl overflow-hidden relative border border-white/10 flex items-center justify-center">
                    {t.cover_url ? (
                      <img
                        src={t.cover_url}
                        alt={t.title}
                        width={300}
                        height={300}
                        decoding="async"
                        className="cover-img w-full h-full object-cover"
                        style={{ aspectRatio: '1 / 1' }}
                      />
                    ) : (
                      <Music className="cover-img w-7 h-7 text-slate-500" />
                    )}
                    <div className="cover-overlay" />
                    <div className="play-btn z-10">
                      <Play className="w-4 h-4 ml-0.5 fill-current" />
                    </div>
                  </div>

                  <div className="truncate">
                    <p className="card-title text-xs font-bold text-white truncate">
                      {t.title}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                      {t.artist || 'Nghệ sĩ chưa xác định'}
                    </p>
                  </div>
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
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
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
