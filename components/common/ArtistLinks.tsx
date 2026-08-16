'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { parseArtists } from '@/lib/artistParser'

export interface ArtistLinksProps {
  artist: string | null | undefined
  className?: string
  linkClassName?: string
  separatorClassName?: string
  fallbackText?: string
  onArtistClick?: (artistName: string, e: React.MouseEvent) => void
  'data-playerbar-exclude-fullview'?: boolean
}

export function ArtistLinks({
  artist,
  className = 'text-xs text-slate-400 truncate',
  linkClassName = 'hover:underline hover:text-[var(--spotify-glow,#22d3ee)] transition-colors cursor-pointer',
  separatorClassName = 'text-slate-500 font-normal',
  fallbackText = 'Nghệ sĩ chưa xác định',
  onArtistClick,
  'data-playerbar-exclude-fullview': excludeFullview,
}: ArtistLinksProps) {
  const router = useRouter()

  if (!artist || !artist.trim()) {
    return <span className={className}>{fallbackText}</span>
  }

  const artists = parseArtists(artist)

  const handleItemClick = (name: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onArtistClick) {
      onArtistClick(name, e)
    } else {
      router.push(`/artist?name=${encodeURIComponent(name)}`)
    }
  }

  return (
    <span
      className={className}
      data-playerbar-exclude-fullview={excludeFullview ? '' : undefined}
    >
      {artists.map((item, idx) => (
        <React.Fragment key={`${item.name}-${idx}`}>
          <span
            className={linkClassName}
            onClick={(e) => handleItemClick(item.name, e)}
            title={`Xem nghệ sĩ: ${item.name}`}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleItemClick(item.name, e as any)
              }
            }}
          >
            {item.name}
          </span>
          {item.separator && (
            <span
              className={separatorClassName}
              onClick={(e) => e.stopPropagation()}
            >
              {item.separator}
            </span>
          )}
        </React.Fragment>
      ))}
    </span>
  )
}
