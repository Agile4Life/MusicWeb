'use client'

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { GlobalSearchTracks } from '@/lib/searchApi'
import { createSearchRequests } from '@/lib/search/searchRequests'
import type { SearchService } from '@/lib/search/searchService'
import { createBrowserSearchService } from './searchComposition'

interface SearchContextType {
  searchQuery: string
  setSearchQuery: (query: string) => void
  suggestionQuery: string
  setSuggestionQuery: (query: string) => void
  suggestionTracks: GlobalSearchTracks
  searchingSuggestions: boolean
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
  spotify: [],
  deezer: [],
}

const SearchContext = createContext<SearchContextType | undefined>(undefined)

export function SearchProvider({
  children,
  service,
}: {
  children: React.ReactNode
  service?: SearchService
}) {
  const searchService = useMemo(() => service ?? createBrowserSearchService(), [service])
  const [searchQuery, setSearchQuery] = useState('')
  const [globalTracks, setGlobalTracks] = useState<GlobalSearchTracks>(emptyResults)
  const [searchingGlobal, setSearchingGlobal] = useState(false)
  const [suggestionQuery, setSuggestionQuery] = useState('')
  const [suggestionTracks, setSuggestionTracks] = useState<GlobalSearchTracks>(emptyResults)
  const [searchingSuggestions, setSearchingSuggestions] = useState(false)
  const [trendingTracks, setTrendingTracks] = useState<GlobalSearchTracks>(emptyResults)
  const [loadingTrending, setLoadingTrending] = useState(true)

  const requestsRef = useRef(createSearchRequests())

  // Fetch Trending Tracks once on initial mount
  useEffect(() => {
    const requests = requestsRef.current
    const token = requests.issue('trending')
    queueMicrotask(() => {
      if (requests.isCurrent('trending', token)) {
        setLoadingTrending(true)
      }
    })

    searchService
      .loadTrending()
      .then((data) => {
        if (requests.isCurrent('trending', token)) {
          setTrendingTracks(data)
        }
      })
      .finally(() => {
        if (requests.isCurrent('trending', token)) {
          setLoadingTrending(false)
        }
      })

    return () => {
      requests.invalidate('trending')
    }
  }, [searchService])

  // Global search is committed separately from the text currently being typed.
  useEffect(() => {
    const requests = requestsRef.current
    const trimmed = searchQuery.trim()
    const currentSearchId = requests.issue('global')

    if (trimmed) {
      queueMicrotask(() => {
        if (requests.isCurrent('global', currentSearchId)) {
          setSearchingGlobal(true)
        }
      })
    }

    const timer = setTimeout(async () => {
      if (!trimmed) {
        if (requests.isCurrent('global', currentSearchId)) {
          setGlobalTracks(emptyResults)
          setSearchingGlobal(false)
        }
        return
      }
      try {
        // Single unified request — server handles all sources internally
        const data = await searchService.searchGlobal(trimmed)

        if (requests.isCurrent('global', currentSearchId)) {
          setGlobalTracks(data)
        }
      } catch {
        if (requests.isCurrent('global', currentSearchId)) {
          setGlobalTracks(emptyResults)
        }
      } finally {
        if (requests.isCurrent('global', currentSearchId)) {
          setSearchingGlobal(false)
        }
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [searchQuery, searchService])

  // Quick suggestions are isolated from global result state and never change the homepage result list.
  useEffect(() => {
    const requests = requestsRef.current
    const trimmed = suggestionQuery.trim()
    const currentSearchId = requests.issue('suggestion')

    if (!trimmed) {
      queueMicrotask(() => {
        if (requests.isCurrent('suggestion', currentSearchId)) {
          setSuggestionTracks(emptyResults)
          setSearchingSuggestions(false)
        }
      })
      return
    }

    queueMicrotask(() => {
      if (requests.isCurrent('suggestion', currentSearchId)) {
        setSearchingSuggestions(true)
      }
    })
    const timer = setTimeout(async () => {
      try {
        // Single unified request — reuses client-side cache from global search
        const data = await searchService.searchSuggestions(trimmed)
        if (requests.isCurrent('suggestion', currentSearchId)) {
          setSuggestionTracks(data)
          setSearchingSuggestions(false)
        }
      } catch {
        if (requests.isCurrent('suggestion', currentSearchId)) {
          setSuggestionTracks(emptyResults)
          setSearchingSuggestions(false)
        }
      }
    }, 350)

    return () => clearTimeout(timer)
  }, [suggestionQuery, searchService])

  const clearSearch = useCallback(() => {
    requestsRef.current.invalidate('global')
    requestsRef.current.invalidate('suggestion')
    setSearchQuery('')
    setSuggestionQuery('')
    setGlobalTracks(emptyResults)
    setSuggestionTracks(emptyResults)
    setSearchingGlobal(false)
    setSearchingSuggestions(false)
  }, [])

  const value = useMemo(
    () => ({
      searchQuery,
      setSearchQuery,
      suggestionQuery,
      setSuggestionQuery,
      suggestionTracks,
      searchingSuggestions,
      globalTracks,
      searchingGlobal,
      trendingTracks,
      loadingTrending,
      clearSearch,
    }),
    [searchQuery, globalTracks, searchingGlobal, suggestionQuery, suggestionTracks, searchingSuggestions, trendingTracks, loadingTrending, clearSearch]
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
