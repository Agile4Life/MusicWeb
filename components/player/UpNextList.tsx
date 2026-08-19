'use client'

import React, { useState, useEffect } from 'react'
import { usePlayer } from './PlayerContext'
import { TrackCoverImage } from '../common/TrackCoverImage'
import { formatTime } from '@/lib/utils'

export function UpNextList() {
  const { queue, currentIndex, currentTrack, playTrack } = usePlayer()

  const [isLiquidGlass, setIsLiquidGlass] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const check = () => setIsLiquidGlass(root.getAttribute('data-theme-style') === 'liquid-glass')
    check()
    const observer = new MutationObserver(check)
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme-style'] })
    return () => observer.disconnect()
  }, [])

  if (!queue || queue.length === 0) return null

  const startIndex = Math.max(0, currentIndex >= 0 ? currentIndex : 0)

  // If there's only 1 track in total, don't show an empty list
  if (queue.length <= 1) return null

  const remainingTracks = queue.slice(startIndex)

  return (
    <div
      className="up-next-list w-full mt-2 sm:mt-2.5 rounded-2xl shadow-2xl overflow-y-auto overscroll-contain min-h-[120px] max-h-[clamp(130px,22vh,200px)] xl:max-h-[clamp(150px,26vh,240px)] select-none z-10 relative no-scrollbar shrink-0"
      style={{
        WebkitMaskImage: 'linear-gradient(to bottom, black 86%, transparent 100%)',
        maskImage: 'linear-gradient(to bottom, black 86%, transparent 100%)',
        ...(isLiquidGlass ? {
          background: 'linear-gradient(135deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.035) 60%, rgba(6,182,212,0.06) 100%)',
          backdropFilter: 'blur(36px) saturate(200%) brightness(1.05)',
          WebkitBackdropFilter: 'blur(36px) saturate(200%) brightness(1.05)',
          border: '1px solid rgba(255,255,255,0.22)',
          borderTopColor: 'rgba(255,255,255,0.42)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7), inset 0 1.5px 0 rgba(255,255,255,0.45), 0 0 36px rgba(34,211,238,0.18)',
        } : {
          backgroundColor: '#0d1020',
          border: '1px solid rgba(255,255,255,0.15)',
        }),
      }}
    >
      {/* Sticky Header */}
      <div
        className="sticky top-0 px-3.5 py-2 z-20 flex items-center justify-between"
        style={isLiquidGlass ? {
          background: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        } : {
          backgroundColor: '#0d1020',
          borderBottom: '1px solid rgba(255,255,255,0.10)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
        }}
      >
        <h3 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: 'var(--spotify-glow,#22d3ee)',
              boxShadow: isLiquidGlass ? '0 0 6px var(--spotify-glow,#22d3ee)' : 'none',
            }}
          />
          Tiếp theo
        </h3>
        <span className="text-[10px] text-slate-400 font-medium">
          {startIndex + 1}/{queue.length} bài
        </span>
      </div>

      <div className="flex flex-col gap-1 p-2">
        {remainingTracks.map((track, idx) => {
          const actualIndex = startIndex + idx
          const isCurrent = actualIndex === currentIndex || Boolean(currentTrack?.id && track.id === currentTrack.id)

          return (
            <button
              key={`${track.id}-${actualIndex}`}
              type="button"
              onClick={() => playTrack(track, queue, actualIndex)}
              aria-label={`Phát bài ${track.title} của ${track.artist || 'Nghệ sĩ'}`}
              className="w-full cv-auto flex items-center gap-2.5 sm:gap-3 p-2 rounded-xl text-left transition-all duration-200 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-glow,#22d3ee)] border"
              style={isCurrent ? {
                background: isLiquidGlass
                  ? 'linear-gradient(135deg, rgba(6,182,212,0.22) 0%, rgba(255,255,255,0.08) 100%)'
                  : 'rgba(6,182,212,0.15)',
                borderColor: isLiquidGlass ? 'rgba(34,211,238,0.50)' : 'rgba(6,182,212,0.30)',
                color: 'var(--spotify-glow,#22d3ee)',
                ...(isLiquidGlass ? {
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.3), 0 0 18px rgba(34,211,238,0.28)',
                } : {
                  boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                }),
              } : {
                borderColor: 'transparent',
                color: 'rgb(203 213 225)',
              }}
            >
              <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 border border-white/10 relative bg-slate-900 shadow">
                <TrackCoverImage src={track.cover_url} alt={track.title} />
                {isCurrent && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="flex items-end justify-center gap-0.5 h-3">
                      <span className="w-0.5 bg-[var(--spotify-glow,#22d3ee)] rounded-full eq-bar-1" />
                      <span className="w-0.5 bg-[var(--spotify-glow,#22d3ee)] rounded-full eq-bar-2" />
                      <span className="w-0.5 bg-[var(--spotify-glow,#22d3ee)] rounded-full eq-bar-3" />
                    </div>
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
                  <p className={`text-xs font-semibold truncate ${isCurrent ? 'text-[var(--spotify-glow,#22d3ee)] font-bold' : 'text-slate-200 group-hover:text-white'}`}>
                    {track.title}
                  </p>
                  {isCurrent && (
                    <div className="flex items-end justify-center gap-0.5 h-3 shrink-0 ml-0.5">
                      <span className="w-0.5 bg-[var(--spotify-glow,#22d3ee)] rounded-full eq-bar-1" />
                      <span className="w-0.5 bg-[var(--spotify-glow,#22d3ee)] rounded-full eq-bar-2" />
                      <span className="w-0.5 bg-[var(--spotify-glow,#22d3ee)] rounded-full eq-bar-3" />
                    </div>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 truncate mt-0.5">
                  {track.artist || track.artist_name || 'Nghệ sĩ chưa xác định'}
                </p>
              </div>

              {track.duration > 0 && (
                <span className="text-[10px] font-mono text-slate-400 shrink-0 font-medium">
                  {formatTime(track.duration)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
