'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'

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

  // player state
  const [current, setCurrent] = useState<SpotifyTrack | null>(null)
  const [audioSrc, setAudioSrc] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [playError, setPlayError] = useState<string | null>(null)

  const audioRef = useRef<HTMLAudioElement>(null)
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

  /* ─── play track ─── */
  const playTrack = useCallback((track: SpotifyTrack) => {
    setCurrent(track)
    setPlayError(null)
    setIsPlaying(false)
    setProgress(0)
    setAudioDuration(0)

    if (!track.preview_url) {
      setAudioSrc(null)
      setPlayError('Bài này không có preview từ Spotify')
      return
    }

    setAudioSrc(track.preview_url)
  }, [])

  /* ─── audio events ─── */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioSrc) return

    audio.src = audioSrc
    audio.volume = volume
    audio.play().then(() => setIsPlaying(true)).catch(() => {})

    const onTime = () => setProgress(audio.currentTime)
    const onDur = () => setAudioDuration(audio.duration || 0)
    const onEnded = () => { setIsPlaying(false); setProgress(0) }
    const onError = () => setPlayError('Lỗi phát nhạc — preview không khả dụng')

    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onDur)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onDur)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    }
  }, [audioSrc, volume])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) { audio.pause(); setIsPlaying(false) }
    else { audio.play().then(() => setIsPlaying(true)).catch(() => {}) }
  }

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value)
    setProgress(t)
    if (audioRef.current) audioRef.current.currentTime = t
  }

  const changeVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    setVolume(v)
    if (audioRef.current) audioRef.current.volume = v
  }

  /* ─── render ─── */
  return (
    <div style={styles.page}>
      <audio ref={audioRef} preload="auto" />
      {/* Minimal CSS for animations & hover that inline styles can't do */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        .slab-row:hover { background: #27272a !important }
        .slab-row:active { background: #3f3f46 !important }
        .slab-input:focus { border-color: #1DB954 !important }
      `}</style>

      {/* Header */}
      <header style={styles.header}>
        <h1 style={styles.title}>
          <span style={styles.spotifyDot}>●</span> Spotify Lab
        </h1>
        <p style={styles.subtitle}>Search-only — dùng Spotify API tìm bài, resolve stream để phát</p>
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
          const hasPreview = !!t.preview_url

          return (
            <button
              key={t.id}
              onClick={() => playTrack(t)}
              className="slab-row"
              style={{
                ...styles.trackRow,
                ...(isCurrent ? styles.trackRowActive : {}),
                ...(!hasPreview ? { opacity: 0.5 } : {}),
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
                <span style={styles.trackArtist}>{t.artist}{!hasPreview ? ' — không có preview' : ''}</span>
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

      {/* Player Bar */}
      {current && (
        <div style={styles.playerBar}>
          {/* Track info */}
          <div style={styles.playerLeft}>
            {current.cover_url && (
              <img src={current.cover_url} alt="" style={styles.playerCover} />
            )}
            <div style={styles.playerInfo}>
              <span style={styles.playerTitle}>{current.title}</span>
              <span style={styles.playerArtist}>{current.artist}</span>
            </div>
            <span style={styles.sourceBadge}>spotify</span>
          </div>

          {/* Controls */}
          <div style={styles.playerCenter}>
            {playError ? (
              <span style={styles.playerError}>{playError}</span>
            ) : (
              <>
                <button onClick={togglePlay} style={styles.playBtn} disabled={!audioSrc}>
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <span style={styles.timeLabel}>{fmtDuration(progress)}</span>
                <input
                  type="range"
                  min={0}
                  max={audioDuration || 1}
                  step={0.1}
                  value={progress}
                  onChange={seek}
                  style={styles.seekBar}
                />
                <span style={styles.timeLabel}>{fmtDuration(audioDuration)}</span>
              </>
            )}
          </div>

          {/* Volume */}
          <div style={styles.playerRight}>
            <span style={styles.volIcon}>🔊</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={changeVolume}
              style={styles.volBar}
            />
          </div>
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
  coverOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    width: 20,
    height: 20,
    border: '2px solid rgba(255,255,255,0.2)',
    borderTopColor: '#1DB954',
    borderRadius: '50%',
    animation: 'spin 0.6s linear infinite',
  },

  /* track info */
  trackInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  trackTitle: {
    fontSize: 14,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  trackArtist: {
    fontSize: 12,
    color: '#a1a1aa',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },

  /* track meta */
  trackMeta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 0,
  },
  trackAlbum: {
    fontSize: 12,
    color: '#71717a',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 160,
  },
  trackDuration: {
    fontSize: 12,
    color: '#52525b',
    fontVariantNumeric: 'tabular-nums',
  },

  empty: {
    textAlign: 'center',
    color: '#52525b',
    fontSize: 14,
    padding: '32px 0',
  },

  /* player bar */
  playerBar: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    height: 72,
    background: '#18181b',
    borderTop: '1px solid #27272a',
    display: 'flex',
    alignItems: 'center',
    padding: '0 20px',
    gap: 16,
    zIndex: 50,
  },
  playerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    flex: '0 1 280px',
  },
  playerCover: {
    width: 48,
    height: 48,
    borderRadius: 6,
    objectFit: 'cover',
    flexShrink: 0,
  },
  playerInfo: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  playerTitle: {
    fontSize: 13,
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  playerArtist: {
    fontSize: 11,
    color: '#a1a1aa',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  sourceBadge: {
    fontSize: 10,
    padding: '2px 6px',
    borderRadius: 4,
    background: '#1DB95422',
    color: '#1DB954',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },

  /* player center */
  playerCenter: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: 'none',
    background: '#e4e4e7',
    color: '#0a0a0a',
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  timeLabel: {
    fontSize: 11,
    color: '#71717a',
    fontVariantNumeric: 'tabular-nums',
    minWidth: 36,
    textAlign: 'center',
  },
  seekBar: {
    flex: 1,
    maxWidth: 360,
    height: 4,
    accentColor: '#1DB954',
    cursor: 'pointer',
  },
  playerError: {
    fontSize: 12,
    color: '#f87171',
  },

  /* volume */
  playerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: '0 0 auto',
  },
  volIcon: {
    fontSize: 14,
  },
  volBar: {
    width: 80,
    height: 4,
    accentColor: '#1DB954',
    cursor: 'pointer',
  },
}
