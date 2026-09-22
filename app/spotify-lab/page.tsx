'use client'

import React, { useState, useRef, useCallback } from 'react'

/* ─── types ─── */
interface SpotifyTrack {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  cover_url: string | null
  spotify_id: string
  preview_url: string | null
  spotify_url: string | null
}

/* ─── helpers ─── */
function fmtDuration(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/* ─── component ─── */
export default function SpotifyLabPage() {
  const [query, setQuery] = useState('')
  const [tracks, setTracks] = useState<SpotifyTrack[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [current, setCurrent] = useState<SpotifyTrack | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ─── search ─── */
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setTracks([]); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}&limit=10`)
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setTracks(data.tracks || [])
    } catch (e: any) {
      setError(e.message || 'Lỗi tìm kiếm')
      setTracks([])
    } finally {
      setLoading(false)
    }
  }, [])

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => doSearch(val), 400)
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    doSearch(query)
  }

  /* ─── play track via Spotify embed ─── */
  const playTrack = useCallback((track: SpotifyTrack) => {
    setCurrent(track)
  }, [])

  /* ─── render ─── */
  return (
    <div style={styles.page}>
      {/* Minimal CSS for hover */}
      <style>{`
        .slab-row:hover { background: #27272a !important }
        .slab-row:active { background: #3f3f46 !important }
        .slab-input:focus { border-color: #1DB954 !important }
      `}</style>

      {/* Header */}
      <header style={styles.header}>
        <h1 style={styles.title}>
          <span style={styles.spotifyDot}>●</span> Spotify Lab
        </h1>
        <p style={styles.subtitle}>Search & nghe preview qua Spotify Embed Player</p>
      </header>

      {/* Search */}
      <form onSubmit={onSubmit} style={styles.searchForm}>
        <div style={styles.searchWrap}>
          <svg style={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={onInputChange}
            placeholder="Tìm bài hát, nghệ sĩ..."
            style={styles.searchInput}
            className="slab-input"
            autoFocus
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setTracks([]) }}
              style={styles.clearBtn}
              aria-label="Xoá"
            >
              ✕
            </button>
          )}
        </div>
      </form>

      {/* Status */}
      {loading && <p style={styles.status}>Đang tìm...</p>}
      {error && <p style={{ ...styles.status, color: '#f87171' }}>{error}</p>}

      {/* Results */}
      <div style={styles.results}>
        {tracks.map((t) => {
          const isCurrent = current?.id === t.id

          return (
            <button
              key={t.id}
              onClick={() => playTrack(t)}
              className="slab-row"
              style={{
                ...styles.trackRow,
                ...(isCurrent ? styles.trackRowActive : {}),
              }}
            >
              {/* Cover */}
              <div style={styles.coverWrap}>
                {t.cover_url ? (
                  <img src={t.cover_url} alt="" style={styles.cover} />
                ) : (
                  <div style={styles.coverPlaceholder}>♪</div>
                )}
              </div>

              {/* Info */}
              <div style={styles.trackInfo}>
                <span style={styles.trackTitle}>{t.title}</span>
                <span style={styles.trackArtist}>{t.artist}</span>
              </div>

              {/* Meta */}
              <div style={styles.trackMeta}>
                <span style={styles.trackAlbum}>{t.album}</span>
                <span style={styles.trackDuration}>{fmtDuration(t.duration)}</span>
              </div>
            </button>
          )
        })}

        {!loading && query && tracks.length === 0 && !error && (
          <p style={styles.empty}>Không tìm thấy kết quả cho &ldquo;{query}&rdquo;</p>
        )}
      </div>

      {/* Spotify Embed Player */}
      {current && (
        <div style={styles.playerBar}>
          <iframe
            src={`https://open.spotify.com/embed/track/${current.spotify_id}?utm_source=generator&theme=0`}
            width="100%"
            height="80"
            frameBorder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            style={{ borderRadius: 12, border: 'none' }}
          />
        </div>
      )}
    </div>
  )
}

/* ─── inline styles ─── */
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100dvh',
    background: '#0a0a0a',
    color: '#e4e4e7',
    fontFamily: 'var(--font-inter, Inter, system-ui, sans-serif)',
    display: 'flex',
    flexDirection: 'column',
    paddingBottom: 100,
  },
  header: {
    padding: '40px 24px 16px',
    maxWidth: 860,
    margin: '0 auto',
    width: '100%',
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    margin: 0,
    letterSpacing: '-0.02em',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  spotifyDot: {
    color: '#1DB954',
    fontSize: 18,
  },
  subtitle: {
    fontSize: 13,
    color: '#71717a',
    marginTop: 4,
  },

  /* search */
  searchForm: {
    padding: '8px 24px 16px',
    maxWidth: 860,
    margin: '0 auto',
    width: '100%',
  },
  searchWrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 14,
    width: 18,
    height: 18,
    color: '#71717a',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    padding: '12px 40px 12px 42px',
    background: '#18181b',
    border: '1px solid #27272a',
    borderRadius: 10,
    color: '#e4e4e7',
    fontSize: 15,
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  clearBtn: {
    position: 'absolute',
    right: 12,
    background: 'none',
    border: 'none',
    color: '#71717a',
    fontSize: 14,
    cursor: 'pointer',
    padding: 4,
  },

  /* status */
  status: {
    textAlign: 'center',
    color: '#a1a1aa',
    fontSize: 14,
    padding: '8px 0',
  },

  /* results */
  results: {
    flex: 1,
    maxWidth: 860,
    margin: '0 auto',
    width: '100%',
    padding: '0 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  trackRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px',
    borderRadius: 8,
    background: 'transparent',
    border: 'none',
    color: '#e4e4e7',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    transition: 'background 0.15s',
  },
  trackRowActive: {
    background: '#1DB95418',
  },

  /* cover */
  coverWrap: {
    width: 48,
    height: 48,
    borderRadius: 6,
    overflow: 'hidden',
    flexShrink: 0,
    position: 'relative',
    background: '#27272a',
  },
  cover: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    color: '#52525b',
  },

  empty: {
    textAlign: 'center',
    color: '#52525b',
    fontSize: 14,
    padding: '32px 0',
  },

  /* player bar — hosts Spotify embed iframe */
  playerBar: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: '#18181b',
    borderTop: '1px solid #27272a',
    padding: '8px 16px',
    zIndex: 50,
  },
}

