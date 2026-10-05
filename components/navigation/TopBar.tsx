'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Search, X, Music, Play, Upload, User, Loader2, LogOut } from 'lucide-react'
import { Track } from '@/types'
import { usePlayerControls } from '@/components/player/PlayerContext'
import { useSearch } from '@/components/search/SearchContext'
import { useSession, signOut } from 'next-auth/react'
import { useCurrentUser } from '@/components/auth/CurrentUserContext'
import { createClient } from '@/lib/supabase/client'
import { isAdmin } from '@/lib/accessControl'
import Link from 'next/link'

import { flattenUnifiedSearchResults } from '@/lib/searchFlow'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'
import { shouldCommitGlobalSearch, shouldRedirectToHomeOnSearch } from '@/components/search/searchInteraction'
import { shouldCloseProfileMenu, shouldToggleProfileMenu } from './profileMenuInteraction'

export function TopBar() {
  const router = useRouter()
  const pathname = usePathname()
  const isSoundCloudPage = pathname === '/soundcloud'
  const { playTrack, playSearchTrack } = usePlayerControls()
  const {
    searchQuery,
    setSearchQuery,
    suggestionTracks,
    searchingSuggestions,
    setSuggestionQuery,
    clearSearch,
  } = useSearch()
  const { data: nextAuthSession } = useSession()
  const { userEmail } = useCurrentUser()
  const supabase = createClient()

  const [showDropdown, setShowDropdown] = useState(false)
  const [inputQuery, setInputQuery] = useState(searchQuery)
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)
  const profileMenuRef = useRef<HTMLDivElement>(null)
  const profileTriggerRef = useRef<HTMLButtonElement>(null)

  const user = userEmail
    ? {
        id: userEmail,
        email: userEmail,
        user_metadata: nextAuthSession?.user
          ? {
              full_name: nextAuthSession.user.name,
              avatar_url: nextAuthSession.user.image,
            }
          : {},
      }
    : null

  const handleLogout = async () => {
    setIsProfileMenuOpen(false)
    await supabase.auth.signOut()
    await signOut({ callbackUrl: '/login' })
    window.location.href = '/login'
  }

  const suggestions: Track[] = React.useMemo(() => {
    return flattenUnifiedSearchResults(suggestionTracks).slice(0, 6)
  }, [suggestionTracks])

  useEffect(() => {
    setInputQuery(searchQuery)
  }, [searchQuery])

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('q=')) {
      router.replace(pathname, { scroll: false })
    }
  }, [pathname, router])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  const handleClearSearch = () => {
    clearSearch()
    setInputQuery('')
    setShowDropdown(false)
  }

  const handleSubmitSearch = () => {
    const trimmed = inputQuery.trim()
    if (!trimmed) return
    setSearchQuery(trimmed)
    setSuggestionQuery('')
    setShowDropdown(false)
    if (shouldRedirectToHomeOnSearch(pathname)) {
      router.push('/')
    }
  }

  return (
    <header className="sticky top-0 z-20 hidden lg:grid lg:grid-cols-[1fr_auto_1fr] h-14 sm:h-16 lg:h-18 px-4 sm:px-6 lg:px-8 py-2 lg:py-3 app-header items-center justify-center gap-3 sm:gap-4 select-none">

      {/* Left Slot: Balanced 1fr space on desktop */}
      <div className="hidden lg:flex items-center justify-start min-w-0" />

      {/* Center Slot: Perfectly Centered Search Input Container (Hidden on /soundcloud) */}
      {!isSoundCloudPage ? (
        <div className="relative w-full min-w-0 sm:min-w-[360px] md:min-w-[420px] lg:min-w-[480px] xl:min-w-[540px] max-w-xl mx-auto my-auto" ref={dropdownRef}>
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none z-10" />
            <input
              type="text"
              value={inputQuery}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                const nextValue = e.target.value
                setInputQuery(nextValue)
                setSuggestionQuery(nextValue)
                setShowDropdown(Boolean(nextValue.trim()))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleClearSearch()
                if (shouldCommitGlobalSearch(inputQuery, e.key)) handleSubmitSearch()
              }}
              onFocus={() => {
                if (inputQuery.trim()) setShowDropdown(true)
              }}
              placeholder="Tìm bài hát, nghệ sĩ..."
              className="search-input w-full pl-9 sm:pl-10 pr-8 sm:pr-9 py-1.5 sm:py-2 text-xs text-white placeholder-slate-400 outline-none"
            />
            {searchingSuggestions ? (
              <Loader2 className="w-3.5 h-3.5 text-[var(--spotify-glow,#22d3ee)] animate-spin absolute right-3 z-10" />
            ) : searchQuery ? (
              <button
                onClick={handleClearSearch}
                className="absolute right-3 p-0.5 text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-colors z-10"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : null}
          </div>

          {/* Suggestions Dropdown Popup — Elevation Level 3 */}
          {showDropdown && (
            <div className="search-dropdown-glass absolute top-full left-0 right-0 mt-2 bg-[var(--elevation-3-bg,#0d111a)]/95 border border-white/10 rounded-2xl shadow-2xl z-40 overflow-hidden backdrop-blur-2xl">
              <div className="p-2 max-h-80 overflow-y-auto flex flex-col gap-1 custom-slim-scrollbar">
                {searchingSuggestions && suggestions.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--spotify-glow,#22d3ee)]" />
                    <span>Đang tìm kiếm...</span>
                  </div>
                ) : suggestions.length > 0 ? (
                  <>
                    <p className="text-[10px] font-mono text-slate-400 uppercase tracking-wider px-3 py-1.5">
                      Gợi ý nhanh
                    </p>
                    {suggestions.map((track) => (
                      <div
                        key={track.id}
                        onClick={() => {
                          playSearchTrack(track)
                          setShowDropdown(false)
                        }}
                        className="flex items-center gap-3 p-2 hover:bg-white/5 rounded-xl cursor-pointer transition-colors group"
                      >
                        <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 relative bg-slate-800 border border-white/10">
                          <TrackCoverImage src={track.cover_url} alt={track.title} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-white group-hover:text-[var(--spotify-glow)] truncate transition-colors">
                            {track.title}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            {track.artist}
                          </p>
                        </div>
                        <div className="w-7 h-7 rounded-full bg-white/5 group-hover:bg-[var(--primary-spotify)] text-slate-400 group-hover:text-black flex items-center justify-center shrink-0 transition-colors">
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={handleSubmitSearch}
                      className="mt-1 p-2 text-xs font-semibold text-[var(--spotify-glow,#22d3ee)] hover:text-white bg-white/[0.03] hover:bg-white/[0.08] rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-white/[0.06]"
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>Xem tất cả kết quả cho &quot;{inputQuery.trim()}&quot;</span>
                    </button>
                  </>
                ) : (
                  <div className="p-4 text-center text-xs text-slate-400">
                    Không tìm thấy kết quả phù hợp cho &quot;{inputQuery || searchQuery}&quot;
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="w-full flex-1 max-w-xl min-h-[36px]" />
      )}

      {/* Right Slot: User Actions (Aligned to Right inside its 1fr column, hidden on mobile) */}
      <div className="hidden lg:flex items-center justify-end gap-2 my-auto shrink-0 relative">
        {user ? (
          <div className="relative">
            <button
              ref={profileTriggerRef}
              type="button"
              onClick={() => setIsProfileMenuOpen(shouldToggleProfileMenu(isProfileMenuOpen))}
              aria-expanded={isProfileMenuOpen}
              aria-controls="topbar-profile-menu"
              aria-label="Mở menu tài khoản"
              className="sidebar-logo-plaque flex items-center gap-2.5 min-h-11 px-2.5 py-1 rounded-full group active:scale-[0.98] transition-all cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full bg-[var(--primary-spotify,#06b6d4)] text-black border border-white/20 flex items-center justify-center font-bold text-sm shrink-0 overflow-hidden shadow-sm">
                {user.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt={user.email}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <span>{(user.user_metadata?.full_name || user.email || 'U').charAt(0).toUpperCase()}</span>
                )}
              </div>
              <div className="hidden sm:flex flex-col text-left min-w-0 pr-1">
                <span className="text-xs font-bold text-white truncate max-w-[140px]">
                  {user.user_metadata?.full_name || user.email?.split('@')[0]}
                </span>
                {isAdmin(user?.email) && (
                  <span className="text-[10px] font-mono text-[var(--spotify-glow,#22d3ee)] leading-none mt-0.5">
                    Admin
                  </span>
                )}
              </div>
            </button>
            {isProfileMenuOpen && (
              <div
                ref={profileMenuRef}
                id="topbar-profile-menu"
                role="menu"
                className="absolute right-0 top-full mt-2 w-60 rounded-2xl border border-white/[0.14] bg-[var(--elevation-3-bg,#111827)]/95 p-2 shadow-2xl backdrop-blur-xl z-50"
              >
                <div className="px-3 py-2 border-b border-white/[0.08]">
                  <p className="text-sm font-bold text-white truncate">
                    {user.user_metadata?.full_name || user.email?.split('@')[0]}
                  </p>
                  <p className="text-[11px] text-slate-300 truncate mt-0.5">{user.email}</p>
                  {isAdmin(user.email) && (
                    <p className="text-[10px] font-mono text-[var(--spotify-glow,#22d3ee)] mt-1">
                      Admin
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  className="w-full min-h-11 mt-1 flex items-center gap-2 rounded-xl px-3 text-sm font-semibold text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 transition-colors"
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
            className="sidebar-logo-plaque text-xs font-bold text-white px-4 py-2 rounded-full transition-all cursor-pointer"
          >
            Đăng nhập
          </Link>
        )}
      </div>
    </header>
  )
}
