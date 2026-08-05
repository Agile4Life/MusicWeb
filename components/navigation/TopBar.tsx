'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search, X, Music, Play, Upload, User, Loader2 } from 'lucide-react'
import { AppLogoIcon } from '@/components/ui/AppLogoIcon'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { useSession } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export function TopBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { playTrack } = usePlayer()
  const { data: nextAuthSession } = useSession()
  const supabase = createClient()

  const [query, setQuery] = useState('')
  const [supabaseUser, setSupabaseUser] = useState<any>(null)
  const [suggestions, setSuggestions] = useState<Track[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)

  const dropdownRef = useRef<HTMLDivElement>(null)

  const user =
    supabaseUser ||
    (nextAuthSession?.user
      ? {
          id: nextAuthSession.user.email,
          email: nextAuthSession.user.email,
          user_metadata: {
            full_name: nextAuthSession.user.name,
            avatar_url: nextAuthSession.user.image,
          },
        }
      : null)

  useEffect(() => {
    supabase.auth.getUser().then((res: any) => setSupabaseUser(res?.data?.user))
  }, [supabase])

  // Clear old search from URL on fresh page reload/mount
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('q=')) {
      const url = new URL(window.location.href)
      url.searchParams.delete('q')
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''))
    }
    setQuery('')
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Fast debounced instant suggestions dropdown
  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([])
      setLoadingSuggestions(false)
      setShowDropdown(false)
      return
    }

    setLoadingSuggestions(true)
    setShowDropdown(true)

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        if (res.ok) {
          const data = await res.json()
          const combined = [
            ...(data.spotify || []),
            ...(data.local || []),
            ...(data.itunes || []),
            ...(data.youtube || []),
            ...(data.audius || []),
          ]
          setSuggestions(combined.slice(0, 6))
        }
      } catch (err) {
        console.warn('TopBar search error:', err)
      } finally {
        setLoadingSuggestions(false)
      }
    }, 180)

    return () => clearTimeout(timer)
  }, [query])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)

    if (pathname === '/') {
      const params = new URLSearchParams(window.location.search)
      if (val.trim()) params.set('q', val)
      else params.delete('q')
      const newUrl = `/${params.toString() ? `?${params.toString()}` : ''}`
      window.history.replaceState({}, '', newUrl)
      window.dispatchEvent(new CustomEvent('musicweb-search', { detail: val }))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setShowDropdown(false)
      if (pathname !== '/') {
        router.push(`/?q=${encodeURIComponent(query.trim())}`)
      }
    }
  }

  const handleClear = () => {
    setQuery('')
    setSuggestions([])
    setShowDropdown(false)
    if (pathname === '/') {
      const params = new URLSearchParams(window.location.search)
      params.delete('q')
      const newUrl = `/${params.toString() ? `?${params.toString()}` : ''}`
      window.history.replaceState({}, '', newUrl)
      window.dispatchEvent(new CustomEvent('musicweb-search', { detail: '' }))
    }
  }

  const handleSelectTrack = (track: Track) => {
    setShowDropdown(false)
    playTrack(track, suggestions)
  }

  return (
    <header className="sticky top-0 z-30 bg-[#090b12]/95 backdrop-blur-2xl border-b border-white/10 px-4 md:px-8 py-3 flex items-center justify-between gap-4">
      {/* Left Slot: Symmetrical balance spacer */}
      <div className="hidden lg:block w-48 shrink-0" />

      {/* Center Slot: Perfectly Centered Prominent Search Box */}
      <div className="relative flex-1 max-w-2xl mx-auto" ref={dropdownRef}>
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-slate-400 absolute left-4 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suggestions.length > 0) setShowDropdown(true)
            }}
            placeholder="Tìm nhạc toàn thế giới (iTunes, YouTube, Audius, Thư viện)..."
            className="w-full bg-white/5 border border-white/15 focus:border-[var(--primary-spotify)] text-white text-xs md:text-sm rounded-full pl-11 pr-10 py-2.5 outline-none transition-all placeholder:text-slate-500 shadow-inner hover:bg-white/10"
          />

          {loadingSuggestions ? (
            <Loader2 className="w-4 h-4 text-cyan-400 animate-spin absolute right-3.5" />
          ) : query ? (
            <button
              onClick={handleClear}
              className="absolute right-3.5 text-slate-400 hover:text-white p-0.5 rounded-full transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}
        </div>

        {/* Search Dropdown Overlay */}
        {showDropdown && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-[#121522]/95 border border-white/15 rounded-2xl shadow-2xl backdrop-blur-2xl overflow-hidden z-50 flex flex-col divide-y divide-white/5 animate-in fade-in slide-in-from-top-2 duration-150">
            <div className="px-4 py-2 bg-white/5 text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Gợi ý kết quả hàng đầu ({suggestions.length})</span>
              <span className="text-[9px] text-slate-500">Bấm Enter để xem tất cả</span>
            </div>

            {suggestions.map((track) => (
              <div
                key={track.id}
                onClick={() => handleSelectTrack(track)}
                className="px-4 py-2.5 flex items-center justify-between gap-3 hover:bg-white/10 cursor-pointer group transition-colors"
              >
                <div className="flex items-center gap-3 truncate min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-slate-800 shrink-0 overflow-hidden border border-white/10 relative flex items-center justify-center">
                    {track.cover_url ? (
                      <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-4 h-4 text-slate-500" />
                    )}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Play className="w-3.5 h-3.5 text-white fill-current" />
                    </div>
                  </div>

                  <div className="truncate flex flex-col min-w-0">
                    <p className="text-xs font-bold text-white group-hover:text-[var(--primary-spotify)] transition-colors truncate">
                      {track.title}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">
                      {track.artist || 'Nghệ sĩ chưa xác định'}
                    </p>
                  </div>
                </div>

                {/* Source Badges */}
                <div className="shrink-0">
                  {track.source === 'itunes' && (
                    <span className="text-[8px] font-bold uppercase tracking-wider bg-pink-500/20 text-pink-300 border border-pink-500/30 px-1.5 py-0.5 rounded">
                      iTunes
                    </span>
                  )}
                  {track.source === 'youtube' && (
                    <span className="text-[8px] font-bold uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded">
                      YouTube
                    </span>
                  )}
                  {track.source === 'audius' && (
                    <span className="text-[8px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded">
                      Audius
                    </span>
                  )}
                  {(!track.source || track.source === 'local') && (
                    <span className="text-[8px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">
                      Thư viện
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right Slot: User Avatar & Quick Actions */}
      <div className="flex items-center justify-end gap-3 lg:w-48 shrink-0">
        <Link
          href="/upload"
          className="hidden sm:flex items-center gap-1.5 bg-white/10 hover:bg-white/15 border border-white/10 text-white font-bold px-3.5 py-2 rounded-full text-xs transition-all shrink-0"
        >
          <Upload className="w-3.5 h-3.5 text-[var(--primary-spotify)]" />
          <span>Upload Nhạc</span>
        </Link>

        {user && (
          <Link
            href="/settings"
            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 p-1 sm:px-3 sm:py-1 rounded-full transition-all shrink-0 group"
          >
            <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-400 via-teal-400 to-blue-600 p-0.5 shadow-md shadow-cyan-500/20 flex items-center justify-center overflow-hidden shrink-0 group-hover:scale-105 transition-transform">
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Avatar"
                  className="w-full h-full object-cover rounded-full"
                />
              ) : (
                <div className="w-full h-full bg-[#080c14] rounded-full flex items-center justify-center text-cyan-300 font-extrabold text-xs">
                  {(user.user_metadata?.full_name || user.email || 'M').charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <span className="hidden md:inline-block text-xs font-bold text-white max-w-[110px] truncate">
              {user.user_metadata?.full_name || user.email?.split('@')[0]}
            </span>
          </Link>
        )}
      </div>
    </header>
  )
}
