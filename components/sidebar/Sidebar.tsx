'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Home,
  Upload,
  Plus,
  Music,
  LogOut,
  ListMusic,
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

  const [exploreIndicator, setExploreIndicator] = useState<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 38,
    opacity: 0,
  })

  const [playlistIndicator, setPlaylistIndicator] = useState<{ top: number; height: number; opacity: number }>({
    top: 0,
    height: 36,
    opacity: 0,
  })

  const handleItemMouseEnter = (
    e: React.MouseEvent<HTMLElement>,
    setIndicator: React.Dispatch<React.SetStateAction<{ top: number; height: number; opacity: number }>>
  ) => {
    const el = e.currentTarget
    if (el.classList.contains('active')) {
      setIndicator((prev) => ({ ...prev, opacity: 0 }))
      return
    }
    setIndicator({
      top: el.offsetTop,
      height: el.offsetHeight,
      opacity: 1,
    })
  }

  const handleSectionMouseLeave = (
    containerRef: React.RefObject<HTMLElement | HTMLDivElement | null>,
    setIndicator: React.Dispatch<React.SetStateAction<{ top: number; height: number; opacity: number }>>
  ) => {
    setIndicator((prev) => ({ ...prev, opacity: 0 }))
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
    setExploreIndicator((prev) => ({ ...prev, opacity: 0 }))
    setPlaylistIndicator((prev) => ({ ...prev, opacity: 0 }))
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
      <div className="flex flex-col gap-2.5 lg:gap-3 xl:gap-3.5 min-h-0 flex-1 h-full max-h-full pb-20 xl:pb-24 overflow-hidden">
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
          onMouseLeave={() => handleSectionMouseLeave(exploreNavRef, setExploreIndicator)}
          className="flex flex-col gap-0.5 lg:gap-1 relative shrink-0"
        >
          <div
            className="nav-indicator"
            style={{
              transform: `translateY(${exploreIndicator.top}px)`,
              height: `${exploreIndicator.height}px`,
              opacity: exploreIndicator.opacity,
            }}
          />

          <p className="text-[11px] font-mono tracking-wider text-slate-500 uppercase px-2.5 py-1 relative z-10">
            Khám phá
          </p>

          <Link
            href="/"
            onMouseEnter={(e) => handleItemMouseEnter(e, setExploreIndicator)}
            onClick={(e) => {
              handleItemClick(e)
              clearSearch()
              window.dispatchEvent(new Event('musicweb-tab-home'))
            }}
            className={`sidebar-item text-xs ${pathname === '/' ? 'active font-semibold' : ''}`}
          >
            <Home className="w-4 h-4 icon" />
            <span>{t('home')}</span>
          </Link>

          <Link
            href="/albums"
            onMouseEnter={(e) => handleItemMouseEnter(e, setExploreIndicator)}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${
              pathname === '/albums' || pathname.startsWith('/album/') ? 'active font-semibold' : ''
            }`}
          >
            <DiscAlbum className="w-4 h-4 icon" />
            <span>Albums</span>
          </Link>

          <Link
            href="/soundcloud"
            onMouseEnter={(e) => handleItemMouseEnter(e, setExploreIndicator)}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/soundcloud' ? 'active font-semibold' : ''}`}
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
            onMouseEnter={(e) => handleItemMouseEnter(e, setExploreIndicator)}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/drive' ? 'active font-semibold' : ''}`}
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
            onMouseEnter={(e) => handleItemMouseEnter(e, setExploreIndicator)}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/favorites' ? 'active font-semibold' : ''}`}
          >
            <Heart className="w-4 h-4 icon" />
            <span>{t('favorites')}</span>
          </Link>

          <Link
            href="/history"
            onMouseEnter={(e) => handleItemMouseEnter(e, setExploreIndicator)}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/history' ? 'active font-semibold' : ''}`}
          >
            <History className="w-4 h-4 icon" />
            <span>{t('history')}</span>
          </Link>

          <Link
            href="/receipt"
            onMouseEnter={(e) => handleItemMouseEnter(e, setExploreIndicator)}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/receipt' ? 'active font-semibold' : ''}`}
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
              onMouseEnter={(e) => handleItemMouseEnter(e, setExploreIndicator)}
              onClick={handleItemClick}
              className={`sidebar-item text-xs ${pathname === '/upload' ? 'active font-semibold' : ''}`}
            >
              <Upload className="w-4 h-4 icon" />
              <span>{t('upload')}</span>
            </Link>
          )}

          <Link
            href="/settings"
            onMouseEnter={(e) => handleItemMouseEnter(e, setExploreIndicator)}
            onClick={handleItemClick}
            className={`sidebar-item text-xs ${pathname === '/settings' ? 'active font-semibold' : ''}`}
          >
            <Settings className="w-4 h-4 icon" />
            <span>{t('settings')}</span>
          </Link>
        </nav>

        {/* Playlists Container with Dedicated Scrollable Track Area */}
        <div className="flex-1 flex flex-col min-h-0 pt-2 lg:pt-2.5 border-t border-white/[0.05] overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1.5 mb-1.5 border-b border-white/[0.04] shrink-0 gap-1.5">
            <div className="flex items-center gap-1.5 text-slate-400 font-mono text-[11px] tracking-wider uppercase font-bold whitespace-nowrap min-w-0">
              <ListMusic style={{ color: 'var(--spotify-glow, #22d3ee)' }} className="w-3.5 h-3.5 shrink-0" />
              <span>Playlist</span>
              {playlists.length > 0 && (
                <span className="text-[10px] text-slate-500 font-normal">({playlists.length})</span>
              )}
            </div>

            <div className="flex items-center gap-0.5 bg-white/[0.03] border border-white/[0.08] p-0.5 rounded-lg shadow-inner shrink-0">
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="w-6 h-6 rounded-md text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/20 flex items-center justify-center transition-all cursor-pointer"
                title="Nhập Playlist từ Spotify"
              >
                <Sparkles className="w-3 h-3" />
              </button>
              <button
                onClick={() => setIsYtImportModalOpen(true)}
                className="w-6 h-6 rounded-md text-red-400 hover:text-red-300 hover:bg-red-500/20 flex items-center justify-center transition-all cursor-pointer"
                title="Nhập Playlist từ YouTube Music"
              >
                <YoutubeIcon className="w-3 h-3" />
              </button>
              <button
                onClick={() => setIsScImportModalOpen(true)}
                className="w-6 h-6 rounded-md text-[#ff7700] hover:text-[#ff5500] hover:bg-[#ff5500]/20 flex items-center justify-center transition-all cursor-pointer"
                title="Nhập Playlist từ SoundCloud"
              >
                <Cloud className="w-3 h-3" />
              </button>
              <div className="w-[1px] h-2.5 bg-white/10 my-auto mx-0.5 shrink-0" />
              <button
                onClick={handleCreatePlaylist}
                disabled={creating}
                className="w-6 h-6 rounded-md text-[var(--spotify-glow,#22d3ee)] hover:text-white hover:bg-[var(--primary-spotify)]/20 flex items-center justify-center transition-all cursor-pointer"
                title="Tạo Playlist mới"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div
            ref={playlistNavRef}
            onMouseLeave={() => handleSectionMouseLeave(playlistNavRef, setPlaylistIndicator)}
            className="flex-1 overflow-y-auto flex flex-col gap-1 relative no-scrollbar min-h-0 touch-pan-y"
          >
            <div
              className="nav-indicator"
              style={{
                transform: `translateY(${playlistIndicator.top}px)`,
                height: `${playlistIndicator.height}px`,
                opacity: playlistIndicator.opacity,
              }}
            />

            {user || playlists.length > 0 ? (
              playlists.length > 0 ? (
                playlists.map((pl) => (
                  <Link
                    key={pl.id}
                    href={`/playlist/${pl.id}`}
                    onMouseEnter={(e) => handleItemMouseEnter(e, setPlaylistIndicator)}
                    onClick={handleItemClick}
                    className={`sidebar-item h-12 min-h-[48px] max-h-[48px] shrink-0 group px-3 rounded-2xl flex items-center gap-3 transition-all ${
                      pathname === `/playlist/${pl.id}` ? 'active font-semibold bg-white/[0.08] text-white shadow-sm' : 'hover:bg-white/[0.04] text-slate-300'
                    }`}
                  >
                    <div className="w-8.5 h-8.5 rounded-full bg-white/[0.06] border border-white/10 flex items-center justify-center text-slate-300 shrink-0 icon group-hover:text-[var(--spotify-glow,#22d3ee)] group-hover:scale-105 transition-all shadow-inner">
                      <Music className="w-4 h-4" />
                    </div>
                    <span className="truncate flex-1 font-semibold text-sm text-slate-200 group-hover:text-white transition-colors">{pl.name}</span>
                    <button
                      onClick={(e) => handleDeletePlaylistFromSidebar(e, pl.id, pl.name)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-500 hover:text-red-400 rounded-lg hover:bg-red-500/15 transition-all relative z-10 shrink-0 cursor-pointer"
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
