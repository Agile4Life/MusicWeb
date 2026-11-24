'use client'

import { useState, useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { EASE_OUT, SPRING_UI, drawerSheetProps } from '@/lib/motion'
import { usePlayer } from './PlayerContext'
import { useLanguage } from '@/components/i18n/LanguageContext'
import { X, Play, Music, History, ListMusic } from 'lucide-react'
import { TrackCoverImage } from '@/components/common/TrackCoverImage'
import { ArtistLinks } from '@/components/common/ArtistLinks'
import { useListGlideIndicator } from '@/components/common/useGlideIndicator'
import { createClient } from '@/lib/supabase/client'
import { useSession } from 'next-auth/react'
import { getRecentUniqueTracks } from '@/lib/listeningHistory'
import { Track } from '@/types'

export function QueueDrawer() {
  const supabase = createClient()
  const { data: nextAuthSession } = useSession()
  const { t } = useLanguage()
  const prefersReducedMotion = useReducedMotion()
  const { currentTrack, queue, currentIndex, playTrack, isPlaying, removeFromQueue, clearQueue, isQueueOpen, closeQueue } = usePlayer()
  const [activeTab, setActiveTab] = useState<'queue' | 'history'>('queue')
  const [persistedRecentTracks, setPersistedRecentTracks] = useState<Track[]>([])
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(min-width: 1024px)')
    setIsDesktop(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!isQueueOpen || activeTab !== 'history') return

    let cancelled = false
    async function loadRecentHistory() {
      try {
        const res = await fetch('/api/history/list?limit=50')
        if (res.ok) {
          const { items } = await res.json()
          const unique = getRecentUniqueTracks(items ?? [])
          if (!cancelled) {
            setPersistedRecentTracks(unique)
          }
        } else {
          if (!cancelled) setPersistedRecentTracks([])
        }
      } catch (err) {
        console.error('QueueDrawer history load error:', err)
      }
    }

    if (!isQueueOpen || activeTab !== 'history') return

    loadRecentHistory()

    const channel = supabase
      .channel('queue-drawer-history-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'listening_history' },
        () => {
          loadRecentHistory()
        }
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
  }, [isQueueOpen, activeTab, supabase, nextAuthSession])

  const queueGlide = useListGlideIndicator(48)
  const historyGlide = useListGlideIndicator(48)

  // Remaining upcoming tracks in queue after current index
  const nextUpTracks = currentIndex >= 0 ? queue.slice(currentIndex + 1) : queue

  // Stable occurrence keys so removing an item preserves identity for remaining rows
  const nextUpKeyed = (() => {
    const counts = new Map<string, number>()
    return nextUpTracks.map((track, idx) => {
      const nextCount = (counts.get(track.id) ?? 0) + 1
      counts.set(track.id, nextCount)
      return { track, idx, rowKey: `${track.id}#${nextCount}` }
    })
  })()

  // Fallback to memory queue history if persisted history is empty
  const displayHistoryTracks = persistedRecentTracks.length > 0 ? persistedRecentTracks : []

  const baseSheetProps = drawerSheetProps(prefersReducedMotion, isDesktop ? 'right' : 'bottom')
  const sheetMotionProps = prefersReducedMotion
    ? baseSheetProps
    : {
        ...baseSheetProps,
        initial: { ...baseSheetProps.initial, opacity: 0 },
        exit: { ...baseSheetProps.exit, opacity: 0 },
      }

  const rowTransitionStyle: React.CSSProperties = {
    transition:
      'transform 150ms var(--ease-out), background-color 150ms var(--ease-out), border-color 150ms var(--ease-out), color 150ms var(--ease-out)',
  }

  return (
    <AnimatePresence>
      {isQueueOpen && (
        <motion.aside
          key="queue-drawer-panel"
          {...sheetMotionProps}
          style={{ transitionProperty: 'border-color, background-color' }}
          className="queue-drawer fixed inset-x-2 top-16 bottom-36 z-40 lg:z-40 lg:static lg:inset-auto lg:top-auto lg:bottom-auto lg:h-full w-auto lg:w-72 xl:w-80 2xl:w-96 bg-[var(--elevation-3-bg)] backdrop-blur-2xl rounded-2xl lg:rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden shrink-0 select-none"
        >
          {/* Drawer Header */}
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setActiveTab('queue')}
                className={`text-xs font-extrabold pb-1 relative active:scale-[0.97] transition-[color,transform] duration-150 ease-[var(--ease-out)] cursor-pointer ${
                  activeTab === 'queue' ? 'text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>{t('queue')}</span>
                {activeTab === 'queue' && (
                  <motion.span
                    layoutId="queue-tab-underline"
                    transition={prefersReducedMotion ? { duration: 0.14 } : SPRING_UI}
                    style={{ backgroundColor: 'var(--spotify-glow, #22d3ee)' }}
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full shadow-[0_0_8px_var(--theme-glow-shadow)]"
                  />
                )}
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`text-xs font-extrabold pb-1 relative active:scale-[0.97] transition-[color,transform] duration-150 ease-[var(--ease-out)] cursor-pointer ${
                  activeTab === 'history' ? 'text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>{t('recently_played')}</span>
                {activeTab === 'history' && (
                  <motion.span
                    layoutId="queue-tab-underline"
                    transition={prefersReducedMotion ? { duration: 0.14 } : SPRING_UI}
                    style={{ backgroundColor: 'var(--spotify-glow, #22d3ee)' }}
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full shadow-[0_0_8px_var(--theme-glow-shadow)]"
                  />
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={closeQueue}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/10 active:scale-[0.97] transition-[color,background-color,transform] duration-150 ease-[var(--ease-out)] cursor-pointer"
              title={t('close')}
              aria-label={t('close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Drawer Content */}
          <div className="flex-1 overflow-y-auto p-4 pb-28 lg:pb-4">
            <AnimatePresence mode="wait" initial={false}>
              {activeTab === 'queue' ? (
                <motion.div
                  key="queue-tab-content"
                  initial={
                    prefersReducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, transform: 'translate3d(0, 4px, 0)' }
                  }
                  animate={
                    prefersReducedMotion
                      ? { opacity: 1 }
                      : { opacity: 1, transform: 'translate3d(0, 0px, 0)' }
                  }
                  exit={
                    prefersReducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, transform: 'translate3d(0, -4px, 0)' }
                  }
                  transition={{ duration: 0.16, ease: EASE_OUT }}
                  className="space-y-6"
                >
                  {/* Section 1: Now Playing */}
                  <div className="flex flex-col gap-2.5">
                    <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                      {t('now_playing')}
                    </span>

                    {currentTrack ? (
                      <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.04] border border-white/10 group">
                        <div className="w-12 h-12 rounded-xl bg-slate-800 border border-white/10 overflow-hidden shrink-0 relative flex items-center justify-center">
                          <TrackCoverImage src={currentTrack.cover_url} alt={currentTrack.title} />

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
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            <ArtistLinks artist={currentTrack.artist} fallbackText={t('unknown_artist')} className="text-[11px] text-slate-400 truncate" />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic p-3">Chưa có bài hát nào đang phát</p>
                    )}
                  </div>

                  {/* Section 2: Next Up */}
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider truncate">
                        {t('next_up')} ({nextUpTracks.length})
                      </span>
                      {nextUpTracks.length > 0 && (
                        <button
                          type="button"
                          onClick={clearQueue}
                          className="text-[11px] text-slate-400 hover:text-rose-400 active:scale-[0.97] transition-[color,transform] duration-150 ease-[var(--ease-out)] whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {t('clear_queue')}
                        </button>
                      )}
                    </div>

                    {nextUpKeyed.length > 0 ? (
                      <div
                        ref={queueGlide.containerRef}
                        onMouseLeave={queueGlide.handleContainerMouseLeave}
                        className="flex flex-col gap-1.5 relative"
                      >
                        <div
                          className="track-glide-indicator"
                          style={{
                            transform: `translateY(${queueGlide.indicator.top}px) scaleY(${queueGlide.indicator.scaleY})`,
                            height: `${queueGlide.indicator.height}px`,
                            opacity: queueGlide.indicator.opacity,
                          }}
                        />
                        <AnimatePresence initial={false}>
                          {nextUpKeyed.map(({ track, idx, rowKey }) => {
                            const actualQueueIndex = currentIndex + 1 + idx
                            return (
                              <motion.div
                                key={rowKey}
                                initial={false}
                                exit={
                                  prefersReducedMotion
                                    ? { opacity: 0 }
                                    : { opacity: 0, transform: 'translate3d(14px, 0, 0) scale(0.97)' }
                                }
                                transition={{ duration: 0.18, ease: EASE_OUT }}
                              >
                                <div
                                  onClick={() => playTrack(track, queue, actualQueueIndex)}
                                  onMouseEnter={queueGlide.handleItemMouseEnter}
                                  style={rowTransitionStyle}
                                  className="queue-track-row flex items-center justify-between gap-3 p-2 rounded-xl border border-transparent group active:scale-[0.98] cursor-pointer relative z-[1]"
                                >
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className="w-9 h-9 rounded-lg bg-slate-800 border border-white/10 overflow-hidden shrink-0 relative flex items-center justify-center group/cover">
                                      <TrackCoverImage src={track.cover_url} alt={track.title} />
                                      <div className="absolute inset-0 bg-black/40 opacity-0 [@media(hover:hover)]:group-hover/cover:opacity-100 flex items-center justify-center transition-opacity duration-150">
                                        <Play className="w-3.5 h-3.5 text-white fill-current ml-0.5" />
                                      </div>
                                    </div>

                                    <div className="flex flex-col min-w-0 flex-1">
                                      <p className="text-xs font-semibold text-white truncate group-hover:text-[var(--spotify-glow,#22d3ee)] transition-colors duration-150">
                                        {track.title}
                                      </p>
                                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                                        <ArtistLinks artist={track.artist} fallbackText={t('unknown_artist')} className="text-[10px] text-slate-400 truncate" />
                                      </div>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      removeFromQueue(actualQueueIndex)
                                    }}
                                    className="p-1.5 text-slate-400 hover:text-rose-400 opacity-70 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100 active:scale-[0.97] transition-[opacity,color,background-color,transform] duration-150 ease-[var(--ease-out)] rounded-md hover:bg-white/10 shrink-0 cursor-pointer"
                                    title={t('remove_from_queue')}
                                    aria-label={t('remove_from_queue')}
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </motion.div>
                            )
                          })}
                        </AnimatePresence>
                      </div>
                    ) : (
                      <div className="p-6 text-center rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col items-center gap-2">
                        <ListMusic className="w-6 h-6 text-slate-500" />
                        <p className="text-xs text-slate-400">{t('no_next_tracks')}</p>
                        <p className="text-[10px] text-slate-500">{t('add_to_queue_hint')}</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              ) : (
                /* Tab 2: Recently Played */
                <motion.div
                  key="history-tab-content"
                  initial={
                    prefersReducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, transform: 'translate3d(0, 4px, 0)' }
                  }
                  animate={
                    prefersReducedMotion
                      ? { opacity: 1 }
                      : { opacity: 1, transform: 'translate3d(0, 0px, 0)' }
                  }
                  exit={
                    prefersReducedMotion
                      ? { opacity: 0 }
                      : { opacity: 0, transform: 'translate3d(0, -4px, 0)' }
                  }
                  transition={{ duration: 0.16, ease: EASE_OUT }}
                  className="flex flex-col gap-2.5"
                >
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">{t('recently_played')}</h3>

                  {displayHistoryTracks.length > 0 ? (
                    <div
                      ref={historyGlide.containerRef}
                      onMouseLeave={historyGlide.handleContainerMouseLeave}
                      className="flex flex-col gap-1.5 relative"
                    >
                      <div
                        className="track-glide-indicator"
                        style={{
                          transform: `translateY(${historyGlide.indicator.top}px) scaleY(${historyGlide.indicator.scaleY})`,
                          height: `${historyGlide.indicator.height}px`,
                          opacity: historyGlide.indicator.opacity,
                        }}
                      />
                      {displayHistoryTracks.map((track) => (
                        <div
                          key={`hist-${track.id}`}
                          onClick={() => playTrack(track)}
                          onMouseEnter={historyGlide.handleItemMouseEnter}
                          style={rowTransitionStyle}
                          className="queue-track-row flex items-center gap-3 p-2 rounded-xl border border-transparent group active:scale-[0.98] cursor-pointer relative z-[1]"
                        >
                          <div className="w-9 h-9 rounded-lg bg-slate-800 border border-white/10 overflow-hidden shrink-0 relative flex items-center justify-center group/cover">
                            {track.cover_url ? (
                              <img src={track.cover_url} alt={track.title} className="w-full h-full object-cover" />
                            ) : (
                              <Music className="w-4 h-4 text-slate-500" />
                            )}
                            <div className="absolute inset-0 bg-black/40 opacity-0 [@media(hover:hover)]:group-hover/cover:opacity-100 flex items-center justify-center transition-opacity duration-150">
                              <Play className="w-3.5 h-3.5 text-white fill-current ml-0.5" />
                            </div>
                          </div>

                          <div className="flex flex-col min-w-0 flex-1">
                            <p className="text-xs font-semibold text-white truncate group-hover:text-[var(--spotify-glow,#22d3ee)] transition-colors duration-150">
                              {track.title}
                            </p>
                            <div className="text-[10px] text-slate-400 truncate mt-0.5">
                              <ArtistLinks artist={track.artist} fallbackText="Nghệ sĩ chưa xác định" className="text-[10px] text-slate-400 truncate" />
                            </div>
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
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
