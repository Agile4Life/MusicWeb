'use client'

import React, { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Home,
  Upload,
  Plus,
  Music,
  LogOut,
  UserCheck,
  Cloud,
  Settings,
  Heart,
  History,
  Receipt,
  Trash2,
  DiscAlbum,
  Sparkles,
  FolderArchive,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Playlist } from '@/types'
import { isAdmin, getValidUserId } from '@/lib/accessControl'
import { useSession, signOut } from 'next-auth/react'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { useSearch } from '@/components/search/SearchContext'
import { ImportSpotifyModal } from '@/components/playlist/ImportSpotifyModal'
import { ImportYouTubePlaylistModal } from '@/components/playlist/ImportYouTubePlaylistModal'
import { ImportSoundCloudModal } from '@/components/playlist/ImportSoundCloudModal'
import { YoutubeIcon } from '@/components/icons/YoutubeIcon'

import { useGlideIndicator } from '@/hooks/useGlideIndicator'

export function Sidebar({ isScrolled }: { isScrolled?: boolean } = {}) {
  const { t } = useLanguage()
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const { userEmail } = useCurrentUser()
  const { playlists, loading: creating, createPlaylist, deletePlaylist } = usePlaylists()
  const { clearSearch } = useSearch()
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [isYtImportModalOpen, setIsYtImportModalOpen] = useState(false)
  const [isScImportModalOpen, setIsScImportModalOpen] = useState(false)

  const exploreNavRef = React.useRef<HTMLElement>(null)
  const playlistNavRef = React.useRef<HTMLDivElement>(null)

  const exploreGlide = useGlideIndicator(44)
  const playlistGlide = useGlideIndicator(44)

  // Action Cluster Glide Indicator State (Horizontal Liquid Stretch)
  const [actionIndicator, setActionIndicator] = useState<{
    left: number
    width: number
    opacity: number
    scaleX: number
    variant: 'emerald' | 'rose' | 'orange' | 'cyan'
  }>({
    left: 0,
    width: 0,
    opacity: 0,
    scaleX: 1,
    variant: 'emerald',
  })
  const actionTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleActionMouseEnter = (
    e: React.MouseEvent<HTMLButtonElement>,
    variant: 'emerald' | 'rose' | 'orange' | 'cyan'
  ) => {
    const el = e.currentTarget
    const newLeft = el.offsetLeft
    const newWidth = el.offsetWidth
    const prevLeft = actionIndicator.left
    const distance = Math.abs(newLeft - prevLeft)
    const isFirstEnter = actionIndicator.opacity === 0

    if (actionTimeoutRef.current) clearTimeout(actionTimeoutRef.current)

    const stretchFactor = isFirstEnter ? 1 : Math.min(1 + (distance / (newWidth || 1)) * 0.18, 1.35)

    setActionIndicator({
      left: newLeft,
      width: newWidth,
      opacity: 1,
      scaleX: stretchFactor,
      variant,
    })

    actionTimeoutRef.current = setTimeout(() => {
      setActionIndicator((prev) => ({ ...prev, scaleX: 1 }))
    }, 40)
  }

  const handleActionMouseLeave = () => {
    if (actionTimeoutRef.current) clearTimeout(actionTimeoutRef.current)
    setActionIndicator((prev) => ({ ...prev, opacity: 0, scaleX: 1 }))
  }

  const handleItemClick = (e: React.MouseEvent<HTMLElement>) => {
    const item = e.currentTarget
    const rect = item.getBoundingClientRect()
    const ripple = document.createElement('span')
    ripple.className = 'ripple'
    const size = Math.max(rect.width, rect.height)
    ripple.style.width = ripple.style.height = `${size}px`
    ripple.style.left = `${e.clientX - rect.left - size / 2}px`
    ripple.style.top = `${e.clientY - rect.top - size / 2}px`
    item.appendChild(ripple)
    ripple.addEventListener('animationend', () => ripple.remove())
  }

  useEffect(() => {
    exploreGlide.hide()
    playlistGlide.hide()
  }, [pathname, playlists])

  const user = userEmail
    ? {
      id: userEmail,
      email: userEmail,
      user_metadata: nextAuthSession?.user
        ? { full_name: nextAuthSession.user.name, avatar_url: nextAuthSession.user.image }
        : {},
    }
    : null

  const handleLogout = async () => {
    await supabase.auth.signOut()
    await signOut({ callbackUrl: '/login' })
    window.location.href = '/login'
  }

  const handleCreatePlaylist = async () => {
    if (!user) {
      router.push('/login')
      return
    }

    const created = await createPlaylist()
    if (created && created.id) {
      router.push(`/playlist/${created.id}`)
    }
  }

  const handleDeletePlaylistFromSidebar = async (e: React.MouseEvent, playlistId: string, playlistName: string) => {
    e.preventDefault()
    e.stopPropagation()

    const deleted = await deletePlaylist(playlistId, playlistName)
    if (deleted && pathname === `/playlist/${playlistId}`) {
      router.push('/')
    }
  }

  return (
    <aside className={`app-sidebar hidden lg:flex w-60 lg:w-64 xl:w-72 flex-col justify-between p-3 lg:p-3.5 xl:p-4 h-full select-none text-slate-300 rounded-2xl panel-theme-hover shrink-0 z-10 overflow-hidden ${isScrolled ? 'is-scrolled' : ''}`}>
      <div className="flex flex-col gap-2 min-h-0 flex-1 h-full max-h-full pb-14 overflow-y-auto no-scrollbar touch-pan-y">
        {/* App Branding Header (Mini Glass Plaque) */}
        <div className="px-0.5 py-0.5 shrink-0">
          <Link
            href="/"
            onClick={() => {
              clearSearch()
              window.dispatchEvent(new Event('musicweb-tab-home'))
            }}
            className="sidebar-logo-plaque w-full flex items-center justify-start px-3.5 py-2 lg:py-2.5 rounded-2xl group cursor-pointer"
            title="MusicWeb"
          >
            <div className="flex items-center justify-start h-8 lg:h-9 shrink-0">
              <img
                src="/phong-signature.png"
                alt="MusicWeb Logo"
                className="h-8 lg:h-9 w-auto object-contain signature-img-invert group-hover:scale-[1.03] transition-transform"
              />
            </div>
          </Link>
        </div>

        {/* Main Navigation List */}
        <nav
          ref={exploreNavRef}
          onMouseLeave={exploreGlide.hide}
          className="flex flex-col gap-0.5 lg:gap-1 relative shrink-0"
        >
          <div
            className="sidebar-glide nav-indicator"
            style={{
              transform: `translateY(${exploreGlide.state.top}px) scaleY(${exploreGlide.state.scaleY})`,
              height: `${exploreGlide.state.height}px`,
              opacity: exploreGlide.state.opacity,
            }}
          />

          <p className="text-[11px] font-mono tracking-wider text-slate-500 uppercase px-2.5 py-1 relative z-10">
            {t('explore')}
          </p>

          <Link
            href="/"
            onMouseEnter={(e) => {
              if (pathname === '/') return
              exploreGlide.moveTo(e.currentTarget)
            }}
            onClick={(e) => {
              handleItemClick(e)
              clearSearch()
              window.dispatchEvent(new Event('musicweb-tab-home'))
            }}
            className={`sidebar-item text-xs ${pathname === '/' ? 'sidebar-item--active active font-semibold' : ''}`}
          >
            <Home className="w-4 h-4 icon" />
            <span>{t('home')}</span>
          </Link>

          <Link
            href="/albums"
            onMouseEnter={(e) => {
              if (pathname === '/albums' || pathname.startsWith('/album/')) return
              exploreGlide.moveTo(e.currentTarget)
            }}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${
              pathname === '/albums' || pathname.startsWith('/album/') ? 'sidebar-item--active active font-semibold' : ''
            }`}
          >
            <DiscAlbum className="w-4 h-4 icon" />
            <span>{t('albums')}</span>
          </Link>

          <Link
            href="/soundcloud"
            onMouseEnter={(e) => {
              if (pathname === '/soundcloud') return
              exploreGlide.moveTo(e.currentTarget)
            }}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/soundcloud' ? 'sidebar-item--active active font-semibold' : ''}`}
          >
            <Cloud className="w-4 h-4 text-[#ff7700] icon" />
            <div className="flex items-center justify-between flex-1">
              <span>SoundCloud</span>
              <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-[#ff5500]/20 text-[#ff7700] border border-[#ff5500]/35 shadow-[0_0_8px_rgba(255,85,0,0.3)]">
                HOT
              </span>
            </div>
          </Link>

          <Link
            href="/drive"
            onMouseEnter={(e) => {
              if (pathname === '/drive') return
              exploreGlide.moveTo(e.currentTarget)
            }}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/drive' ? 'sidebar-item--active active font-semibold' : ''}`}
          >
            <FolderArchive className="w-4 h-4 text-[#22c55e] icon" />
            <div className="flex items-center justify-between flex-1">
              <span>Google Drive</span>
              <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-[#22c55e]/20 text-[#22c55e] border border-[#22c55e]/35">
                CLOUD
              </span>
            </div>
          </Link>

          <Link
            href="/favorites"
            onMouseEnter={(e) => {
              if (pathname === '/favorites') return
              exploreGlide.moveTo(e.currentTarget)
            }}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/favorites' ? 'sidebar-item--active active font-semibold' : ''}`}
          >
            <Heart className="w-4 h-4 icon" />
            <span>{t('favorites')}</span>
          </Link>

          <Link
            href="/history"
            onMouseEnter={(e) => {
              if (pathname === '/history') return
              exploreGlide.moveTo(e.currentTarget)
            }}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/history' ? 'sidebar-item--active active font-semibold' : ''}`}
          >
            <History className="w-4 h-4 icon" />
            <span>{t('history')}</span>
          </Link>

          <Link
            href="/receipt"
            onMouseEnter={(e) => {
              if (pathname === '/receipt') return
              exploreGlide.moveTo(e.currentTarget)
            }}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/receipt' ? 'sidebar-item--active active font-semibold' : ''}`}
          >
            <Receipt className="w-4 h-4 text-amber-400 icon" />
            <div className="flex items-center justify-between flex-1">
              <span>{t('receipt')}</span>
              <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30">
                NEW
              </span>
            </div>
          </Link>

          {isAdmin(user?.email) && (
            <Link
              href="/upload"
              onMouseEnter={(e) => {
                if (pathname === '/upload') return
                exploreGlide.moveTo(e.currentTarget)
              }}
              onClick={handleItemClick}
              className={`sidebar-item text-xs ${pathname === '/upload' ? 'sidebar-item--active active font-semibold' : ''}`}
            >
              <Upload className="w-4 h-4 icon" />
              <span>{t('upload')}</span>
            </Link>
          )}

          <Link
            href="/settings"
            onMouseEnter={(e) => {
              if (pathname === '/settings') return
              exploreGlide.moveTo(e.currentTarget)
            }}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/settings' ? 'sidebar-item--active active font-semibold' : ''}`}
          >
            <Settings className="w-4 h-4 icon" />
            <span>{t('settings')}</span>
          </Link>
        </nav>

        {/* Playlists Container with Dedicated Scrollable Track Area */}
        <div className="flex-1 flex flex-col min-h-[140px] pt-2 border-t border-white/[0.06]">
          {/* Action cluster: enlarged import & create buttons with horizontal glide indicator */}
          <div className="px-0.5 mb-1.5 shrink-0">
            <div
              onMouseLeave={handleActionMouseLeave}
              className={`relative flex items-center justify-between gap-1 bg-white/[0.03] p-1 rounded-full shadow-inner w-full overflow-hidden transition-all duration-300 ${
                actionIndicator.opacity > 0
                  ? `action-bar-${actionIndicator.variant}`
                  : 'border border-white/[0.08]'
              }`}
            >
              <div
                className={`action-glide-indicator variant-${actionIndicator.variant}`}
                style={{
                  transform: `translate3d(${actionIndicator.left}px, 0, 0) scaleX(${actionIndicator.scaleX})`,
                  width: `${actionIndicator.width}px`,
                  opacity: actionIndicator.opacity,
                }}
              />

              <button
                onClick={() => setIsImportModalOpen(true)}
                onMouseEnter={(e) => handleActionMouseEnter(e, 'emerald')}
                className="relative z-[1] flex-1 h-8 rounded-full text-emerald-400 hover:text-emerald-300 flex items-center justify-center transition-all cursor-pointer group"
                title="Nhập Playlist từ Spotify"
              >
                <Sparkles className="w-4 h-4 transition-transform group-hover:scale-110" />
              </button>
              <button
                onClick={() => setIsYtImportModalOpen(true)}
                onMouseEnter={(e) => handleActionMouseEnter(e, 'rose')}
                className="relative z-[1] flex-1 h-8 rounded-full text-red-400 hover:text-red-300 flex items-center justify-center transition-all cursor-pointer group"
                title="Nhập Playlist từ YouTube Music"
              >
                <YoutubeIcon className="w-4 h-4 transition-transform group-hover:scale-110" />
              </button>
              <button
                onClick={() => setIsScImportModalOpen(true)}
                onMouseEnter={(e) => handleActionMouseEnter(e, 'orange')}
                className="relative z-[1] flex-1 h-8 rounded-full text-[#ff7700] hover:text-[#ff5500] flex items-center justify-center transition-all cursor-pointer group"
                title="Nhập Playlist từ SoundCloud"
              >
                <Cloud className="w-4 h-4 transition-transform group-hover:scale-110" />
              </button>
              <div className="relative z-[1] w-[1px] h-3.5 bg-white/10 my-auto mx-0.5 shrink-0" />
              <button
                onClick={handleCreatePlaylist}
                disabled={creating}
                onMouseEnter={(e) => handleActionMouseEnter(e, 'cyan')}
                className="relative z-[1] flex-1 h-8 rounded-full text-[var(--spotify-glow,#22d3ee)] hover:text-white flex items-center justify-center transition-all cursor-pointer disabled:opacity-50 group"
                title="Tạo Playlist mới"
              >
                <Plus className="w-4 h-4 transition-transform group-hover:scale-110" />
              </button>
            </div>
          </div>

          <div
            ref={playlistNavRef}
            onMouseLeave={playlistGlide.hide}
            className="flex-1 overflow-y-auto flex flex-col gap-0.5 lg:gap-1 relative no-scrollbar min-h-0 touch-pan-y"
          >
            <div
              className="sidebar-glide nav-indicator"
              style={{
                transform: `translateY(${playlistGlide.state.top}px) scaleY(${playlistGlide.state.scaleY})`,
                height: `${playlistGlide.state.height}px`,
                opacity: playlistGlide.state.opacity,
              }}
            />

            {user || playlists.length > 0 ? (
              playlists.length > 0 ? (
                playlists.map((pl) => (
                  <Link
                    key={pl.id}
                    href={`/playlist/${pl.id}`}
                    onMouseEnter={(e) => {
                      if (pathname === `/playlist/${pl.id}`) return
                      playlistGlide.moveTo(e.currentTarget)
                    }}
                    onClick={handleItemClick}
                    className={`sidebar-item text-xs group ${
                      pathname === `/playlist/${pl.id}` ? 'sidebar-item--active active font-semibold' : ''
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-slate-300 shrink-0 icon group-hover:text-[var(--sidebar-accent)] group-hover:scale-105 transition-all shadow-inner">
                      <Music className="w-3.5 h-3.5" />
                    </div>
                    <span className="truncate flex-1 font-medium group-hover:text-white transition-colors">{pl.name}</span>
                    <button
                      onClick={(e) => handleDeletePlaylistFromSidebar(e, pl.id, pl.name)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 rounded-lg hover:bg-red-500/15 transition-all relative z-10 shrink-0 cursor-pointer"
                      title="Xóa playlist"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </Link>
                ))
              ) : (
                <div className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl text-center my-auto">
                  <p className="text-xs font-semibold text-slate-300 mb-1">Chưa có playlist</p>
                  <button
                    onClick={handleCreatePlaylist}
                    className="text-[11px] font-bold text-[var(--spotify-glow,#22d3ee)] hover:underline mt-1 inline-block cursor-pointer"
                  >
                    + Tạo playlist đầu tiên
                  </button>
                </div>
              )
            ) : (
              <div className="p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl text-center my-auto">
                <p className="text-[11px] text-slate-400 mb-2">Đăng nhập để tạo playlist</p>
                <Link
                  href="/login"
                  className="bg-white text-black font-bold text-[11px] px-3 py-1 rounded-full inline-block"
                >
                  Đăng nhập
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      <ImportSpotifyModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
      />
      <ImportYouTubePlaylistModal
        isOpen={isYtImportModalOpen}
        onClose={() => setIsYtImportModalOpen(false)}
      />
      <ImportSoundCloudModal
        isOpen={isScImportModalOpen}
        onClose={() => setIsScImportModalOpen(false)}
      />
    </aside>
  )
}
