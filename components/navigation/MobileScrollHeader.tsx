'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Search,
  X,
  Play,
  Loader2,
  ChevronLeft,
  Menu,
  Mic,
} from 'lucide-react'
import { Track } from '@/types'
import { usePlayerControls } from '@/components/player/PlayerContext'
import { useSearch } from '@/components/search/SearchContext'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { useScrollContext } from '@/components/navigation/ScrollContext'
import { useTheme } from '@/components/theme/ThemeContext'
import { flattenUnifiedSearchResults } from '@/lib/searchFlow'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'
import {
  shouldCommitGlobalSearch,
  shouldKeepSearchOpenOnScroll,
  shouldCloseSearchOnOutsideClick,
  shouldRedirectToHomeOnSearch,
} from '@/components/search/searchInteraction'

/** Distance in px before topbar is fully shrunk + search gone */
const COLLAPSE_DISTANCE = 90

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * clamp(t, 0, 1)
}

/**
 * Hook: Continuous scroll-linked progress 0→1
 * Drives DOM refs directly each rAF — no React setState per frame.
 */
function useScrollProgress(
  collapseDistance: number,
  addScrollListener: (fn: (y: number) => void) => () => void,
  onProgress: (p: number) => void,
) {
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const unsub = addScrollListener((y) => {
      const p = prefersReduced
        ? (y >= collapseDistance ? 1 : 0)
        : clamp(y / collapseDistance, 0, 1)
      onProgress(p)
    })
    return unsub
  }, [addScrollListener, collapseDistance, onProgress])
}

/**
 * MobileScrollHeader
 *
 * Layout:
 *   ┌─────────────────────────────────────┐
 *   │  [←][☰]      MuSic       [🔍]      │  ← Topbar pill (shrinks on scroll)
 *   └─────────────────────────────────────┘
 *   ┌─────────────────────────────────────┐
 *   │  🔍  Tìm bài hát, nghệ sĩ...        │  ← Search pill (collapses on scroll)
 *   └─────────────────────────────────────┘
 *
 * On scroll:
 *   - Topbar: side buttons fade + collapse inward → bar shrinks to logo pill
 *   - Search pill: slides up + fades out
 *   - NavBar receives 'mweb:header-progress' event to trigger capsule morph
 */
export function MobileScrollHeader() {
  const { t } = useLanguage()
  const { themeStyle } = useTheme()
  const isMinimalFlat = themeStyle === 'minimal-flat'
  const pathname = usePathname()
  const router = useRouter()
  const { playTrack, playSearchTrack } = usePlayerControls()
  const {
    searchQuery,
    setSearchQuery,
    suggestionQuery,
    suggestionTracks,
    searchingSuggestions,
    setSuggestionQuery,
    clearSearch,
  } = useSearch()
  const { addScrollListener } = useScrollContext()

  const [inputQuery, setInputQuery] = useState(searchQuery)
  const [showDropdown, setShowDropdown] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const isSearchOpenRef = useRef(false)
  const visibilityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressRef = useRef(0)
  const lastDispatchedCollapsed = useRef<boolean | null>(null)

  // DOM refs — animated directly, no React setState per frame
  const topbarRowRef = useRef<HTMLDivElement>(null)   // the whole [☰ Logo 🔍] row
  const leftButtonsRef = useRef<HTMLDivElement>(null)
  const rightButtonRef = useRef<HTMLDivElement>(null)
  const searchRowRef = useRef<HTMLDivElement>(null)

  const suggestions: Track[] = React.useMemo(
    () => flattenUnifiedSearchResults(suggestionTracks, suggestionQuery || inputQuery).slice(0, 6),
    [suggestionTracks, suggestionQuery, inputQuery],
  )

  const searchInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const navBackBusyRef = useRef(false)

  useEffect(() => { setInputQuery(searchQuery) }, [searchQuery])

  // ─── Core animation driver ───────────────────────────────────────────────
  const applyProgress = useCallback((p: number) => {
    progressRef.current = p

    // If search was explicitly opened by user, maintain search bar visibility and topbar hidden
    if (isSearchOpenRef.current) {
      const isCollapsed = p >= 0.7
      const isExpanded = p <= 0.15
      if (isCollapsed && lastDispatchedCollapsed.current !== true) {
        lastDispatchedCollapsed.current = true
        window.dispatchEvent(new CustomEvent('mweb:header-progress', { detail: { progress: 1, collapsed: true } }))
      } else if (isExpanded && lastDispatchedCollapsed.current !== false) {
        lastDispatchedCollapsed.current = false
        window.dispatchEvent(new CustomEvent('mweb:header-progress', { detail: { progress: 0, collapsed: false } }))
      }
      return
    }

    // 1. Topbar row (logo + buttons): fades out as scroll starts
    //    Position absolute to overlay with search row — zero layout shift
    const row = topbarRowRef.current
    if (row) {
      const qFade = clamp(p / 0.5, 0, 1)  // opacity 1→0 in first 50%
      row.style.opacity = String(1 - qFade)
      row.style.pointerEvents = qFade > 0.7 ? 'none' : 'auto'
      row.style.transform = `translate3d(0, ${-qFade * 8}px, 0) scale(${1 - qFade * 0.04})`
    }

    // 2. Search row: APPEARS on scroll, OVERLAYS topbar row (100% GPU composited)
    const searchRow = searchRowRef.current
    if (searchRow) {
      const q = clamp((p - 0.1) / 0.5, 0, 1)  // 0→1 from p=0.1 to p=0.6
      if (q < 0.01) {
        searchRow.style.opacity = '0'
        searchRow.style.pointerEvents = 'none'
        searchRow.style.visibility = 'hidden'
      } else {
        searchRow.style.visibility = 'visible'
        searchRow.style.opacity = String(q)
        searchRow.style.transform = `translate3d(0, ${(1 - q) * 8}px, 0) scale(${0.96 + q * 0.04})`
        searchRow.style.pointerEvents = q < 0.3 ? 'none' : 'auto'
      }
    }

    // 3. NavBar capsule trigger
    const isCollapsed = p >= 0.7
    const isExpanded = p <= 0.15
    if (isCollapsed && lastDispatchedCollapsed.current !== true) {
      lastDispatchedCollapsed.current = true
      window.dispatchEvent(new CustomEvent('mweb:header-progress', { detail: { progress: 1, collapsed: true } }))
    } else if (isExpanded && lastDispatchedCollapsed.current !== false) {
      lastDispatchedCollapsed.current = false
      window.dispatchEvent(new CustomEvent('mweb:header-progress', { detail: { progress: 0, collapsed: false } }))
    }
  }, [])

  useScrollProgress(COLLAPSE_DISTANCE, addScrollListener, applyProgress)

  const openSearch = useCallback(() => {
    if (visibilityTimeoutRef.current) {
      clearTimeout(visibilityTimeoutRef.current)
      visibilityTimeoutRef.current = null
    }
    setIsSearchOpen(true)
    isSearchOpenRef.current = true

    // Animate topbar out
    const row = topbarRowRef.current
    if (row) {
      row.style.opacity = '0'
      row.style.pointerEvents = 'none'
      row.style.transform = 'translate3d(0, -8px, 0) scale(0.96)'
    }

    // Animate search row in
    const searchRow = searchRowRef.current
    if (searchRow) {
      searchRow.style.visibility = 'visible'
      searchRow.style.opacity = '1'
      searchRow.style.pointerEvents = 'auto'
      searchRow.style.transform = 'translate3d(0, 0, 0) scale(1)'
    }

    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
  }, [])

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false)
    isSearchOpenRef.current = false
    setShowDropdown(false)
    searchInputRef.current?.blur()

    const p = progressRef.current
    const row = topbarRowRef.current
    if (row) {
      const qFade = clamp(p / 0.5, 0, 1)
      row.style.opacity = String(1 - qFade)
      row.style.pointerEvents = qFade > 0.7 ? 'none' : 'auto'
      row.style.transform = `translate3d(0, ${-qFade * 8}px, 0) scale(${1 - qFade * 0.04})`
    }

    const searchRow = searchRowRef.current
    if (searchRow) {
      const q = clamp((p - 0.1) / 0.5, 0, 1)
      if (q < 0.01) {
        searchRow.style.opacity = '0'
        searchRow.style.pointerEvents = 'none'
        searchRow.style.transform = 'translate3d(0, 8px, 0) scale(0.96)'
        if (visibilityTimeoutRef.current) clearTimeout(visibilityTimeoutRef.current)
        visibilityTimeoutRef.current = setTimeout(() => {
          if (!isSearchOpenRef.current && progressRef.current < 0.01 && searchRowRef.current) {
            searchRowRef.current.style.visibility = 'hidden'
          }
        }, 260)
      } else {
        searchRow.style.visibility = 'visible'
        searchRow.style.opacity = String(q)
        searchRow.style.transform = `translate3d(0, ${(1 - q) * 8}px, 0) scale(${0.96 + q * 0.04})`
        searchRow.style.pointerEvents = q < 0.3 ? 'none' : 'auto'
      }
    }
  }, [])

  // Listen for global open search request (e.g. from LiquidNavBar capsule)
  useEffect(() => {
    const handleOpenSearchEvent = () => openSearch()
    window.addEventListener('musicweb-open-search', handleOpenSearchEvent)
    return () => window.removeEventListener('musicweb-open-search', handleOpenSearchEvent)
  }, [openSearch])

  // Click outside dropdown / search bar
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setShowDropdown(false)
        if (shouldCloseSearchOnOutsideClick(isSearchOpenRef.current, Boolean(inputQuery.trim()), progressRef.current)) {
          closeSearch()
        }
      }
    }
    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('touchstart', handleOutsideClick, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('touchstart', handleOutsideClick)
    }
  }, [closeSearch, inputQuery])

  // Route navigation closes search
  useEffect(() => {
    closeSearch()
  }, [pathname, closeSearch])

  const handleClearSearch = () => {
    clearSearch()
    setInputQuery('')
    setShowDropdown(false)
    if (isSearchOpenRef.current && progressRef.current < 0.2) {
      closeSearch()
    }
  }

  const handleSubmitSearch = () => {
    const trimmed = inputQuery.trim()
    if (!trimmed) return
    setSearchQuery(trimmed)
    setSuggestionQuery('')
    setShowDropdown(false)
    searchInputRef.current?.blur()
    if (shouldRedirectToHomeOnSearch(pathname)) {
      router.push('/')
    }
  }

  const handleSearchIconClick = () => {
    openSearch()
  }

  return (
    /*
     * Header background = same as main content (var(--bg-space, #07090e)).
     * Only the logo pill and search pill are glass surfaces that "float".
     * Buttons are plain icon-only (no glass background).
     */
    <header
      className="mobile-scroll-header lg:hidden sticky top-0 z-30 select-none w-full"
      style={{
        paddingTop: 'calc(8px + env(safe-area-inset-top, 0px))',
        paddingBottom: '8px',
        paddingLeft: '14px',
        paddingRight: '14px',
        height: 'calc(60px + env(safe-area-inset-top, 0px))',
      }}
    >
      {/* ── Topbar row — fades & collapses on scroll, only search remains ── */}
      <div
        ref={topbarRowRef}
        className="flex items-center h-11 relative"
        style={{
          overflow: 'visible',
          transition: 'opacity 240ms cubic-bezier(0.32, 0.72, 0, 1), transform 240ms cubic-bezier(0.32, 0.72, 0, 1)',
        }}
      >
        {/* Left: plain icon buttons (no glass) */}
        <div
          ref={leftButtonsRef}
          className="flex items-center gap-0.5 shrink-0 z-10 pointer-events-auto"
          style={{ willChange: 'opacity, max-width, transform' }}
        >
          {pathname !== '/' && (
            <button
              type="button"
              onClick={() => {
                if (navBackBusyRef.current) return
                navBackBusyRef.current = true
                window.history.length > 1 ? router.back() : router.push('/')
                setTimeout(() => { navBackBusyRef.current = false }, 500)
              }}
              className={`p-2 active:scale-95 transition-all shrink-0 rounded-lg ${
                isMinimalFlat ? 'text-[#B9AC9C] hover:text-[#F4ECE1]' : 'text-white/55 hover:text-white'
              }`}
              title="Quay lại"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('musicweb-toggle-drawer'))}
            className={`p-2 active:scale-95 transition-all shrink-0 rounded-lg ${
              isMinimalFlat ? 'text-[#B9AC9C] hover:text-[#F4ECE1]' : 'text-white/55 hover:text-white'
            }`}
            title="Menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* Center: Logo plaque — floats above the bg */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Link
            href="/"
            onClick={() => {
              clearSearch()
              window.dispatchEvent(new Event('musicweb-tab-home'))
            }}
            className={`pointer-events-auto flex items-center justify-center px-3 py-1.5 group cursor-pointer transition-all active:scale-95 ${
              isMinimalFlat ? 'rounded-[12px]' : 'rounded-[14px]'
            }`}
            style={
              isMinimalFlat
                ? {
                    background: 'rgba(29, 23, 32, 0.92)',
                    border: '1px solid rgba(244, 236, 230, 0.12)',
                    boxShadow: 'none',
                  }
                : {
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.14)',
                    backdropFilter: 'blur(12px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(12px) saturate(160%)',
                  }
            }
            title="MusicWeb"
          >
            <img
              src="/phong-signature.png"
              alt="MusicWeb Logo"
              className="h-6 w-auto object-contain signature-img-invert group-hover:scale-[1.03] transition-transform"
            />
          </Link>
        </div>

        {/* Right: plain search icon (no glass) */}
        <div
          ref={rightButtonRef}
          className="flex items-center shrink-0 z-10 ml-auto pointer-events-auto"
          style={{ willChange: 'opacity, max-width, transform' }}
        >
          <button
            type="button"
            onClick={handleSearchIconClick}
            className="p-2 active:scale-95 transition-all rounded-lg"
            style={
              searchQuery
                ? { color: isMinimalFlat ? '#E8A94F' : 'var(--spotify-glow, #22d3ee)' }
                : { color: isMinimalFlat ? '#B9AC9C' : 'rgba(255,255,255,0.55)' }
            }
            title="Tìm kiếm"
          >
            <Search className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Search pill — hidden at rest, OVERLAYS topbar on scroll ───────────── */}
      <div
        ref={searchRowRef}
        className="absolute left-0 right-0"
        style={{
          top: 'calc(8px + env(safe-area-inset-top, 0px))',
          paddingLeft: 14,
          paddingRight: 14,
          // Start HIDDEN — applyProgress or openSearch will reveal
          opacity: 0,
          visibility: 'hidden',
          transformOrigin: 'top center',
          transform: 'translate3d(0, 8px, 0) scale(0.96)',
          pointerEvents: 'none',
          zIndex: 20,
          transition: 'opacity 260ms cubic-bezier(0.16, 1, 0.3, 1), transform 260ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div className="relative pointer-events-auto w-full" ref={dropdownRef}>
          {/* Continuous Search Pill: Minimal Editorial vs Frosted Glass recipe */}
          <div
            className={`relative flex items-center h-[50px] overflow-hidden select-none ${
              isMinimalFlat ? 'rounded-[16px]' : 'rounded-[37px]'
            }`}
            style={
              isMinimalFlat
                ? {
                    background: '#1D1720',
                    border: isSearchOpen
                      ? '1px solid rgba(232, 169, 79, 0.55)'
                      : '1px solid rgba(244, 236, 230, 0.16)',
                    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.55)',
                  }
                : {
                    /* Frosted Liquid Glass Recipe */
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.04) 40%, rgba(13, 17, 26, 0.72) 100%)',
                    backdropFilter: 'blur(32px) saturate(210%) brightness(1.08)',
                    WebkitBackdropFilter: 'blur(32px) saturate(210%) brightness(1.08)',
                    border: '1px solid rgba(255, 255, 255, 0.22)',
                    borderTopColor: 'rgba(255, 255, 255, 0.22)',
                    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 0 25px -4px var(--theme-glow-shadow, rgba(34, 211, 238, 0.15))',
                  }
            }
          >
            {/* Top specular highlight arc (Glass mode only) */}
            {!isMinimalFlat && (
              <>
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 20,
                    right: 20,
                    height: '1px',
                    background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 25%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.45) 75%, transparent 100%)',
                    borderRadius: '50%',
                    pointerEvents: 'none',
                    zIndex: 10,
                  }}
                />

                {/* Inner glass specular gradient */}
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 37,
                    background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.10) 0%, rgba(255, 255, 255, 0.02) 25%, transparent 50%)',
                    pointerEvents: 'none',
                  }}
                />
              </>
            )}

            {isSearchOpen ? (
              <button
                type="button"
                onClick={closeSearch}
                className={`absolute left-3 p-1.5 active:scale-90 rounded-full transition-all z-20 cursor-pointer ${
                  isMinimalFlat
                    ? 'text-[#B9AC9C] hover:text-[#F4ECE1] hover:bg-[#251E29]'
                    : 'text-white/70 hover:text-white hover:bg-white/10'
                }`}
                title="Đóng tìm kiếm"
                aria-label="Đóng tìm kiếm"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            ) : (
              <Search
                className={`w-4 h-4 absolute left-4 pointer-events-none z-10 ${
                  isMinimalFlat ? 'text-[#8B8090]' : 'text-white/60'
                }`}
              />
            )}

            <input
              ref={searchInputRef}
              type="text"
              value={inputQuery}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                const v = e.target.value
                setInputQuery(v)
                setSuggestionQuery(v)
                setShowDropdown(Boolean(v.trim()))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  handleClearSearch()
                  closeSearch()
                }
                if (shouldCommitGlobalSearch(inputQuery, e.key)) handleSubmitSearch()
              }}
              onFocus={() => {
                setIsSearchOpen(true)
                isSearchOpenRef.current = true
                if (inputQuery.trim()) setShowDropdown(true)
              }}
              placeholder="Tìm bài hát, nghệ sĩ, lời bài hát..."
              className={`w-full h-full pl-11 pr-11 text-[16px] sm:text-sm outline-none bg-transparent relative z-10 border-none shadow-none focus:outline-none focus:ring-0 ${
                isMinimalFlat ? 'text-[#F4ECE1] placeholder-[#8B8090]' : 'text-white placeholder-white/50'
              }`}
              style={{
                border: 'none',
                background: 'transparent',
                boxShadow: 'none',
                borderRadius: 0,
                outline: 'none',
              }}
            />

            {searchingSuggestions ? (
              <Loader2
                className={`w-4 h-4 animate-spin absolute right-4 z-10 ${
                  isMinimalFlat ? 'text-[#E8A94F]' : 'text-[var(--spotify-glow,#22d3ee)]'
                }`}
              />
            ) : inputQuery ? (
              <button
                type="button"
                onClick={handleClearSearch}
                className={`absolute right-3.5 p-1 rounded-full transition-colors z-10 active:scale-90 cursor-pointer ${
                  isMinimalFlat
                    ? 'text-[#8B8090] hover:text-[#F4ECE1] hover:bg-[#251E29]'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
                title="Xóa tìm kiếm"
                aria-label="Xóa tìm kiếm"
              >
                <X className="w-4 h-4" />
              </button>
            ) : isSearchOpen ? (
              <button
                type="button"
                onClick={closeSearch}
                className={`absolute right-3.5 p-1 rounded-full transition-colors z-10 active:scale-90 cursor-pointer ${
                  isMinimalFlat
                    ? 'text-[#8B8090] hover:text-[#F4ECE1] hover:bg-[#251E29]'
                    : 'text-slate-400 hover:text-white hover:bg-white/10'
                }`}
                title="Đóng tìm kiếm"
                aria-label="Đóng tìm kiếm"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <Mic
                className={`w-4 h-4 absolute right-4 pointer-events-none z-10 ${
                  isMinimalFlat ? 'text-[#8B8090]/75' : 'text-white/40'
                }`}
              />
            )}
          </div>

          {/* Autocomplete dropdown */}
          {showDropdown && (
            <div
              className={`absolute top-full left-0 right-0 mt-2 shadow-2xl z-50 overflow-hidden ${
                isMinimalFlat ? 'rounded-[16px]' : 'rounded-2xl'
              }`}
              style={
                isMinimalFlat
                  ? {
                      background: '#1D1720',
                      border: '1px solid rgba(244, 236, 230, 0.16)',
                      boxShadow: '0 18px 42px rgba(0, 0, 0, 0.65)',
                    }
                  : {
                      /* Liquid glass dropdown */
                      background: 'linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 40%, hsla(var(--base-h, 224), var(--base-s, 45%), 12%, 0.45) 100%)',
                      backdropFilter: 'blur(40px) saturate(220%) brightness(1.08)',
                      WebkitBackdropFilter: 'blur(40px) saturate(220%) brightness(1.08)',
                      border: '1px solid rgba(255,255,255,0.25)',
                      borderTopColor: 'rgba(255,255,255,0.25)',
                      boxShadow: '0 20px 50px -10px rgba(0,0,0,0.6), 0 0 40px -4px var(--theme-glow-shadow, rgba(34,211,238,0.2)), inset 0 1px 0 rgba(255,255,255,0.30)',
                    }
              }
            >
              <div className="p-2 max-h-72 overflow-y-auto flex flex-col gap-1 custom-slim-scrollbar">
                {searchingSuggestions && suggestions.length === 0 ? (
                  <div
                    className={`p-4 text-center text-xs flex items-center justify-center gap-2 ${
                      isMinimalFlat ? 'text-[#B9AC9C]' : 'text-slate-400'
                    }`}
                  >
                    <Loader2
                      className={`w-4 h-4 animate-spin ${
                        isMinimalFlat ? 'text-[#E8A94F]' : 'text-[var(--spotify-glow,#22d3ee)]'
                      }`}
                    />
                    <span>Đang tìm kiếm...</span>
                  </div>
                ) : suggestions.length > 0 ? (
                  <>
                    <p
                      className={`text-[10px] font-mono uppercase tracking-wider px-3 py-1 ${
                        isMinimalFlat ? 'text-[#8B8090]' : 'text-slate-400'
                      }`}
                    >
                      Gợi ý nhanh
                    </p>
                    {suggestions.map((track) => (
                      <div
                        key={track.id}
                        onClick={() => {
                          playSearchTrack(track)
                          setShowDropdown(false)
                          closeSearch()
                        }}
                        className={`flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors group ${
                          isMinimalFlat ? 'hover:bg-[#251E29]' : 'hover:bg-white/10'
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-lg overflow-hidden shrink-0 relative ${
                            isMinimalFlat
                              ? 'bg-[#251E29] border border-[rgba(244,236,230,0.1)]'
                              : 'bg-slate-800 border border-white/10'
                          }`}
                        >
                          <TrackCoverImage src={track.cover_url} alt={track.title} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-xs font-bold truncate transition-colors ${
                              isMinimalFlat
                                ? 'text-[#F4ECE1] group-hover:text-[#E8A94F]'
                                : 'text-white group-hover:text-[var(--spotify-glow)]'
                            }`}
                          >
                            {track.title}
                          </p>
                          <p
                            className={`text-[11px] truncate mt-0.5 ${
                              isMinimalFlat ? 'text-[#B9AC9C]' : 'text-slate-400'
                            }`}
                          >
                            {track.artist}
                          </p>
                        </div>
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                            isMinimalFlat
                              ? 'bg-[#251E29] text-[#E8A94F] group-hover:bg-[#E8A94F] group-hover:text-[#141017]'
                              : 'bg-white/5 group-hover:bg-[var(--primary-spotify)] text-slate-400 group-hover:text-black'
                          }`}
                        >
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={handleSubmitSearch}
                      className={`mt-1 p-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer border ${
                        isMinimalFlat
                          ? 'text-[#E8A94F] bg-[#251E29]/80 hover:bg-[#251E29] border-[rgba(232,169,79,0.28)]'
                          : 'text-[var(--spotify-glow,#22d3ee)] hover:text-white bg-white/[0.03] hover:bg-white/[0.08] border-white/[0.06]'
                      }`}
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>Xem tất cả kết quả cho &quot;{inputQuery.trim()}&quot;</span>
                    </button>
                  </>
                ) : (
                  <div
                    className={`p-4 text-center text-xs ${
                      isMinimalFlat ? 'text-[#8B8090]' : 'text-slate-400'
                    }`}
                  >
                    Không tìm thấy kết quả phù hợp
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
