'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import {
  Home,
  Upload,
  Plus,
  Music,
  Cloud,
  Settings,
  Heart,
  History,
  Receipt,
  Trash2,
  DiscAlbum,
  FolderArchive,
} from 'lucide-react'
import { isAdmin } from '@/lib/accessControl'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { useSearch } from '@/components/search/SearchContext'
import { useTheme } from '@/components/theme/ThemeContext'
import { ImportSpotifyModal } from '@/components/playlist/ImportSpotifyModal'
import { ImportYouTubePlaylistModal } from '@/components/playlist/ImportYouTubePlaylistModal'
import { ImportSoundCloudModal } from '@/components/playlist/ImportSoundCloudModal'
import { YoutubeIcon } from '@/components/icons/YoutubeIcon'
import { SPRING_UI } from '@/lib/motion'

import { useGlideIndicator } from '@/hooks/useGlideIndicator'

export function Sidebar({ isScrolled }: { isScrolled?: boolean } = {}) {
  const { t } = useLanguage()
  const { themeStyle } = useTheme()
  const pathname = usePathname()
  const router = useRouter()
  const prefersReducedMotion = useReducedMotion()
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

  // Action Cluster Glide Indicator State (pure GPU translate3d)
  const [actionIndicator, setActionIndicator] = useState<{
    left: number
    width: number
    opacity: number
    variant: 'emerald' | 'rose' | 'orange' | 'cyan'
  }>({
    left: 0,
    width: 0,
    opacity: 0,
    variant: 'emerald',
  })

  const handleActionPointerEnter = (
    e: React.PointerEvent<HTMLButtonElement>,
    variant: 'emerald' | 'rose' | 'orange' | 'cyan'
  ) => {
    if (e.pointerType === 'touch') return
    const el = e.currentTarget
    setActionIndicator({
      left: el.offsetLeft,
      width: el.offsetWidth,
      opacity: 1,
      variant,
    })
  }

  const handleActionPointerLeave = () => {
    setActionIndicator((prev) => ({ ...prev, opacity: 0 }))
  }

  useEffect(() => {
    exploreGlide.hide()
    playlistGlide.hide()
  }, [pathname, playlists, exploreGlide.hide, playlistGlide.hide])

  const user = userEmail
    ? {
      id: userEmail,
      email: userEmail,
      user_metadata: nextAuthSession?.user
        ? { full_name: nextAuthSession.user.name, avatar_url: nextAuthSession.user.image }
        : {},
    }
    : null

  const activePillStyle: React.CSSProperties =
    themeStyle === 'minimal-flat'
      ? {
          background: 'rgba(232, 169, 79, 0.1)',
          border: '1px solid transparent',
          boxShadow: 'inset 2px 0 0 var(--accent-strong, #E8A94F)',
          borderRadius: '12px',
        }
      : themeStyle === 'liquid-glass'
        ? {
            background: 'color-mix(in srgb, var(--primary-spotify, #06b6d4) 16%, transparent)',
            border: '1px solid color-mix(in srgb, var(--primary-spotify, #06b6d4) 28%, transparent)',
            boxShadow:
              'var(--elev-1), 0 0 18px color-mix(in srgb, var(--accent) 24%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
            borderRadius: 'var(--radius-control, 10px)',
          }
        : {
            background: 'color-mix(in srgb, var(--primary-spotify, #06b6d4) 15%, transparent)',
            border: '1px solid color-mix(in srgb, var(--primary-spotify, #06b6d4) 25%, transparent)',
            boxShadow: 'var(--elev-1), 0 0 18px color-mix(in srgb, var(--accent) 24%, transparent)',
            borderRadius: 'var(--radius-control, 10px)',
          }

  const renderActivePill = () => (
    <motion.span
      layoutId="sidebar-active-pill"
      aria-hidden="true"
      transition={prefersReducedMotion ? { duration: 0.14 } : SPRING_UI}
      className="pointer-events-none absolute inset-0 z-0"
      style={activePillStyle}
    />
  )

  const getExploreItemClass = (isActive: boolean) =>
    `sidebar-item text-xs overflow-visible! z-auto! active:scale-[0.97] transition-[transform,color,background-color] duration-150 ease-[var(--ease-out)] ${
      isActive
        ? 'sidebar-item--active active font-semibold bg-transparent! border-transparent! shadow-none!'
        : ''
    }`

  const handleExplorePointerEnter = (e: React.PointerEvent<HTMLAnchorElement>, isActive: boolean) => {
    if (e.pointerType === 'touch') return
    if (isActive) {
      exploreGlide.hide()
      return
    }
    exploreGlide.moveTo(e.currentTarget)
  }

  const isHomeActive = pathname === '/'
  const isAlbumsActive = pathname === '/albums' || pathname.startsWith('/album/')
  const isSoundCloudActive = pathname === '/soundcloud'
  const isDriveActive = pathname === '/drive'
  const isFavoritesActive = pathname === '/favorites'
  const isHistoryActive = pathname === '/history'
  const isReceiptActive = pathname === '/receipt'
  const isUploadActive = pathname === '/upload'
  const isSettingsActive = pathname === '/settings'

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
    <aside className={`app-sidebar hidden lg:flex w-60 lg:w-64 xl:w-72 flex-col p-3 lg:p-3.5 xl:p-4 h-full select-none text-slate-300 rounded-2xl shrink-0 z-20 overflow-hidden ${isScrolled ? 'is-scrolled' : ''}`}>
      {/* App Branding Header (Mini Glass Plaque) - Fixed at top, never scrolls or clips */}
      <div className="px-0.5 py-0.5 shrink-0 mb-2 z-20">
        <Link
          href="/"
          onClick={() => {
            clearSearch()
            window.dispatchEvent(new Event('musicweb-tab-home'))
          }}
          className="sidebar-logo-plaque w-full flex items-center justify-start px-3.5 py-2 lg:py-2.5 rounded-2xl group cursor-pointer active:scale-[0.98]"
          title="MusicWeb"
        >
          <div className="flex items-center justify-start h-8 lg:h-9 shrink-0">
            <img
              src="/phong-signature.png"
              alt="MusicWeb Logo"
              className="h-8 lg:h-9 w-auto object-contain signature-img-invert"
            />
          </div>
        </Link>
      </div>

      <div className="flex flex-col gap-2 min-h-0 flex-1 overflow-y-auto no-scrollbar touch-pan-y">
        {/* Main Navigation List */}
        <nav
          ref={exploreNavRef}
          onPointerLeave={exploreGlide.hide}
          className="flex flex-col gap-0.5 lg:gap-1 relative isolate shrink-0"
        >
          <div
            className="sidebar-glide nav-indicator"
            style={{
              transform: `translate3d(0, ${exploreGlide.state.top}px, 0)`,
              height: `${exploreGlide.state.height}px`,
              opacity: exploreGlide.state.opacity,
            }}
          />

          <p className="text-[11px] font-mono tracking-wider text-slate-500 uppercase px-2.5 py-1 relative z-10">
            {t('explore')}
          </p>

          <Link
            href="/"
            onPointerEnter={(e) => handleExplorePointerEnter(e, isHomeActive)}
            onClick={() => {
              clearSearch()
              window.dispatchEvent(new Event('musicweb-tab-home'))
            }}
            className={getExploreItemClass(isHomeActive)}
          >
            {isHomeActive && renderActivePill()}
            <Home className="w-4 h-4 icon relative z-[1] shrink-0" />
            <span className="relative z-[1] truncate">{t('home')}</span>
          </Link>

          <Link
            href="/albums"
            onPointerEnter={(e) => handleExplorePointerEnter(e, isAlbumsActive)}
            className={getExploreItemClass(isAlbumsActive)}
          >
            {isAlbumsActive && renderActivePill()}
            <DiscAlbum className="w-4 h-4 icon relative z-[1] shrink-0" />
            <span className="relative z-[1] truncate">{t('albums')}</span>
          </Link>

          <Link
            href="/soundcloud"
            onPointerEnter={(e) => handleExplorePointerEnter(e, isSoundCloudActive)}
            className={getExploreItemClass(isSoundCloudActive)}
          >
            {isSoundCloudActive && renderActivePill()}
            <Cloud className="w-4 h-4 text-[#ff7700] icon relative z-[1] shrink-0" />
            <span className="relative z-[1] truncate">SoundCloud</span>
          </Link>

          <Link
            href="/drive"
            onPointerEnter={(e) => handleExplorePointerEnter(e, isDriveActive)}
            className={getExploreItemClass(isDriveActive)}
          >
            {isDriveActive && renderActivePill()}
            <FolderArchive className="w-4 h-4 text-[#22c55e] icon relative z-[1] shrink-0" />
            <span className="relative z-[1] truncate">Google Drive</span>
          </Link>

          <Link
            href="/favorites"
            onPointerEnter={(e) => handleExplorePointerEnter(e, isFavoritesActive)}
            className={getExploreItemClass(isFavoritesActive)}
          >
            {isFavoritesActive && renderActivePill()}
            <Heart className="w-4 h-4 icon relative z-[1] shrink-0" />
            <span className="relative z-[1] truncate">{t('favorites')}</span>
          </Link>

          <Link
            href="/history"
            onPointerEnter={(e) => handleExplorePointerEnter(e, isHistoryActive)}
            className={getExploreItemClass(isHistoryActive)}
          >
            {isHistoryActive && renderActivePill()}
            <History className="w-4 h-4 icon relative z-[1] shrink-0" />
            <span className="relative z-[1] truncate">{t('history')}</span>
          </Link>

          <Link
            href="/receipt"
            onPointerEnter={(e) => handleExplorePointerEnter(e, isReceiptActive)}
            className={getExploreItemClass(isReceiptActive)}
          >
            {isReceiptActive && renderActivePill()}
            <Receipt className="w-4 h-4 text-amber-400 icon relative z-[1] shrink-0" />
            <span className="relative z-[1] truncate">{t('receipt')}</span>
          </Link>

          {isAdmin(user?.email) && (
            <Link
              href="/upload"
              onPointerEnter={(e) => handleExplorePointerEnter(e, isUploadActive)}
              className={getExploreItemClass(isUploadActive)}
            >
              {isUploadActive && renderActivePill()}
              <Upload className="w-4 h-4 icon relative z-[1] shrink-0" />
              <span className="relative z-[1] truncate">{t('upload')}</span>
            </Link>
          )}

          <Link
            href="/settings"
            onPointerEnter={(e) => handleExplorePointerEnter(e, isSettingsActive)}
            className={getExploreItemClass(isSettingsActive)}
          >
            {isSettingsActive && renderActivePill()}
            <Settings className="w-4 h-4 icon relative z-[1] shrink-0" />
            <span className="relative z-[1] truncate">{t('settings')}</span>
          </Link>
        </nav>

        {/* Playlists Container with Dedicated Scrollable Track Area */}
        <div className="flex-1 flex flex-col min-h-[140px] pt-2 border-t border-white/[0.06]">
          {/* Action cluster: enlarged import & create buttons with horizontal glide indicator */}
          <div className="px-0.5 mb-1.5 shrink-0">
            <div
              onPointerLeave={handleActionPointerLeave}
              className="relative flex items-center justify-between gap-1 bg-white/[0.03] p-1 rounded-full shadow-inner w-full overflow-hidden border border-white/[0.08]"
            >
              <div
                className={`action-glide-indicator variant-${actionIndicator.variant}`}
                style={{
                  transform: `translate3d(${actionIndicator.left}px, 0, 0)`,
                  width: `${actionIndicator.width}px`,
                  opacity: actionIndicator.opacity,
                }}
              />

              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                onPointerEnter={(e) => handleActionPointerEnter(e, 'emerald')}
                className="relative z-[1] flex-1 h-8 rounded-full text-emerald-400 hover:text-emerald-300 flex items-center justify-center active:scale-[0.97] transition-[transform,color,opacity] duration-150 ease-[var(--ease-out)] cursor-pointer"
                title="Nhập Playlist từ Spotify"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                  <path d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm5.504 17.308c-.216.353-.675.464-1.028.248-2.816-1.72-6.36-2.109-10.535-1.155-.403.092-.805-.16-.897-.563-.092-.403.16-.805.563-.897 4.568-1.044 8.485-.594 11.649 1.339.353.216.464.675.248 1.028zm1.469-3.268c-.272.442-.851.58-1.293.308-3.224-1.981-8.138-2.555-11.951-1.397-.497.151-1.022-.13-1.173-.627-.151-.497.13-1.022.627-1.173 4.356-1.322 9.772-.682 13.482 1.596.442.272.58.851.308 1.293zm.126-3.403c-3.866-2.296-10.244-2.507-13.937-1.386-.593.18-1.22-.155-1.4-.748-.18-.593.155-1.22.748-1.4 4.24-1.287 11.286-1.038 15.736 1.604.534.317.709 1.006.392 1.54-.317.534-1.006.709-1.539.39z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setIsYtImportModalOpen(true)}
                onPointerEnter={(e) => handleActionPointerEnter(e, 'rose')}
                className="relative z-[1] flex-1 h-8 rounded-full text-red-400 hover:text-red-300 flex items-center justify-center active:scale-[0.97] transition-[transform,color,opacity] duration-150 ease-[var(--ease-out)] cursor-pointer"
                title="Nhập Playlist từ YouTube Music"
              >
                <YoutubeIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsScImportModalOpen(true)}
                onPointerEnter={(e) => handleActionPointerEnter(e, 'orange')}
                className="relative z-[1] flex-1 h-8 rounded-full text-[#ff7700] hover:text-[#ff5500] flex items-center justify-center active:scale-[0.97] transition-[transform,color,opacity] duration-150 ease-[var(--ease-out)] cursor-pointer"
                title="Nhập Playlist từ SoundCloud"
              >
                <Cloud className="w-4 h-4" />
              </button>
              <div className="relative z-[1] w-[1px] h-3.5 bg-white/10 my-auto mx-0.5 shrink-0" />
              <button
                type="button"
                onClick={handleCreatePlaylist}
                disabled={creating}
                onPointerEnter={(e) => handleActionPointerEnter(e, 'cyan')}
                className="relative z-[1] flex-1 h-8 rounded-full text-[var(--spotify-glow,#22d3ee)] hover:text-white flex items-center justify-center active:scale-[0.97] transition-[transform,color,opacity] duration-150 ease-[var(--ease-out)] cursor-pointer disabled:opacity-50"
                title="Tạo Playlist mới"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            ref={playlistNavRef}
            onPointerLeave={playlistGlide.hide}
            className="flex-1 overflow-y-auto flex flex-col gap-0.5 lg:gap-1 relative no-scrollbar min-h-0 touch-pan-y pb-4"
          >
            <div
              className="sidebar-glide nav-indicator"
              style={{
                transform: `translate3d(0, ${playlistGlide.state.top}px, 0)`,
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
                    onPointerEnter={(e) => {
                      if (e.pointerType === 'touch') return
                      if (pathname === `/playlist/${pl.id}`) {
                        playlistGlide.hide()
                        return
                      }
                      playlistGlide.moveTo(e.currentTarget)
                    }}
                    className={`sidebar-item text-xs group active:scale-[0.97] transition-[transform,color,background-color] duration-150 ease-[var(--ease-out)] ${
                      pathname === `/playlist/${pl.id}` ? 'sidebar-item--active active font-semibold' : ''
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-slate-300 shrink-0 icon group-hover:text-[var(--sidebar-accent)] transition-colors shadow-inner">
                      <Music className="w-3.5 h-3.5" />
                    </div>
                    <span className="truncate flex-1 font-medium group-hover:text-white transition-colors">{pl.name}</span>
                    <button
                      type="button"
                      onClick={(e) => handleDeletePlaylistFromSidebar(e, pl.id, pl.name)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 rounded-lg hover:bg-red-500/15 active:scale-[0.97] transition-[transform,opacity,color,background-color] duration-150 ease-[var(--ease-out)] relative z-10 shrink-0 cursor-pointer"
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
                    type="button"
                    onClick={handleCreatePlaylist}
                    className="text-[11px] font-bold text-[var(--spotify-glow,#22d3ee)] hover:underline mt-1 inline-block active:scale-[0.97] transition-[transform,color] duration-150 ease-[var(--ease-out)] cursor-pointer"
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
                  className="bg-white text-black font-bold text-[11px] px-3 py-1 rounded-full inline-block active:scale-[0.97] transition-[transform,background-color,color] duration-150 ease-[var(--ease-out)]"
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
