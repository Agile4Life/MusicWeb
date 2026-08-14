'use client'

import React, { useState, useEffect, useRef } from 'react'
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
  Menu,
  X,
  Heart,
  History,
  Receipt,
  Settings,
  Trash2,
  DiscAlbum,
  ChevronLeft,
  Sparkles,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Playlist } from '@/types'
import { isAdmin, getValidUserId } from '@/lib/accessControl'
import { useSession, signOut } from 'next-auth/react'
import { useSearch } from '@/components/search/SearchContext'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { usePlaylists } from '@/components/playlist/PlaylistContext'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { ImportSpotifyModal } from '@/components/playlist/ImportSpotifyModal'
import { ImportYouTubePlaylistModal } from '@/components/playlist/ImportYouTubePlaylistModal'
import { ImportSoundCloudModal } from '@/components/playlist/ImportSoundCloudModal'
import { YoutubeIcon } from '@/components/icons/YoutubeIcon'
import { shouldCloseProfileMenu, shouldToggleProfileMenu } from './profileMenuInteraction'

export function MobileHeaderNav() {
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
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)
  const [touchStartX, setTouchStartX] = useState<number | null>(null)
  const [touchEndX, setTouchEndX] = useState<number | null>(null)
  const navBackBusyRef = useRef(false)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const profileTriggerRef = useRef<HTMLButtonElement>(null)

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.targetTouches[0].clientX)
    setTouchEndX(null)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    setTouchEndX(e.targetTouches[0].clientX)
  }

  const handleTouchEnd = () => {
    if (touchStartX !== null && touchEndX !== null) {
      const distance = touchEndX - touchStartX
      if (Math.abs(distance) > 40) {
        setIsDrawerOpen(false)
      }
    }
    setTouchStartX(null)
    setTouchEndX(null)
  }

  useEffect(() => {
    const handleProfilePointerDown = (e: MouseEvent) => {
      if (shouldCloseProfileMenu(e.target, profileMenuRef.current, profileTriggerRef.current)) {
        setIsProfileMenuOpen(false)
      }
    }
    const handleProfileKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsProfileMenuOpen(false)
    }

    document.addEventListener('mousedown', handleProfilePointerDown)
    document.addEventListener('keydown', handleProfileKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleProfilePointerDown)
      document.removeEventListener('keydown', handleProfileKeyDown)
    }
  }, [])

  useEffect(() => {
    setIsProfileMenuOpen(false)
  }, [pathname])

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
    setIsProfileMenuOpen(false)
    await supabase.auth.signOut()
    await signOut({ callbackUrl: '/login' })
    setIsDrawerOpen(false)
    window.location.href = '/login'
  }

  const handleCreatePlaylist = async () => {
    if (!user) {
      router.push('/login')
      setIsDrawerOpen(false)
      return
    }

    const created = await createPlaylist()
    if (created && created.id) {
      setIsDrawerOpen(false)
      router.push(`/playlist/${created.id}`)
    }
  }

  const handleDeletePlaylist = async (e: React.MouseEvent, playlistId: string, playlistName: string) => {
    e.preventDefault()
    e.stopPropagation()

    const deleted = await deletePlaylist(playlistId, playlistName)
    if (deleted && pathname === `/playlist/${playlistId}`) {
      router.push('/')
    }
  }

  return (
    <>
      {/* 📱 Mobile Top Header Bar (< 768px) */}
      <div className="mobile-header relative lg:hidden h-14 px-3 xs:px-4 flex items-center justify-between select-none shrink-0">
        <div className="flex items-center gap-2 shrink-0 z-10">
          {pathname !== '/' && (
            <button
              onClick={() => {
                if (navBackBusyRef.current) return
                navBackBusyRef.current = true
                if (window.history.length > 1) {
                  router.back()
                } else {
                  router.push('/')
                }
                setTimeout(() => {
                  navBackBusyRef.current = false
                }, 500)
              }}
              className="p-2 text-slate-300 hover:text-white rounded-xl bg-white/[0.04] border border-white/[0.06] active:scale-95 transition-transform shrink-0"
              title="Quay lại"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => setIsDrawerOpen(true)}
            className="p-2 text-slate-300 hover:text-white rounded-xl bg-white/[0.04] border border-white/[0.06] active:scale-95 transition-transform shrink-0"
            title="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* Center Slot: Exact Center Logo Plaque */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Link
            href="/"
            onClick={() => {
              clearSearch()
              window.dispatchEvent(new Event('musicweb-tab-home'))
            }}
            className="sidebar-logo-plaque pointer-events-auto flex items-center justify-center px-3.5 py-1.5 rounded-2xl group cursor-pointer"
            title="MusicWeb"
          >
            <div className="flex items-center justify-center h-7.5 xs:h-8 shrink-0">
              <img
                src="/phong-signature.png"
                alt="MusicWeb Logo"
                className="h-7.5 xs:h-8 w-auto object-contain signature-img-invert group-hover:scale-[1.03] transition-transform"
              />
            </div>
          </Link>
        </div>

        {/* Right Slot: Balanced space for centered logo */}
        <div className="w-9 h-9 shrink-0 z-10 pointer-events-none" />
      </div>

      {/* 📱 Mobile Bottom Navigation Bar (< 768px) */}
      <div className="bottom-nav lg:hidden fixed bottom-0 left-0 right-0 z-40 h-16 grid grid-cols-5 items-center select-none px-1">
        <Link
          href="/"
          prefetch={false}
          onClick={() => {
            clearSearch()
            window.dispatchEvent(new Event('musicweb-tab-home'))
          }}
          className={`bottom-nav-item flex flex-col items-center justify-center gap-1 ${pathname === '/' ? 'active' : ''}`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] truncate max-w-full">Trang chủ</span>
        </Link>

        <Link
          href="/albums"
          prefetch={false}
          className={`bottom-nav-item flex flex-col items-center justify-center gap-1 ${
            pathname === '/albums' || pathname.startsWith('/album/') ? 'active' : ''
          }`}
        >
          <DiscAlbum className="w-5 h-5" />
          <span className="text-[10px] truncate max-w-full">Albums</span>
        </Link>

        <Link
          href="/favorites"
          prefetch={false}
          className={`bottom-nav-item flex flex-col items-center justify-center gap-1 ${
            pathname === '/favorites' ? 'active' : ''
          }`}
        >
          <Heart className="w-5 h-5" />
          <span className="text-[10px] truncate max-w-full">Yêu thích</span>
        </Link>

        <button
          onClick={() => {
            if (playlists.length > 0) {
              if (pathname.startsWith('/playlist/')) {
                const currentId = pathname.replace('/playlist/', '')
                const curIdx = playlists.findIndex((p) => p.id === currentId)
                const nextIdx = (curIdx + 1) % playlists.length
                router.push(`/playlist/${playlists[nextIdx].id}`)
              } else {
                router.push(`/playlist/${playlists[0].id}`)
              }
            } else {
              setIsDrawerOpen(true)
            }
          }}
          className={`bottom-nav-item flex flex-col items-center justify-center gap-1 ${
            pathname.startsWith('/playlist/') ? 'active' : ''
          }`}
        >
          <ListMusic className="w-5 h-5" />
          <span className="text-[10px] truncate max-w-full">Playlist</span>
        </button>

        <Link
          href="/history"
          prefetch={false}
          className={`bottom-nav-item flex flex-col items-center justify-center gap-1 ${
            pathname === '/history' ? 'active' : ''
          }`}
        >
          <History className="w-5 h-5" />
          <span className="text-[10px] truncate max-w-full">Lịch sử</span>
        </Link>
      </div>

      {/* 📱 Mobile Slide Drawer Navigation (from left, with backdrop) */}
      <div
        onClick={() => setIsDrawerOpen(false)}
        className={`mobile-drawer-backdrop lg:hidden z-[95] ${isDrawerOpen ? 'open' : ''}`}
      />

      <div
        className={`mobile-drawer lg:hidden z-[100] border-r border-white/10 ${isDrawerOpen ? 'open' : ''}`}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className="h-full p-5 flex flex-col justify-between overflow-y-auto select-none touch-pan-y"
        >
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-white/[0.05] pb-4">
              <div className="sidebar-logo-plaque flex items-center justify-start px-3 py-1.5 rounded-2xl">
                <div className="flex items-center justify-start h-7.5 shrink-0">
                  <img
                    src="/phong-signature.png"
                    alt="MusicWeb Logo"
                    className="h-7.5 w-auto object-contain signature-img-invert"
                  />
                </div>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="w-11 h-11 flex items-center justify-center text-slate-400 hover:text-white rounded-xl bg-white/[0.04] active:scale-95 transition-all"
                title="Đóng menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Navigation links */}
            <nav className="flex flex-col gap-1">
              <Link
                href="/"
                prefetch={false}
                onClick={() => {
                  clearSearch()
                  window.dispatchEvent(new Event('musicweb-tab-home'))
                  setIsDrawerOpen(false)
                }}
                className={`sidebar-item text-xs font-semibold ${pathname === '/' ? 'active' : ''}`}
              >
                <Home className="w-4 h-4" />
                <span>Trang chủ</span>
              </Link>

              <Link
                href="/albums"
                prefetch={false}
                onClick={() => setIsDrawerOpen(false)}
                className={`sidebar-item text-xs font-semibold ${
                  pathname === '/albums' || pathname.startsWith('/album/') ? 'active' : ''
                }`}
              >
                <DiscAlbum className="w-4 h-4" />
                <span>Albums</span>
              </Link>

              <Link
                href="/soundcloud"
                prefetch={false}
                onClick={() => setIsDrawerOpen(false)}
                className={`sidebar-item text-xs font-semibold ${
                  pathname === '/soundcloud' ? 'active' : ''
                }`}
              >
                <Cloud className="w-4 h-4 text-[#ff7700]" />
                <div className="flex items-center justify-between flex-1">
                  <span>SoundCloud</span>
                  <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-[#ff5500]/20 text-[#ff7700] border border-[#ff5500]/35">
                    HOT
                  </span>
                </div>
              </Link>

              <Link
                href="/drive"
                prefetch={false}
                onClick={() => setIsDrawerOpen(false)}
                className={`sidebar-item text-xs font-semibold ${pathname === '/drive' ? 'active' : ''}`}
              >
                <Cloud className="w-4 h-4" />
                <span>{t('drive')}</span>
              </Link>

              <Link
                href="/favorites"
                prefetch={false}
                onClick={() => setIsDrawerOpen(false)}
                className={`sidebar-item text-xs font-semibold ${pathname === '/favorites' ? 'active' : ''}`}
              >
                <Heart className="w-4 h-4" />
                <span>Yêu thích</span>
              </Link>

              <Link
                href="/history"
                prefetch={false}
                onClick={() => setIsDrawerOpen(false)}
                className={`sidebar-item text-xs font-semibold ${pathname === '/history' ? 'active' : ''}`}
              >
                <History className="w-4 h-4" />
                <span>Lịch sử nghe</span>
              </Link>

              <Link
                href="/receipt"
                prefetch={false}
                onClick={() => setIsDrawerOpen(false)}
                className={`sidebar-item text-xs font-semibold ${pathname === '/receipt' ? 'active' : ''}`}
              >
                <Receipt className="w-4 h-4 text-amber-400" />
                <div className="flex items-center justify-between flex-1">
                  <span>Hóa đơn âm nhạc</span>
                  <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30">
                    MỚI
                  </span>
                </div>
              </Link>

              {isAdmin(user?.email) && (
                <Link
                  href="/upload"
                  prefetch={false}
                  onClick={() => setIsDrawerOpen(false)}
                  className={`sidebar-item text-xs font-semibold ${pathname === '/upload' ? 'active' : ''}`}
                >
                  <Upload className="w-4 h-4" />
                  <span>Upload Nhạc</span>
                </Link>
              )}

              <Link
                href="/settings"
                prefetch={false}
                onClick={() => setIsDrawerOpen(false)}
                className={`sidebar-item text-xs font-semibold ${pathname === '/settings' ? 'active' : ''}`}
              >
                <Settings className="w-4 h-4" />
                <span>Cài đặt & Màu sắc</span>
              </Link>
            </nav>

              {/* Playlists in drawer */}
              <div className="border-t border-white/[0.05] pt-4 flex flex-col gap-2">
                <div className="flex items-center justify-between px-1 mb-1">
                  <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider font-bold">
                    Playlist cá nhân
                  </span>
                  <div className="flex items-center gap-0.5 bg-white/[0.03] border border-white/[0.08] p-0.5 rounded-xl shadow-inner">
                    <button
                      onClick={() => {
                        setIsDrawerOpen(false)
                        setIsImportModalOpen(true)
                      }}
                      className="w-7 h-7 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/20 flex items-center justify-center transition-all"
                      title="Nhập Playlist từ Spotify"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setIsDrawerOpen(false)
                        setIsYtImportModalOpen(true)
                      }}
                      className="w-7 h-7 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/20 flex items-center justify-center transition-all"
                      title="Nhập Playlist từ YouTube Music"
                    >
                      <YoutubeIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setIsDrawerOpen(false)
                        setIsScImportModalOpen(true)
                      }}
                      className="w-7 h-7 rounded-lg text-[#ff7700] hover:text-[#ff5500] hover:bg-[#ff5500]/20 flex items-center justify-center transition-all"
                      title="Nhập Playlist từ SoundCloud"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                    </button>
                    <div className="w-[1px] h-3 bg-white/10 my-auto mx-0.5" />
                    <button
                      onClick={handleCreatePlaylist}
                      className="w-7 h-7 rounded-lg text-[var(--spotify-glow,#22d3ee)] hover:text-white hover:bg-[var(--primary-spotify)]/20 flex items-center justify-center transition-all"
                      title="Tạo Playlist mới"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1 max-h-60 overflow-y-auto custom-slim-scrollbar pr-1 touch-pan-y">
                  {playlists.map((pl) => (
                    <Link
                      key={pl.id}
                      href={`/playlist/${pl.id}`}
                      onClick={() => setIsDrawerOpen(false)}
                      className={`sidebar-item text-xs ${
                        pathname === `/playlist/${pl.id}` ? 'active font-semibold' : ''
                      }`}
                    >
                      <span className="truncate flex-1">{pl.name}</span>
                      <button
                        onClick={(e) => handleDeletePlaylist(e, pl.id, pl.name)}
                        className="p-1 text-slate-500 hover:text-red-400 opacity-60"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </Link>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer user info */}
            <div className="border-t border-white/[0.05] pt-4">
              {user ? (
                <div className="relative">
                  <button
                    ref={profileTriggerRef}
                    type="button"
                    onClick={() => setIsProfileMenuOpen(shouldToggleProfileMenu(isProfileMenuOpen))}
                    aria-expanded={isProfileMenuOpen}
                    aria-controls="mobile-profile-menu"
                    aria-label="Mở menu tài khoản"
                    className="w-full min-h-11 flex items-center gap-2.5 rounded-xl px-2 text-left hover:bg-white/[0.06] active:scale-[0.99] transition-all"
                  >
                    <div className="w-7 h-7 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-[var(--spotify-glow,#22d3ee)] shrink-0 font-bold text-xs overflow-hidden">
                      {user.user_metadata?.avatar_url ? (
                        <img
                          src={user.user_metadata.avatar_url}
                          alt={user.email}
                          className="w-full h-full rounded-full object-cover"
                        />
                      ) : (
                        <UserCheck className="w-3.5 h-3.5" />
                      )}
                    </div>
                    <span className="text-xs font-bold text-white truncate">
                      {user.user_metadata?.full_name || user.email?.split('@')[0]}
                    </span>
                  </button>
                  {isProfileMenuOpen && (
                    <div
                      ref={profileMenuRef}
                      id="mobile-profile-menu"
                      role="menu"
                      className="absolute bottom-full left-0 right-0 mb-2 rounded-2xl border border-white/[0.14] bg-[var(--elevation-3-bg,#111827)]/95 p-2 shadow-2xl backdrop-blur-xl z-50"
                    >
                      <div className="px-3 py-2 border-b border-white/[0.08]">
                        <p className="text-sm font-bold text-white truncate">
                          {user.user_metadata?.full_name || user.email?.split('@')[0]}
                        </p>
                        <p className="text-[11px] text-slate-300 truncate mt-0.5">{user.email}</p>
                      </div>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleLogout}
                        className="w-full min-h-11 mt-1 flex items-center gap-2 rounded-xl px-3 text-sm font-semibold text-rose-300 hover:bg-rose-500/10 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Đăng xuất</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Link
                  href="/login"
                  onClick={() => setIsDrawerOpen(false)}
                  className="block text-center py-2 bg-[var(--primary-spotify,#06b6d4)] text-black text-xs font-bold rounded-xl"
                >
                  Đăng nhập
                </Link>
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
    </>
  )
}
