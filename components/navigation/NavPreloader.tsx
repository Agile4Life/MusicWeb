'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { usePlaylists } from '@/components/playlist/PlaylistContext'

// In-memory global prewarm flag so we only prewarm once per session
let hasPrewarmedAllNav = false

export function NavPreloader() {
  const router = useRouter()
  const { playlists } = usePlaylists()
  const preloadedRef = useRef(false)

  useEffect(() => {
    if (preloadedRef.current) return
    preloadedRef.current = true

    // 1. Eagerly prefetch all 5 main navigation route bundles
    const routesToPrefetch = ['/', '/albums', '/favorites', '/history']
    routesToPrefetch.forEach((path) => {
      try {
        router.prefetch(path)
      } catch (err) {
        // Ignore prefetch errors in dev mode
      }
    })

    // 2. If playlists exist, prefetch playlist route
    if (playlists && playlists.length > 0) {
      try {
        router.prefetch(`/playlist/${playlists[0].id}`)
      } catch {}
    }

    // 3. Prewarm API data in background on idle so page data is instant
    if (!hasPrewarmedAllNav) {
      hasPrewarmedAllNav = true

      const runPrewarm = () => {
        const fetchSilently = (url: string) => {
          fetch(url, { priority: 'low' }).catch(() => {})
        }

        fetchSilently('/api/favorites/list?limit=100')
        fetchSilently('/api/history/list?limit=100')
        fetchSilently('/api/albums/new-releases')
        fetchSilently('/api/playlists')
      }

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        ;(window as any).requestIdleCallback(runPrewarm, { timeout: 1500 })
      } else {
        setTimeout(runPrewarm, 600)
      }
    }
  }, [router, playlists])

  return null
}
