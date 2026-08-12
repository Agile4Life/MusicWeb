'use client'

import React from 'react'
import { usePlayer } from './PlayerContext'
import { TrackCoverImage } from '../common/TrackCoverImage'
import { formatTime } from '@/lib/utils'

export function UpNextList() {
  const { queue, currentIndex, currentTrack, playTrack } = usePlayer()

  if (!queue || queue.length === 0) return null

  const startIndex = Math.max(0, currentIndex >= 0 ? currentIndex : 0)

  // If there's only 1 track in total, don't show an empty list
  if (queue.length <= 1) return null

  const remainingTracks = queue.slice(startIndex)

  return (
    <div
      className="w-full mt-3 bg-[#0d1020] border border-white/15 rounded-2xl shadow-2xl overflow-y-auto overscroll-contain max-h-[225px] min-h-0 select-none z-10 relative no-scrollbar shrink-0"
      style={{
        WebkitMaskImage: 'linear-gradient(to bottom, black 86%, transparent 100%)',
        maskImage: 'linear-gradient(to bottom, black 86%, transparent 100%)',
      }}
    >
      {/* Sticky Header (100% Solid background, z-20, clean bottom border) */}
      <div className="sticky top-0 bg-[#0d1020] border-b border-white/10 px-3.5 py-2.5 z-20 flex items-center justify-between shadow-md">
        <h3 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--spotify-glow,#22d3ee)]" />
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
              className={`w-full cv-auto flex items-center gap-3 p-2 rounded-xl text-left transition-all duration-200 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--spotify-glow,#22d3ee)] ${
                isCurrent
                  ? 'bg-[var(--accent,#06b6d4)]/15 border border-[var(--accent,#06b6d4)]/30 text-[var(--spotify-glow,#22d3ee)] shadow-sm'
                  : 'hover:bg-white/10 border border-transparent text-slate-300 hover:text-white'
              }`}
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
