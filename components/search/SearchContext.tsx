'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { fetchUnifiedSearch, GlobalSearchTracks } from '@/lib/searchApi'
import { searchNhacCuaTui } from '@/lib/nhaccuatuiClient'
import { nhacCuaTuiSearchItemToTrack } from '@/lib/nhaccuatui'
import { combineCombinedSearchResults } from '@/lib/searchFlow'

interface SearchContextType {
  searchQuery: string
  setSearchQuery: (query: string) => void
  globalTracks: GlobalSearchTracks
  searchingGlobal: boolean
  trendingTracks: GlobalSearchTracks
  loadingTrending: boolean
  clearSearch: () => void
}

const emptyResults: GlobalSearchTracks = {
  nhaccuatui: [],
  local: [],
  youtube: [],
  audius: [],
  itunes: [],
  spotify: [],
  deezer: [],
}

const SearchContext = createContext<SearchContextType | undefined>(undefined)

export function SearchProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [globalTracks, setGlobalTracks] = useState<GlobalSearchTracks>(emptyResults)
  const [searchingGlobal, setSearchingGlobal] = useState(false)
  const [trendingTracks, setTrendingTracks] = useState<GlobalSearchTracks>(emptyResults)
  const [loadingTrending, setLoadingTrending] = useState(true)

  const activeSearchRef = useRef<number>(0)

  // Fetch Trending Tracks once on initial mount
  useEffect(() => {
    let active = true
    setLoadingTrending(true)

    fetchUnifiedSearch('', 'all', true)
      .then((data) => {
        if (active) {
          setTrendingTracks(data)
        }
      })
      .finally(() => {
        if (active) setLoadingTrending(false)
      })

    return () => {
      active = false
    }
  }, [])

  // Single centralized debounced search effect
  useEffect(() => {
    const trimmed = searchQuery.trim()
    if (trimmed) {
      setSearchingGlobal(true)
    }

    const currentSearchId = ++activeSearchRef.current

    const timer = setTimeout(async () => {
      if (!trimmed) {
        // Debounce the empty state too: transient intermediate "" values (e.g. IME
        // reverting a lone tone-mark key like "s") must not clear the results.
        setGlobalTracks(emptyResults)
        setSearchingGlobal(false)
        return
      }
      try {
        // Combine NhacCuaTui + Spotify + Deezer in parallel, dedupe duplicates
        const [nctItems, spotifyData, deezerData] = await Promise.all([
          searchNhacCuaTui(trimmed),
          fetchUnifiedSearch(trimmed, 'spotify', false),
          fetchUnifiedSearch(trimmed, 'deezer', false),
        ])

        const data = combineCombinedSearchResults(
          nctItems.map(nhacCuaTuiSearchItemToTrack),
          spotifyData.spotify,
          deezerData.deezer,
        )

        if (data.nhaccuatui.length + data.spotify.length + data.deezer.length === 0) {
          // All 3 sources empty -> final YouTube fallback
          const youtubeData = await fetchUnifiedSearch(trimmed, 'youtube', false)
          data.youtube = youtubeData.youtube
        }

        if (activeSearchRef.current === currentSearchId) {
          setGlobalTracks(data)
        }
      } catch (err) {
        if (activeSearchRef.current === currentSearchId) {
          setGlobalTracks(emptyResults)
        }
      } finally {
        if (activeSearchRef.current === currentSearchId) {
          setSearchingGlobal(false)
        }
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [searchQuery])

  const clearSearch = useCallback(() => {
    setSearchQuery('')
    setGlobalTracks(emptyResults)
    setSearchingGlobal(false)
  }, [])

  const value = useMemo(
    () => ({
      searchQuery,
      setSearchQuery,
      globalTracks,
      searchingGlobal,
      trendingTracks,
      loadingTrending,
      clearSearch,
    }),
    [searchQuery, globalTracks, searchingGlobal, trendingTracks, loadingTrending, clearSearch]
  )

  return (
    <SearchContext.Provider value={value}>
      {children}
    </SearchContext.Provider>
  )
}

export function useSearch() {
  const context = useContext(SearchContext)
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider')
  }
  return context
}
