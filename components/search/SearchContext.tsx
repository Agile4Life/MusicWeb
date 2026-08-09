'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { fetchUnifiedSearch, GlobalSearchTracks } from '@/lib/searchApi'
import { Track } from '@/types'
import { searchNhacCuaTui } from '@/lib/nhaccuatuiClient'
import { mergePrimarySearchResults } from '@/lib/searchFlow'
import { nhacCuaTuiSearchItemToTrack } from '@/lib/nhaccuatui'

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
    if (!trimmed) {
      setGlobalTracks(emptyResults)
      setSearchingGlobal(false)
      return
    }

    const currentSearchId = ++activeSearchRef.current
    setSearchingGlobal(true)

    const timer = setTimeout(async () => {
      try {
        const [fallbackData, nctItems] = await Promise.all([
          fetchUnifiedSearch(trimmed, 'all', false),
          searchNhacCuaTui(trimmed),
        ])
        const data = mergePrimarySearchResults(
          nctItems.map(nhacCuaTuiSearchItemToTrack),
          fallbackData,
        )
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
