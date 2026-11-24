'use client'

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useReducedMotion } from 'framer-motion'
import { TiltCard } from './TiltCard'
import { ArtistLinks } from './ArtistLinks'
import { Play, DiscAlbum, ListMusic, Music, Pause } from 'lucide-react'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export interface MediaCardProps {
  id: string
  title: string
  subtitle?: string
  coverUrl?: string | null
  type?: 'album' | 'single' | 'playlist' | 'track'
  badgeLabel?: string
  metaText?: string
  href?: string
  onClick?: (e: React.MouseEvent) => void
  onPlay?: (e: React.MouseEvent | React.KeyboardEvent) => void
  isPlaying?: boolean
  index?: number
  className?: string
  fallbackIcon?: 'album' | 'playlist' | 'track'
}

export function MediaCard({
  id,
  title,
  subtitle,
  coverUrl,
  type = 'album',
  badgeLabel,
  metaText,
  href = '#',
  onClick,
  onPlay,
  isPlaying = false,
  index = 0,
  className = '',
  fallbackIcon = 'album',
}: MediaCardProps) {
  const reducedMotion = useReducedMotion()
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const [errorUrl, setErrorUrl] = useState<string | null>(null)

  useIsomorphicLayoutEffect(() => {
    const img = imgRef.current
    if (coverUrl && img && img.complete && img.naturalWidth > 0) {
      setLoadedUrl(coverUrl)
    }
  }, [coverUrl])

  const hasCoverError = Boolean(coverUrl && errorUrl === coverUrl)
  const isCoverVisible = Boolean(
    coverUrl && (coverUrl.startsWith('data:') || loadedUrl === coverUrl)
  )

  const displayBadge = badgeLabel
  const cardIndex = Math.min(Math.max(index ?? 0, 0), 8)

  const isArtistSubtitle = Boolean(
    subtitle &&
      type !== 'playlist' &&
      id !== 'drive-folder' &&
      !/^\d{4}\s*•/.test(subtitle) &&
      !subtitle.includes('Google Drive')
  )

  const handleCardClick = (e: React.MouseEvent) => {
    if (onClick) {
      if (href === '#' || !href) {
        e.preventDefault()
      }
      onClick(e)
    } else if ((href === '#' || !href) && onPlay) {
      e.preventDefault()
      onPlay(e)
    }
  }

  const handlePlayClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    if (onPlay) {
      e.preventDefault()
      e.stopPropagation()
      onPlay(e)
    }
  }

  const renderFallbackIcon = () => {
    if (fallbackIcon === 'playlist' || type === 'playlist') {
      return <ListMusic className="cover-img w-9 h-9 sm:w-11 sm:h-11 text-slate-500" />
    }
    if (fallbackIcon === 'track' || type === 'track') {
      return <Music className="cover-img w-9 h-9 sm:w-11 sm:h-11 text-slate-500" />
    }
    return <DiscAlbum className="cover-img w-9 h-9 sm:w-11 sm:h-11 text-slate-500" />
  }

  return (
    <div
      className="motion-card-enter h-full w-full"
      style={{ ['--card-index' as string]: cardIndex } as React.CSSProperties}
    >
      <TiltCard
        className={`media-card group p-2.5 sm:p-3.5 flex flex-col gap-2.5 sm:gap-3 cursor-pointer outline-none w-full h-full select-none ${
          isPlaying ? 'is-playing' : ''
        } ${className}`}
      >
        <Link
          href={href}
          onClick={handleCardClick}
          className={`flex flex-col gap-2.5 sm:gap-3 h-full w-full outline-none ${
            reducedMotion
              ? ''
              : 'active:scale-[0.98] transition-transform duration-150 ease-[var(--ease-out)]'
          }`}
        >
          {/* 3D Elevated Cover Artwork Container */}
          <div className="aspect-square w-full bg-[var(--elevation-1-bg,#0a0e17)] rounded-xl sm:rounded-2xl overflow-hidden relative border border-white/10 flex items-center justify-center shadow-inner">
            {coverUrl && !hasCoverError ? (
              <div className="relative w-full h-full bg-white/[0.04]">
                <img
                  ref={imgRef}
                  src={coverUrl}
                  alt={title}
                  width={320}
                  height={320}
                  decoding="async"
                  loading="lazy"
                  onLoad={() => setLoadedUrl(coverUrl)}
                  onError={() => setErrorUrl(coverUrl)}
                  className={`cover-img w-full h-full object-cover ${
                    isCoverVisible ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{
                    aspectRatio: '1 / 1',
                    transition: 'transform 240ms var(--ease-out), opacity 200ms var(--ease-out)',
                  }}
                />
              </div>
            ) : (
              renderFallbackIcon()
            )}

            {/* Vignette Overlay for Crisp Contrast */}
            <div className="cover-overlay" />

            {/* Floating Glassmorphic Type Badge */}
            {displayBadge && (
              <div className="badge-glass absolute top-2 left-2 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-mono text-[var(--spotify-glow,#22d3ee)] uppercase tracking-wider font-semibold z-10">
                {displayBadge}
              </div>
            )}

            {/* Floating Tactile 3D Play Button */}
            {onPlay && (
              <div
                role="button"
                tabIndex={0}
                aria-label={isPlaying ? `Tạm dừng ${title}` : `Phát ${title}`}
                onClick={handlePlayClick}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handlePlayClick(e)
                }}
                className="play-btn z-10"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 ml-0.5 fill-current" />
                )}
              </div>
            )}
          </div>

          {/* Card Typography & Metadata */}
          <div className="flex flex-col gap-0.5 sm:gap-1 min-w-0 px-0.5 relative z-10">
            <h3 className="card-title text-xs sm:text-sm font-bold text-white truncate tracking-tight">
              {title}
            </h3>
            {subtitle &&
              (isArtistSubtitle ? (
                <ArtistLinks
                  artist={subtitle}
                  className="card-artist text-[11px] sm:text-xs text-slate-400 group-hover:text-slate-300 truncate font-medium transition-colors block"
                  linkClassName="hover:underline hover:text-[var(--spotify-glow,#22d3ee)] transition-colors cursor-pointer"
                  separatorClassName="text-slate-500 font-normal"
                />
              ) : (
                <p className="card-artist text-[11px] sm:text-xs text-slate-400 group-hover:text-slate-300 truncate font-medium transition-colors">
                  {subtitle}
                </p>
              ))}
            {metaText && (
              <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 mt-0.5 min-w-0">
                <span className="truncate">{metaText}</span>
              </div>
            )}
          </div>
        </Link>
      </TiltCard>
    </div>
  )
}
