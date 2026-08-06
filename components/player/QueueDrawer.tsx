'use client'

import React, { useState } from 'react'
import { usePlayer } from './PlayerContext'
import { X, Play, Music, History, Sparkles } from 'lucide-react'

export function QueueDrawer() {
  const { currentTrack, queue, currentIndex, playTrack, isPlaying, removeFromQueue, clearQueue, isQueueOpen, closeQueue } = usePlayer()
  const [activeTab, setActiveTab] = useState<'queue' | 'history'>('queue')

  if (!isQueueOpen) return null

  // Remaining upcoming tracks in queue after current index
  const nextUpTracks = currentIndex >= 0 ? queue.slice(currentIndex + 1) : queue

  return (
    <aside className="w-full lg:w-80 xl:w-96 bg-[#10131c]/95 backdrop-blur-2xl rounded-2xl border border-white/[0.08] shadow-2xl flex flex-col overflow-hidden shrink-0 h-full select-none animate-in slide-in-from-right duration-200 z-20">
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveTab('queue')}
            className={`text-xs font-extrabold pb-1 relative transition-colors ${
              activeTab === 'queue' ? 'text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Danh sách phát</span>
            {activeTab === 'queue' && (
              <span
                style={{ backgroundColor: 'var(--spotify-glow, #22d3ee)' }}
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full shadow-[0_0_8px_var(--theme-glow-shadow)]"
              />
            )}
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`text-xs font-extrabold pb-1 relative transition-colors ${
              activeTab === 'history' ? 'text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Vừa nghe gần đây</span>
            {activeTab === 'history' && (
              <span
                style={{ backgroundColor: 'var(--spotify-glow, #22d3ee)' }}
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full shadow-[0_0_8px_var(--theme-glow-shadow)]"
              />
            )}
          </button>
        </div>

        <button
          onClick={closeQueue}
          className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          title="Đóng hàng đợi"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Drawer Body Content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5 no-scrollbar">
        {activeTab === 'queue' ? (
          <>
            {/* Section 1: Now Playing */}
            <div className="flex flex-col gap-2.5">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Đang phát</h3>

              {currentTrack ? (
                <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10 group">
                  <div className="w-12 h-12 rounded-xl bg-slate-800 border border-white/10 overflow-hidden shrink-0 relative flex items-center justify-center">
                    {currentTrack.cover_url ? (
                      <img src={currentTrack.cover_url} alt={currentTrack.title} className="w-full h-full object-cover" />
                    ) : (
                      <Music className="w-6 h-6 text-slate-400" />
                    )}

                    {isPlaying && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <div className="flex items-end gap-0.5 h-3">
                          <span className="w-0.5 bg-[var(--spotify-glow,#22d3ee)] rounded-full eq-bar-1" />
                          <span className="w-0.5 bg-[var(--spotify-glow,#22d3ee)] rounded-full eq-bar-2" />
                          <span className="w-0.5 bg-[var(--spotify-glow,#22d3ee)] rounded-full eq-bar-3" />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col min-w-0 flex-1">
                    <p
                      style={{ color: 'var(--spotify-glow, #22d3ee)' }}
                      className="text-xs font-bold truncate"
                    >
                      {currentTrack.title}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">
                      {currentTrack.artist || 'Nghệ sĩ chưa xác định'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic p-3">Chưa có bài hát nào đang phát</p>
              )}
            </div>

            {/* Section 2: Next Up */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Tiếp theo ({nextUpTracks.length})
                </h3>
                {nextUpTracks.length > 0 && (
                  <button
                    onClick={clearQueue}
                    className="text-[11px] font-semibold text-slate-400 hover:text-rose-400 transition-colors"
                  >
                    Xóa hàng đợi
                  </button>
                )}
              </div>

              {nextUpTracks.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {nextUpTracks.map((track, idx) => {
                    const actualQueueIndex = currentIndex + 1 + idx
                    return (
                      <div
                        key={`${track.id}-${idx}`}
                        onClick={() => playTrack(track, queue, actualQueueIndex)}
                        className="flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-white/[0.06] border border-transparent hover:border-white/10 group transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-lg bg-slate-800 border border-white/10 overflow-hidden shrink-0 relative flex items-center justify-center">
                            {track.cover_url ? (
                              <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
                            ) : (
                              <Music className="w-4 h-4 text-slate-500" />
                            )}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Play className="w-3.5 h-3.5 text-white fill-current ml-0.5" />
                            </div>
                          </div>

                          <div className="flex flex-col min-w-0 flex-1">
                            <p className="text-xs font-semibold text-white truncate group-hover:text-[var(--spotify-glow,#22d3ee)] transition-colors">
                              {track.title}
                            </p>
                            <p className="text-[10px] text-slate-400 truncate mt-0.5">
                              {track.artist || 'Nghệ sĩ chưa xác định'}
                            </p>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            removeFromQueue(actualQueueIndex)
                          }}
                          className="p-1 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all rounded-md hover:bg-white/10 shrink-0"
                          title="Xóa khỏi hàng đợi"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="p-6 text-center rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col items-center gap-2">
                  <Sparkles className="w-6 h-6 text-slate-500" />
                  <p className="text-xs text-slate-400">Không có bài hát tiếp theo trong hàng đợi</p>
                  <p className="text-[10px] text-slate-500">Hãy chọn "Thêm vào hàng đợi" ở danh sách bài hát</p>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Tab 2: Recently Played */
          <div className="flex flex-col gap-2.5">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Lịch sử vừa nghe</h3>

            {queue.slice(0, currentIndex).length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {queue.slice(0, currentIndex).reverse().map((track, idx) => (
                  <div
                    key={`hist-${track.id}-${idx}`}
                    onClick={() => playTrack(track)}
                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.06] border border-transparent hover:border-white/10 group transition-all cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-lg bg-slate-800 border border-white/10 overflow-hidden shrink-0 relative flex items-center justify-center">
                      {track.cover_url ? (
                        <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
                      ) : (
                        <Music className="w-4 h-4 text-slate-500" />
                      )}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Play className="w-3.5 h-3.5 text-white fill-current ml-0.5" />
                      </div>
                    </div>

                    <div className="flex flex-col min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white truncate group-hover:text-[var(--spotify-glow,#22d3ee)] transition-colors">
                        {track.title}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate mt-0.5">
                        {track.artist || 'Nghệ sĩ chưa xác định'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col items-center gap-2">
                <History className="w-6 h-6 text-slate-500" />
                <p className="text-xs text-slate-400">Chưa có bài hát vừa nghe gần đây</p>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
