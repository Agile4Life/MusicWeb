'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Search, X, Music, Play, Upload, User, Loader2 } from 'lucide-react'
import { Track } from '@/types'
import { usePlayer } from '@/components/player/PlayerContext'
import { useSession } from 'next-auth/react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export function TopBar() {
  const router = useRouter()
  const pathname = usePathname()
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

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('q=')) {
      const url = new URL(window.location.href)
      url.searchParams.delete('q')
      window.history.replaceState({}, '', url.pathname + (url.search ? url.search : ''))
    }
    setQuery('')
  }, [])

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
    if (!query.trim()) {
      setSuggestions([])
      setLoadingSuggestions(false)
      setShowDropdown(false)
      window.dispatchEvent(new CustomEvent('musicweb-search', { detail: '' }))
      return
    }

    setLoadingSuggestions(true)
    setShowDropdown(true)
    window.dispatchEvent(new CustomEvent('musicweb-search', { detail: query.trim() }))

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

  const handleClearSearch = () => {
    setQuery('')
    setSuggestions([])
    setShowDropdown(false)
    window.dispatchEvent(new CustomEvent('musicweb-search', { detail: '' }))
  }

  return (
    <header className="sticky top-0 z-20 h-16 md:h-20 px-4 md:px-8 bg-[#10131c]/80 backdrop-blur-xl border-b border-white/[0.05] flex items-center justify-between gap-4 select-none">
      {/* Left Slot: Spacer balancing right side so search is centered */}
      <div className="w-36 md:w-48 shrink-0 hidden sm:block" />

      {/* Center Slot: Perfectly Centered Search Input Container */}
      <div className="relative flex-1 max-w-xl mx-auto" ref={dropdownRef}>
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              if (query.trim()) setShowDropdown(true)
            }}
            placeholder="Tìm bài hát, nghệ sĩ từ Spotify, YouTube, Drive..."
            className="w-full bg-white/[0.04] border border-white/[0.07] focus:border-[var(--primary-spotify,#06b6d4)]/50 focus:bg-white/[0.06] rounded-full pl-10 pr-9 py-2 text-xs text-white placeholder-slate-400 outline-none transition-all shadow-inner"
          />
          {loadingSuggestions ? (
            <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin absolute right-3" />
          ) : query ? (
            <button
              onClick={handleClearSearch}
              className="p-1 text-slate-400 hover:text-white absolute right-2.5 rounded-full"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>

        {/* Suggestions Dropdown Popup */}
        {showDropdown && (
          <div className="absolute top-full left-0 right-0 mt-2 bg-[#0d1017] border border-white/10 rounded-2xl p-2 shadow-2xl z-50 flex flex-col gap-1 max-h-80 overflow-y-auto">
            {loadingSuggestions && suggestions.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
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
                      playTrack(track, suggestions)
                      setShowDropdown(false)
                    }}
                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.06] cursor-pointer transition-colors group"
                  >
                    <div className="w-9 h-9 rounded-lg bg-slate-800 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                      {track.cover_url ? (
                        <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
                      ) : (
                        <Music className="w-4 h-4 text-slate-400" />
                      )}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <p className="text-xs font-bold text-white group-hover:text-cyan-300 truncate">
                        {track.title}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {track.artist || 'Nghệ sĩ chưa xác định'}
                      </p>
                    </div>
                    <div className="w-7 h-7 rounded-full bg-white/5 group-hover:bg-cyan-500 text-slate-400 group-hover:text-black flex items-center justify-center shrink-0 transition-colors">
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="p-4 text-center text-xs text-slate-400">
                Không tìm thấy kết quả phù hợp cho &quot;{query}&quot;
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Slot: User Actions */}
      <div className="w-36 md:w-48 shrink-0 flex items-center justify-end gap-3">
        {user ? (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-white/10 border border-white/10 flex items-center justify-center text-[var(--primary-spotify,#06b6d4)] font-bold text-xs">
              {user.user_metadata?.avatar_url ? (
                <img
                  src={user.user_metadata.avatar_url}
                  alt={user.email}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <User className="w-4 h-4" />
              )}
            </div>
            <span className="hidden sm:inline text-xs font-bold text-white truncate max-w-[120px]">
              {user.user_metadata?.full_name || user.email?.split('@')[0]}
            </span>
          </div>
        ) : (
          <Link
            href="/login"
            className="text-xs font-bold text-black bg-white hover:bg-slate-200 px-4 py-1.5 rounded-full transition-colors"
          >
            Đăng nhập
          </Link>
        )}
      </div>
    </header>
  )
}
