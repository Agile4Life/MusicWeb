'use client'

import React, { useState, useMemo } from 'react'
import { Music } from 'lucide-react'

interface TrackCoverImageProps {
  src?: string | null
  alt?: string
  className?: string
  fallbackIconClassName?: string
}

/**
 * Converts standard/low-res cover URLs from YouTube, iTunes, Deezer, NhacCuaTui
 * into high-resolution (HD/600px/720p) image URLs.
 */
export function getHighResCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null

  let highRes = url

  // 1. YouTube Thumbnails: Upgrade hqdefault/mqdefault/default to hq720 or maxresdefault
  if (highRes.includes('ytimg.com') || highRes.includes('youtube.com')) {
    highRes = highRes.replace(/\/(hqdefault|mqdefault|default|sddefault)\.jpg/g, '/hq720.jpg')
  }

  // 2. iTunes / Apple Music: Upgrade 100x100bb / 200x200bb to 600x600bb
  if (highRes.includes('mzstatic.com')) {
    highRes = highRes.replace(/\/\d+x\d+bb/g, '/600x600bb')
  }

  // 3. Deezer: Upgrade small/medium/big to xl (1000x1000)
  if (highRes.includes('deezer.com')) {
    highRes = highRes.replace(/-(small|medium|big)\.jpg/g, '-xl.jpg')
  }

  // 4. NhacCuaTui: Upgrade _120 / _200 / _300 to _600
  if (highRes.includes('nct.vn') || highRes.includes('nhaccuatui')) {
    highRes = highRes.replace(/_(120|200|300)x\1/g, '_600x600').replace(/_(120|200|300)\.jpg/g, '_600.jpg')
  }

  return highRes
}

function TrackCoverImageComponent({
  src,
  alt = '',
  className = 'w-full h-full object-cover',
  fallbackIconClassName = 'w-4 h-4 text-slate-400',
}: TrackCoverImageProps) {
  const [hasError, setHasError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [useFallbackUrl, setUseFallbackUrl] = useState(false)

  const highResSrc = useMemo(() => getHighResCoverUrl(src), [src])
  const currentSrc = useFallbackUrl ? src : highResSrc

  if (!currentSrc || hasError) {
    return (
      <div className="w-full h-full bg-slate-800 border border-white/10 flex items-center justify-center">
        <Music className={fallbackIconClassName} />
      </div>
    )
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={`${className} transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      onLoad={() => setLoaded(true)}
      onError={() => {
        // If high-res URL failed (e.g. hq720 not available for older YouTube video), fall back to original src
        if (!useFallbackUrl && src && src !== highResSrc) {
          setUseFallbackUrl(true)
        } else {
          setHasError(true)
        }
      }}
      loading="lazy"
    />
  )
}

export const TrackCoverImage = React.memo(TrackCoverImageComponent)
