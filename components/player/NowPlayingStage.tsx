'use client'

import React, { lazy, Suspense } from 'react'
import { useCanUse3D } from '@/hooks/useCanUse3D'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'

const ParticleScene = lazy(() => import('./ParticleScene'))

interface NowPlayingStageProps {
  analyserData?: Uint8Array
  coverUrl?: string
  title?: string
  artist?: string
  isPlaying: boolean
}

export function NowPlayingStage({
  analyserData,
  coverUrl,
  title,
  artist,
  isPlaying,
}: NowPlayingStageProps) {
  const canUse3D = useCanUse3D()

  return (
    <div className="now-playing-stage relative w-full h-full flex flex-col items-center justify-center overflow-hidden p-6">
      {/* Base layer: Ambient background */}
      <div className="absolute inset-0 z-0 now-playing-bg opacity-80" />

      {/* Desktop 3D Particle Scene (Lazy-loaded, gated by useCanUse3D) */}
      {canUse3D && (
        <div className="absolute inset-0 z-10 pointer-events-none">
          <Suspense fallback={null}>
            <ParticleScene analyserData={analyserData} isPlaying={isPlaying} />
          </Suspense>
        </div>
      )}

      {/* Hero Album Cover */}
      <div className="relative z-20 flex flex-col items-center justify-center gap-6 max-w-md w-full">
        <div className="now-playing-cover relative w-64 h-64 sm:w-72 sm:h-72 lg:w-80 lg:h-80 rounded-2xl overflow-hidden border border-white/10 shadow-2xl transition-transform duration-300 hover:scale-[1.02]">
          <TrackCoverImage src={coverUrl} alt={title || 'Now Playing'} />
        </div>

        <div className="text-center px-4">
          <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-tight line-clamp-1">
            {title || 'Chưa chọn bài hát'}
          </h2>
          <p className="text-sm sm:text-base text-slate-400 font-medium mt-1 line-clamp-1">
            {artist || 'Nghệ sĩ'}
          </p>
        </div>
      </div>
    </div>
  )
}
