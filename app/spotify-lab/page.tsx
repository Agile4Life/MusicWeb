'use client'

import React, { useState, useRef, useCallback } from 'react'
import Link from 'next/link'

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

const CURATED_SEEDS = [
  'Billie Eilish',
  'Radiohead',
  'Vũ',
  'Frank Ocean',
  'Ryuichi Sakamoto',
  'Daft Punk',
  'NewJeans',
  'Chopin',
]

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
    if (!q.trim()) {
      setTracks([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/spotify/search?q=${encodeURIComponent(q)}&limit=12`)
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setTracks(data.tracks || [])
    } catch (e: any) {
      setError(e.message || 'Lỗi tìm kiếm dữ liệu từ Spotify')
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

  const handleSeedClick = (seed: string) => {
    setQuery(seed)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    doSearch(seed)
  }

  const handleClear = () => {
    setQuery('')
    setTracks([])
    setError(null)
  }

  const playTrack = useCallback((track: SpotifyTrack) => {
    setCurrent(track)
  }, [])

  return (
    <div className="slab-root">
      {/* Editorial Custom Styling */}
      <style>{`
        .slab-root {
          min-height: 100dvh;
          background-color: #0c0d0e;
          color: #e6e4df;
          font-family: var(--font-inter), -apple-system, sans-serif;
          padding-bottom: 120px;
          position: relative;
          background-image: radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px);
          background-size: 28px 28px;
        }

        .slab-serif {
          font-family: var(--font-fraunces), "Times New Roman", Georgia, serif;
        }

        .slab-mono {
          font-family: var(--font-ibm-plex-mono), var(--font-jetbrains-mono), monospace;
        }

        .slab-row {
          transition: background-color 0.18s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s ease;
        }
        .slab-row:hover {
          background-color: rgba(255, 255, 255, 0.045) !important;
        }
        .slab-row:hover .slab-row-title {
          color: #ffffff;
        }
        .slab-row:hover .slab-row-action {
          opacity: 1 !important;
          transform: translateX(0) !important;
        }

        .slab-seed-btn {
          transition: all 0.2s ease;
        }
        .slab-seed-btn:hover {
          background-color: rgba(255, 255, 255, 0.1) !important;
          color: #ffffff !important;
          border-color: rgba(255, 255, 255, 0.3) !important;
        }

        .slab-pulse-dot {
          animation: slabPulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }
        @keyframes slabPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }

        .slab-bar-pulse {
          display: inline-flex;
          align-items: flex-end;
          gap: 2px;
          height: 12px;
        }
        .slab-bar-pulse span {
          width: 2px;
          background-color: #1ed760;
          animation: slabEq 0.8s ease-in-out infinite alternate;
        }
        .slab-bar-pulse span:nth-child(1) { height: 40%; animation-delay: 0.1s; }
        .slab-bar-pulse span:nth-child(2) { height: 100%; animation-delay: 0.3s; }
        .slab-bar-pulse span:nth-child(3) { height: 60%; animation-delay: 0.2s; }

        @keyframes slabEq {
          0% { height: 20%; }
          100% { height: 100%; }
        }

        @media (max-width: 768px) {
          .slab-hero-title {
            font-size: 34px !important;
          }
          .slab-topbar-meta {
            display: none !important;
          }
          .slab-table-header, .slab-row {
            grid-template-columns: 28px 1fr 50px !important;
            padding: 10px 8px !important;
          }
          .slab-col-album, .slab-col-action {
            display: none !important;
          }
          .slab-search-input {
            font-size: 16px !important;
            padding: 12px 64px 12px 46px !important;
          }
        }
      `}</style>

      {/* ─── 1. TOP METADATA MASTHEAD STRIP ─── */}
      <div style={styles.topBar}>
        <div style={styles.topBarInner}>
          <div style={styles.topBarLeft}>
            <span className="slab-mono" style={styles.topTag}>№ 01 / ARCHIVE LAB</span>
            <span style={styles.divider} className="slab-topbar-meta">|</span>
            <span className="slab-mono slab-topbar-meta" style={styles.topMeta}>SPOTIFY WEB PROTOCOL</span>
            <span style={styles.divider}>|</span>
            <span className="slab-mono" style={styles.topLive}>
              <span className="slab-pulse-dot" style={styles.liveDot} /> DIRECT API AUDITION
            </span>
          </div>
          <Link href="/" style={styles.returnLink} className="slab-mono">
            <span>←</span> TRANG CHỦ
          </Link>
        </div>
      </div>

      <div style={styles.container}>
        {/* ─── 2. EDITORIAL HERO & PUBLICATION HEADER ─── */}
        <header style={styles.header}>
          <div style={styles.headerTitleWrap}>
            <div style={styles.editionBadge} className="slab-mono">
              CURATED AUDIO ENGINE
            </div>
            <h1 style={styles.heroTitle} className="slab-hero-title slab-serif">
              Spotify <span style={styles.heroItalic}>Lab.</span>
            </h1>
          </div>
          <p style={styles.heroDescription}>
            Giao diện tra cứu và thẩm âm trực tiếp kết nối cơ sở dữ liệu Spotify. Tìm kiếm theo bài hát, nghệ sĩ hoặc album và trải nghiệm nghe thử tức thời.
          </p>
        </header>

        {/* ─── 3. QUERY ARCHIVE / SEARCH CONSOLE ─── */}
        <section style={styles.searchSection}>
          <div style={styles.searchHeader}>
            <span className="slab-mono" style={styles.searchSectionLabel}>
              [ 01 / TÌM KIẾM DỮ LIỆU ]
            </span>
            {tracks.length > 0 && (
              <span className="slab-mono" style={styles.resultCount}>
                {tracks.length} BÀI HÁT TÌM THẤY
              </span>
            )}
          </div>

          <form onSubmit={onSubmit} style={styles.searchForm}>
            <div style={styles.inputContainer}>
              <svg style={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={onInputChange}
                placeholder="Nhập tên ca khúc, nghệ sĩ, nhạc phẩm..."
                style={styles.searchInput}
                className="slab-search-input slab-serif"
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  style={styles.clearBtn}
                  className="slab-mono"
                  title="Xoá tìm kiếm"
                >
                  [XOÁ]
                </button>
              )}
            </div>
          </form>

          {/* Quick Curated Seed Tags */}
          <div style={styles.seedSection}>
            <span className="slab-mono" style={styles.seedLabel}>GỢI Ý TỪ KHÓA:</span>
            <div style={styles.seedList}>
              {CURATED_SEEDS.map((seed) => (
                <button
                  key={seed}
                  type="button"
                  onClick={() => handleSeedClick(seed)}
                  className="slab-seed-btn slab-mono"
                  style={{
                    ...styles.seedBtn,
                    ...(query.toLowerCase() === seed.toLowerCase() ? styles.seedBtnActive : {}),
                  }}
                >
                  {seed}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ─── 4. STATUS / FEEDBACK ─── */}
        {loading && (
          <div style={styles.loadingWrap}>
            <div className="slab-bar-pulse">
              <span />
              <span />
              <span />
            </div>
            <span className="slab-mono" style={styles.loadingText}>
              ĐANG TRUY VẤN MÁY CHỦ SPOTIFY...
            </span>
          </div>
        )}

        {error && (
          <div style={styles.errorBox}>
            <span className="slab-mono" style={styles.errorLabel}>[ LỖI KẾT NỐI ]</span>
            <p style={styles.errorMsg}>{error}</p>
          </div>
        )}

        {/* ─── 5. CATALOGUE LISTING (EDITORIAL TABLE) ─── */}
        {tracks.length > 0 && (
          <section style={styles.catalogueSection}>
            {/* Table Header */}
            <div style={styles.tableHeader} className="slab-table-header slab-mono">
              <span style={styles.colIndex}>№</span>
              <span style={styles.colTitle}>TÁC PHẨM & NGHỆ SĨ</span>
              <span style={styles.colAlbum} className="slab-col-album">ALBUM / PHÁT HÀNH</span>
              <span style={styles.colDuration}>THỜI LƯỢNG</span>
              <span style={styles.colAction} className="slab-col-action">THẨM ÂM</span>
            </div>

            {/* Rows */}
            <div style={styles.tableBody}>
              {tracks.map((t, idx) => {
                const isCurrent = current?.id === t.id
                const padIndex = (idx + 1).toString().padStart(2, '0')

                return (
                  <div
                    key={t.id}
                    onClick={() => playTrack(t)}
                    className="slab-row"
                    style={{
                      ...styles.row,
                      ...(isCurrent ? styles.rowActive : {}),
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        playTrack(t)
                      }
                    }}
                  >
                    {/* Index */}
                    <div style={styles.colIndex} className="slab-mono">
                      {isCurrent ? (
                        <div className="slab-bar-pulse" style={{ marginTop: 2 }}>
                          <span />
                          <span />
                          <span />
                        </div>
                      ) : (
                        <span style={styles.indexNumber}>{padIndex}</span>
                      )}
                    </div>

                    {/* Title & Cover & Artist */}
                    <div style={styles.colTitleContent}>
                      <div style={styles.coverWrapper}>
                        {t.cover_url ? (
                          <img src={t.cover_url} alt="" style={styles.coverImg} loading="lazy" />
                        ) : (
                          <div style={styles.coverPlaceholder} className="slab-mono">♪</div>
                        )}
                      </div>
                      <div style={styles.titleArtistBox}>
                        <span
                          className="slab-row-title slab-serif"
                          style={{
                            ...styles.trackTitle,
                            ...(isCurrent ? styles.trackTitleActive : {}),
                          }}
                        >
                          {t.title}
                        </span>
                        <span style={styles.trackArtist}>{t.artist}</span>
                      </div>
                    </div>

                    {/* Album */}
                    <div style={styles.colAlbum} className="slab-col-album">
                      <span style={styles.albumText}>{t.album || '—'}</span>
                    </div>

                    {/* Duration */}
                    <div style={styles.colDuration} className="slab-mono">
                      <span style={styles.durationText}>{fmtDuration(t.duration)}</span>
                    </div>

                    {/* Action */}
                    <div style={styles.colAction} className="slab-col-action">
                      <span
                        className="slab-row-action slab-mono"
                        style={{
                          ...styles.actionBtn,
                          ...(isCurrent ? styles.actionBtnActive : {}),
                        }}
                      >
                        {isCurrent ? 'ĐANG PHÁT' : 'NGHE THỬ →'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ─── 6. EMPTY / ONBOARDING STATES ─── */}
        {!loading && query && tracks.length === 0 && !error && (
          <div style={styles.emptyState}>
            <span className="slab-mono" style={styles.emptyLabel}>[ KHÔNG CÓ KẾT QUẢ ]</span>
            <h3 style={styles.emptyTitle} className="slab-serif">
              Không tìm thấy mục khớp với &ldquo;{query}&rdquo;
            </h3>
            <p style={styles.emptyDesc}>
              Vui lòng kiểm tra lại chính tả tên bài hát hoặc chọn một trong các từ khóa gợi ý phía trên.
            </p>
          </div>
        )}

        {!loading && !query && tracks.length === 0 && (
          <div style={styles.starterState}>
            <div style={styles.starterBox}>
              <span className="slab-mono" style={styles.starterNumber}>02 / CATALOGUE INDEX</span>
              <h3 style={styles.starterTitle} className="slab-serif">
                Kho lưu trữ chưa có truy vấn.
              </h3>
              <p style={styles.starterDesc}>
                Nhập tên bất kỳ ca khúc bạn yêu thích vào thanh tìm kiếm ở trên hoặc bấm vào các từ khóa gợi ý để xem danh mục và nghe thử trực tiếp qua Spotify.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ─── 7. AUDITION STATION / EMBED PLAYER DOCK ─── */}
      {current && (
        <aside style={styles.playerDock} aria-label="Spotify Player">
          <div style={styles.playerDockInner}>
            {/* Top Bar of the Audition Station */}
            <div style={styles.playerMetaRow}>
              <div style={styles.playerMetaLeft}>
                <span className="slab-mono" style={styles.playerTag}>
                  [ AUDITIONING ]
                </span>
                <span className="slab-serif" style={styles.playerTrackName}>
                  {current.title}
                </span>
                <span style={styles.playerDot}>•</span>
                <span style={styles.playerArtistName}>
                  {current.artist}
                </span>
              </div>

              <div style={styles.playerControls}>
                {current.spotify_url && (
                  <a
                    href={current.spotify_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="slab-mono"
                    style={styles.openSpotifyBtn}
                    title="Mở toàn bộ bài hát trên ứng dụng Spotify"
                  >
                    MỞ SPOTIFY ↗
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setCurrent(null)}
                  style={styles.closePlayerBtn}
                  className="slab-mono"
                  title="Đóng trình nghe thử"
                >
                  [ĐÓNG ✕]
                </button>
              </div>
            </div>

            {/* Embedded Iframe */}
            <div style={styles.iframeWrapper}>
              <iframe
                src={`https://open.spotify.com/embed/track/${current.spotify_id}?utm_source=generator&theme=0`}
                width="100%"
                height="80"
                frameBorder="0"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                loading="lazy"
                style={{ borderRadius: 8, border: 'none' }}
              />
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}

/* ─── editorial inline styles ─── */
const styles: Record<string, React.CSSProperties> = {
  /* Top Masthead Bar */
  topBar: {
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    backgroundColor: '#090a0b',
    padding: '10px 24px',
    position: 'sticky',
    top: 0,
    zIndex: 40,
    backdropFilter: 'blur(8px)',
  },
  topBarInner: {
    maxWidth: 960,
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 11,
    letterSpacing: '0.08em',
  },
  topBarLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    color: '#71717a',
  },
  topTag: {
    color: '#a1a1aa',
    fontWeight: 500,
  },
  divider: {
    color: 'rgba(255, 255, 255, 0.15)',
  },
  topMeta: {
    color: '#71717a',
  },
  topLive: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    color: '#1ed760',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: '#1ed760',
    display: 'inline-block',
  },
  returnLink: {
    color: '#a1a1aa',
    textDecoration: 'none',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    transition: 'color 0.15s ease',
  },

  /* Main Container */
  container: {
    maxWidth: 960,
    margin: '0 auto',
    padding: '0 24px',
  },

  /* Header / Publication Title */
  header: {
    padding: '48px 0 32px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  },
  headerTitleWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  editionBadge: {
    fontSize: 11,
    letterSpacing: '0.12em',
    color: '#1ed760',
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 52,
    fontWeight: 400,
    lineHeight: 1.1,
    margin: 0,
    letterSpacing: '-0.03em',
    color: '#f4f4f5',
  },
  heroItalic: {
    fontStyle: 'italic',
    color: '#a1a1aa',
  },
  heroDescription: {
    fontSize: 15,
    lineHeight: 1.6,
    color: '#8e8e93',
    maxWidth: 620,
    margin: '18px 0 0 0',
  },

  /* Search Section */
  searchSection: {
    padding: '36px 0 24px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  },
  searchHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  searchSectionLabel: {
    fontSize: 11,
    color: '#71717a',
    letterSpacing: '0.1em',
  },
  resultCount: {
    fontSize: 11,
    color: '#1ed760',
    letterSpacing: '0.08em',
  },
  searchForm: {
    width: '100%',
  },
  inputContainer: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 2,
    transition: 'border-color 0.2s, background-color 0.2s',
  },
  searchIcon: {
    position: 'absolute',
    left: 18,
    width: 22,
    height: 22,
    color: '#71717a',
    pointerEvents: 'none',
  },
  searchInput: {
    width: '100%',
    padding: '16px 80px 16px 54px',
    background: 'transparent',
    border: 'none',
    color: '#ffffff',
    fontSize: 20,
    letterSpacing: '-0.01em',
    outline: 'none',
  },
  clearBtn: {
    position: 'absolute',
    right: 16,
    background: 'transparent',
    border: 'none',
    color: '#71717a',
    fontSize: 11,
    cursor: 'pointer',
    padding: '4px 6px',
    letterSpacing: '0.05em',
  },

  /* Seed Tags */
  seedSection: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 12,
    marginTop: 16,
    flexWrap: 'wrap',
  },
  seedLabel: {
    fontSize: 10,
    letterSpacing: '0.08em',
    color: '#52525b',
  },
  seedList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  seedBtn: {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 2,
    color: '#8e8e93',
    fontSize: 11,
    padding: '4px 10px',
    cursor: 'pointer',
    letterSpacing: '0.03em',
  },
  seedBtnActive: {
    background: 'rgba(30, 215, 96, 0.1)',
    borderColor: '#1ed760',
    color: '#1ed760',
  },

  /* Feedback / Loading / Error */
  loadingWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '32px 0',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 12,
    letterSpacing: '0.1em',
    color: '#a1a1aa',
  },
  errorBox: {
    margin: '24px 0',
    padding: '16px 20px',
    background: 'rgba(239, 68, 68, 0.06)',
    borderLeft: '2px solid #ef4444',
  },
  errorLabel: {
    fontSize: 10,
    letterSpacing: '0.1em',
    color: '#ef4444',
    display: 'block',
    marginBottom: 4,
  },
  errorMsg: {
    fontSize: 14,
    color: '#fca5a5',
    margin: 0,
  },

  /* Catalogue Table */
  catalogueSection: {
    padding: '32px 0',
  },
  tableHeader: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr 220px 80px 110px',
    alignItems: 'center',
    padding: '10px 16px',
    fontSize: 10,
    letterSpacing: '0.1em',
    color: '#52525b',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  },
  tableBody: {
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '40px 1fr 220px 80px 110px',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
    cursor: 'pointer',
    borderRadius: 2,
    backgroundColor: 'transparent',
    textAlign: 'left',
  },
  rowActive: {
    backgroundColor: 'rgba(30, 215, 96, 0.06)',
    borderBottomColor: 'rgba(30, 215, 96, 0.2)',
  },

  colIndex: {
    display: 'flex',
    alignItems: 'center',
  },
  indexNumber: {
    fontSize: 11,
    color: '#52525b',
  },
  colTitle: {
    letterSpacing: '0.1em',
  },
  colTitleContent: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    minWidth: 0,
    paddingRight: 16,
  },
  coverWrapper: {
    width: 44,
    height: 44,
    borderRadius: 2,
    overflow: 'hidden',
    flexShrink: 0,
    background: '#18181b',
    border: '1px solid rgba(255, 255, 255, 0.08)',
  },
  coverImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block',
  },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 14,
    color: '#52525b',
  },
  titleArtistBox: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    gap: 2,
  },
  trackTitle: {
    fontSize: 16,
    color: '#e4e4e7',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    transition: 'color 0.15s ease',
  },
  trackTitleActive: {
    color: '#1ed760',
    fontWeight: 600,
  },
  trackArtist: {
    fontSize: 13,
    color: '#71717a',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },

  colAlbum: {
    fontSize: 13,
    color: '#71717a',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    paddingRight: 16,
  },
  albumText: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },

  colDuration: {
    fontSize: 12,
    color: '#71717a',
  },
  durationText: {
    letterSpacing: '0.04em',
  },

  colAction: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  actionBtn: {
    fontSize: 10,
    letterSpacing: '0.08em',
    color: '#8e8e93',
    padding: '4px 8px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: 2,
    opacity: 0.6,
    transform: 'translateX(4px)',
    transition: 'all 0.15s ease',
  },
  actionBtnActive: {
    opacity: 1,
    transform: 'translateX(0)',
    borderColor: '#1ed760',
    color: '#1ed760',
    backgroundColor: 'rgba(30, 215, 96, 0.08)',
  },

  /* Empty States */
  emptyState: {
    padding: '64px 0',
    textAlign: 'center',
  },
  emptyLabel: {
    fontSize: 11,
    letterSpacing: '0.12em',
    color: '#71717a',
    display: 'block',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: 400,
    color: '#f4f4f5',
    margin: '0 0 10px 0',
  },
  emptyDesc: {
    fontSize: 14,
    color: '#71717a',
    maxWidth: 440,
    margin: '0 auto',
    lineHeight: 1.6,
  },

  starterState: {
    padding: '56px 0',
  },
  starterBox: {
    border: '1px dashed rgba(255, 255, 255, 0.1)',
    borderRadius: 2,
    padding: '40px 32px',
    textAlign: 'center',
    background: 'rgba(255, 255, 255, 0.015)',
  },
  starterNumber: {
    fontSize: 10,
    letterSpacing: '0.12em',
    color: '#52525b',
    display: 'block',
    marginBottom: 10,
  },
  starterTitle: {
    fontSize: 22,
    fontWeight: 400,
    color: '#e4e4e7',
    margin: '0 0 12px 0',
  },
  starterDesc: {
    fontSize: 14,
    color: '#71717a',
    maxWidth: 480,
    margin: '0 auto',
    lineHeight: 1.6,
  },

  /* Audition Station Dock (Bottom Player) */
  playerDock: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(12, 13, 14, 0.94)',
    backdropFilter: 'blur(16px)',
    borderTop: '1px solid rgba(255, 255, 255, 0.12)',
    padding: '12px 24px 16px',
    zIndex: 50,
    boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.6)',
  },
  playerDockInner: {
    maxWidth: 960,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  playerMetaRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontSize: 12,
  },
  playerMetaLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
    overflow: 'hidden',
  },
  playerTag: {
    fontSize: 10,
    letterSpacing: '0.1em',
    color: '#1ed760',
    flexShrink: 0,
  },
  playerTrackName: {
    fontSize: 14,
    color: '#ffffff',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  playerDot: {
    color: '#52525b',
    flexShrink: 0,
  },
  playerArtistName: {
    fontSize: 13,
    color: '#a1a1aa',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  playerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexShrink: 0,
  },
  openSpotifyBtn: {
    fontSize: 10,
    letterSpacing: '0.08em',
    color: '#1ed760',
    textDecoration: 'none',
    border: '1px solid rgba(30, 215, 96, 0.3)',
    padding: '4px 8px',
    borderRadius: 2,
    transition: 'all 0.15s ease',
  },
  closePlayerBtn: {
    background: 'none',
    border: 'none',
    color: '#71717a',
    fontSize: 11,
    cursor: 'pointer',
    padding: '4px 6px',
    letterSpacing: '0.05em',
  },
  iframeWrapper: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: 8,
    background: '#000',
  },
}
