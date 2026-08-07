'use client'

import React, { useState } from 'react'
import { Music } from 'lucide-react'

interface TrackCoverImageProps {
  src?: string | null
  alt?: string
  className?: string
  fallbackIconClassName?: string
}

export function TrackCoverImage({
  src,
  alt = '',
  className = 'w-full h-full object-cover',
  fallbackIconClassName = 'w-4 h-4 text-slate-400',
}: TrackCoverImageProps) {
  const [hasError, setHasError] = useState(false)

  if (!src || hasError) {
    return (
      <div className="w-full h-full bg-slate-800 border border-white/10 flex items-center justify-center">
        <Music className={fallbackIconClassName} />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setHasError(true)}
      loading="lazy"
    />
  )
}
