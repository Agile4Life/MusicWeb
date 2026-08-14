'use client'

import React, { lazy, Suspense, useRef, useEffect, useState } from 'react'
import { useCanUse3D } from '@/hooks/useCanUse3D'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'
import { usePlayer, usePlaybackProgress } from './PlayerContext'
import { UpNextList } from './UpNextList'
import { extractCoverAccent } from '@/lib/coverColor'

const ParticleScene = lazy(() => import('./ParticleScene'))

interface NowPlayingStageProps {
  analyserData?: Uint8Array
  coverUrl?: string | null
  title?: string | null
  artist?: string | null
  isPlaying: boolean
  children?: React.ReactNode
}

const MAX_TILT = 8 // degrees
const PARALLAX_1 = 12 // px — gradient layer
const PARALLAX_2 = 24 // px — particles
const PARALLAX_3 = 6 // px — album scene

export const NowPlayingStage = React.memo(function NowPlayingStage({
  analyserData,
  coverUrl,
  title,
  artist,
  isPlaying,
  children,
}: NowPlayingStageProps) {
  const canUse3D = useCanUse3D()
  const { currentTime, duration } = usePlaybackProgress()
  const { queue, currentIndex, currentTrack } = usePlayer()
  const [derivedAccent, setDerivedAccent] = useState('var(--accent)')

  useEffect(() => {
    let cancelled = false
    extractCoverAccent(coverUrl).then((color) => {
      if (!cancelled) setDerivedAccent(color)
    })
    return () => {
      cancelled = true
    }
  }, [coverUrl])

  const trackNum = (currentIndex >= 0 ? currentIndex : 0) + 1
  const totalTracks = queue?.length || 1
  const releaseYear = currentTrack?.created_at ? new Date(currentTrack.created_at).getFullYear() : null
  const contextAlbumName = currentTrack?.album || 'Album'

  const progressRatio = (duration && !isNaN(duration) && duration > 0)
    ? Math.min(1, Math.max(0, (currentTime || 0) / duration))
    : 0
  const radius = 47
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference * (1 - progressRatio)

  // Refs for direct DOM manipulation (ZERO React re-renders on mouse move)
  const stageRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const reflectionRef = useRef<HTMLDivElement>(null)
  const bgLayerRef = useRef<HTMLDivElement>(null)
  const particleLayerRef = useRef<HTMLDivElement>(null)
  const sceneLayerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const isPointerActiveRef = useRef(false)

  // Attach global window pointermove listener (ZERO React re-renders, smooth tilt over entire overlay including PlayerBar)
  useEffect(() => {
    if (!canUse3D) return

    const handlePointerMoveGlobal = (e: PointerEvent) => {
      const stage = stageRef.current
      if (!stage) return

      // If entering pointer active state, remove reset transitions
      if (!isPointerActiveRef.current) {
        isPointerActiveRef.current = true
        cardRef.current?.classList.remove('pointer-gone')
        bgLayerRef.current?.classList.remove('reset')
        particleLayerRef.current?.classList.remove('reset')
        sceneLayerRef.current?.classList.remove('reset')
      }

      const rect = stage.getBoundingClientRect()
      const width = rect.width || window.innerWidth
      const height = rect.height || window.innerHeight
      if (width === 0 || height === 0) return

      // Normalize pointer to [-1, 1] relative to stage center
      const nx = ((e.clientX - rect.left) / width - 0.5) * 2
      const ny = ((e.clientY - rect.top) / height - 0.5) * 2

      // Cancel previous frame to prevent backlog
      if (rafRef.current) cancelAnimationFrame(rafRef.current)

      rafRef.current = requestAnimationFrame(() => {
        // --- Album 3D Tilt ---
        const rotateY = nx * MAX_TILT
        const rotateX = -ny * MAX_TILT // Inverted: moving pointer down tilts card forward

        if (cardRef.current) {
          cardRef.current.style.setProperty('--tilt-x', `${rotateX.toFixed(2)}deg`)
          cardRef.current.style.setProperty('--tilt-y', `${rotateY.toFixed(2)}deg`)
        }

        // --- Specular reflection follows pointer ---
        if (reflectionRef.current) {
          const reflectX = Math.min(100, Math.max(0, ((nx + 1) / 2) * 100))
          const reflectY = Math.min(100, Math.max(0, ((ny + 1) / 2) * 100))
          reflectionRef.current.style.setProperty('--reflect-x', `${reflectX.toFixed(1)}%`)
          reflectionRef.current.style.setProperty('--reflect-y', `${reflectY.toFixed(1)}%`)
          reflectionRef.current.style.setProperty('--reflect-opacity', '1')
        }

        // --- Parallax layers ---
        if (bgLayerRef.current) {
          bgLayerRef.current.style.transform = `translate3d(${(nx * PARALLAX_1).toFixed(1)}px, ${(ny * PARALLAX_1).toFixed(1)}px, 0)`
        }
        if (particleLayerRef.current) {
          particleLayerRef.current.style.transform = `translate3d(${(nx * PARALLAX_2).toFixed(1)}px, ${(ny * PARALLAX_2).toFixed(1)}px, 0)`
        }
        if (sceneLayerRef.current) {
          sceneLayerRef.current.style.transform = `translate3d(${(nx * PARALLAX_3).toFixed(1)}px, ${(ny * PARALLAX_3).toFixed(1)}px, 0)`
        }
      })
    }

    const handlePointerLeaveGlobal = () => {
      isPointerActiveRef.current = false

      if (rafRef.current) cancelAnimationFrame(rafRef.current)

      rafRef.current = requestAnimationFrame(() => {
        cardRef.current?.classList.add('pointer-gone')
        bgLayerRef.current?.classList.add('reset')
        particleLayerRef.current?.classList.add('reset')
        sceneLayerRef.current?.classList.add('reset')

        if (cardRef.current) {
          cardRef.current.style.setProperty('--tilt-x', '0deg')
          cardRef.current.style.setProperty('--tilt-y', '0deg')
        }
        if (reflectionRef.current) {
          reflectionRef.current.style.setProperty('--reflect-opacity', '0')
        }
        if (bgLayerRef.current) bgLayerRef.current.style.transform = 'translate3d(0, 0, 0)'
        if (particleLayerRef.current) particleLayerRef.current.style.transform = 'translate3d(0, 0, 0)'
        if (sceneLayerRef.current) sceneLayerRef.current.style.transform = 'translate3d(0, 0, 0)'
      })
    }

    window.addEventListener('pointermove', handlePointerMoveGlobal)
    window.addEventListener('mouseleave', handlePointerLeaveGlobal)

    return () => {
      window.removeEventListener('pointermove', handlePointerMoveGlobal)
      window.removeEventListener('mouseleave', handlePointerLeaveGlobal)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [canUse3D])

  return (
    <div
      ref={stageRef}
      className="now-playing-stage relative w-full h-full flex flex-col items-center justify-center overflow-hidden p-4 sm:p-6 pb-28 lg:pb-36"
      style={{ '--player-derived-accent': derivedAccent } as React.CSSProperties}
    >

      {/* Layer 1: Ambient gradient background (1× parallax) */}
      <div
        ref={bgLayerRef}
        className="parallax-layer z-0 now-playing-bg opacity-80"
      />

      {/* Layer 2: 3D Particle Scene (2× parallax, lazy-loaded) */}
      {canUse3D && (
        <div
          ref={particleLayerRef}
          className="parallax-layer z-10 pointer-events-none"
        >
          <Suspense fallback={null}>
            <ParticleScene analyserData={analyserData} isPlaying={isPlaying} />
          </Suspense>
        </div>
      )}

      {/* Layer 3: Album Cover + Title (3× parallax + 3D tilt) + Stationary Up Next List */}
      <div className="relative z-20 w-full h-full max-w-[1360px] xl:max-w-[1440px] mx-auto px-6 lg:px-12 flex items-center justify-center lg:justify-start">
        <div className="w-full max-w-sm sm:max-w-md lg:max-w-[400px] xl:max-w-[440px] flex flex-col items-center justify-center gap-2.5 sm:gap-3.5">
          {/* Parallax 3D moving wrapper for Album Cover */}
          <div ref={sceneLayerRef} className="scene-layer w-full flex items-center justify-center">
            {/* Perspective container with Album Art + Progress Ring */}
            <div className="album-3d-container relative flex items-center justify-center p-1.5 sm:p-2 shrink-0">
              <div
                ref={cardRef}
                className="album-3d-card pointer-gone now-playing-cover relative w-36 h-36 xs:w-44 xs:h-44 sm:w-52 sm:h-52 lg:w-[190px] lg:h-[190px] xl:w-[230px] xl:h-[230px] aspect-square shrink-0 rounded-full border border-white/20 shadow-[0_20px_50px_rgba(0,0,0,0.7),0_0_60px_var(--accent-dim)]"
              >
                {/* Progress Ring SVG (3D tilted with card, sitting flush around circular album cover) */}
                <svg
                  className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] pointer-events-none -rotate-90 z-20"
                  viewBox="0 0 100 100"
                >
                  {/* Background Track Circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="48"
                    className="stroke-white/20"
                    strokeWidth="2.5"
                    fill="none"
                  />
                  {/* Accent Fill Circle */}
                  <circle
                    cx="50"
                    cy="50"
                    r="48"
                    className="stroke-[var(--spotify-glow,#22d3ee)] motion-reduce:transition-none transition-[stroke-dashoffset] duration-300 ease-linear"
                    strokeWidth="2.5"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 48}
                    strokeDashoffset={2 * Math.PI * 48 * (1 - progressRatio)}
                  />
                </svg>

                {/* Circular overflow-hidden inner wrapper for image + reflection */}
                <div className="w-full h-full rounded-full overflow-hidden relative shadow-inner">
                  <TrackCoverImage src={coverUrl} alt={title || 'Now Playing'} />

                  {/* Specular light reflection */}
                  <div ref={reflectionRef} className="album-3d-reflection rounded-full" />
                </div>
              </div>
            </div>
          </div>

          {/* Title & Artist — Stationary, 100% crisp vector text */}
          <div className="text-center px-4 max-w-md w-full">
            <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-white tracking-tight line-clamp-2">
              {title || 'Chưa chọn bài hát'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 font-medium mt-1 line-clamp-1">
              {artist || 'Nghệ sĩ'}
            </p>

            {/* Context Pill Badge (Bài n/total · Album · Year) */}
            {currentTrack && (
              <div className="mt-2 flex items-center justify-center">
                <span className="bg-white/10 border border-white/15 text-slate-200 px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-md shadow-sm truncate max-w-[280px]">
                  Bài {trackNum}/{totalTracks} {contextAlbumName ? `· ${contextAlbumName}` : ''} {releaseYear ? `· ${releaseYear}` : ''}
                </span>
              </div>
            )}
          </div>

          {/* Stationary Up Next Queue List (Fixed, does NOT follow mouse cursor) */}
          <div className="w-full">
            <UpNextList />
          </div>
        </div>
      </div>
    </div>
  )
})
