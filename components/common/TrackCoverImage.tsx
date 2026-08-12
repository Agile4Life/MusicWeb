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

  // 1. YouTube Thumbnails: Strip downscaling sqp query params & upgrade to maxresdefault (1280x720)
  if (highRes.includes('ytimg.com') || highRes.includes('youtube.com')) {
    const cleanUrl = highRes.split('?')[0]
    const match = cleanUrl.match(/\/(?:vi|vi_webp)\/([a-zA-Z0-9_-]{11})/)
    if (match && match[1]) {
      return `https://i.ytimg.com/vi/${match[1]}/maxresdefault.jpg`
    }
    highRes = cleanUrl.replace(/\/(hqdefault|mqdefault|default|sddefault|hq720)\.(jpg|webp)/g, '/maxresdefault.jpg')
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
  const [fallbackStage, setFallbackStage] = useState(0)

  const highResSrc = useMemo(() => getHighResCoverUrl(src), [src])

  const youtubeVideoId = useMemo(() => {
    if (!src) return null
    const match = src.match(/\/(?:vi|vi_webp)\/([a-zA-Z0-9_-]{11})/)
    return match ? match[1] : null
  }, [src])

  const currentSrc = useMemo(() => {
    if (!youtubeVideoId) {
      return fallbackStage > 0 ? src : highResSrc
    }
    switch (fallbackStage) {
      case 0:
        return highResSrc || `https://i.ytimg.com/vi/${youtubeVideoId}/maxresdefault.jpg`
      case 1:
        return `https://i.ytimg.com/vi/${youtubeVideoId}/sddefault.jpg`
      case 2:
        return `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`
      case 3:
        return src || null
      default:
        return null
    }
  }, [youtubeVideoId, fallbackStage, highResSrc, src])

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
      width={600}
      height={600}
      decoding="async"
      className={`${className} transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      style={{ aspectRatio: '1 / 1' }}
      onLoad={() => setLoaded(true)}
      onError={() => {
        if (youtubeVideoId) {
          if (fallbackStage < 3) {
            setFallbackStage((prev) => prev + 1)
          } else {
            setHasError(true)
          }
        } else if (fallbackStage === 0 && src && src !== highResSrc) {
          setFallbackStage(1)
        } else {
          setHasError(true)
        }
      }}
      loading="lazy"
    />
  )
}

export const TrackCoverImage = React.memo(TrackCoverImageComponent)
