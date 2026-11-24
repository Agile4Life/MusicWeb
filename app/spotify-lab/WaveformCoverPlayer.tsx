'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { ExternalLink, Loader2, Pause, Play, RotateCcw } from 'lucide-react'
import type { BattleTrack } from '@/lib/songBattleSources'
import { waveformPeaks } from '@/lib/audioWaveform'
import { TrackArtwork } from './TrackArtwork'
import styles from './lab.module.css'

const EMPTY_PEAKS = Array<number>(72).fill(0)
function time(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

export function WaveformCoverPlayer({ track, autoPlay = false }: { track: BattleTrack; autoPlay?: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const clipRectRef = useRef<SVGRectElement>(null)
  const playheadRef = useRef<HTMLSpanElement>(null)
  const clipId = useId().replaceAll(':', '')
  const reducedMotion = Boolean(useReducedMotion())
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(autoPlay)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(track.duration || 0)
  const [peaks, setPeaks] = useState(EMPTY_PEAKS)
  const isSoundCloud = track.source === 'soundcloud'
  const sourceLabel = isSoundCloud ? 'SoundCloud' : `MusicWeb · ${track.nhaccuatui_id ? 'NhacCuaTui' : track.drive_file_id ? 'Drive' : 'Stream'}`
  const src = isSoundCloud
    ? `/api/soundcloud/stream?id=${encodeURIComponent(track.soundcloud_id!)}`
    : track.stream_url || track.preview_url || ''

  const syncVisualProgress = useCallback((ratio: number) => {
    const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0
    if (clipRectRef.current) {
      clipRectRef.current.setAttribute('width', String(288 * clamped))
    }
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translate3d(${clamped * 100}%, 0, 0)`
    }
  }, [])

  const waveGroups = useMemo(() => {
    const bars = peaks.map((peak, index) => (
      <rect
        key={index}
        x={index * 4}
        y={28 - Math.max(2, peak * 26)}
        width="2.5"
        height={Math.max(4, peak * 52)}
        rx="1.25"
      />
    ))
    return (
      <>
        <g className={styles.soundcloudWaveBase}>{bars}</g>
        <g clipPath={`url(#${clipId})`} className={styles.soundcloudWavePlayed}>{bars}</g>
      </>
    )
  }, [peaks, clipId])

  useEffect(() => {
    if (playing && !reducedMotion) return
    syncVisualProgress(duration > 0 ? position / duration : 0)
  }, [position, duration, playing, reducedMotion, syncVisualProgress])

  useEffect(() => {
    if (!playing || reducedMotion) return
    let rafId = 0
    const tick = () => {
      const audio = audioRef.current
      if (audio) {
        const activeDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : duration
        syncVisualProgress(activeDuration > 0 ? audio.currentTime / activeDuration : 0)
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [playing, reducedMotion, duration, syncVisualProgress])

  useEffect(() => {
    const audio = audioRef.current
    if (audio) audio.src = src
    return () => {
      if (!audio) return
      audio.pause(); audio.removeAttribute('src'); audio.load()
    }
  }, [src])

  useEffect(() => {
    if (!started) return
    const abort = new AbortController()
    let context: AudioContext | undefined
    // Playback never waits for optional waveform decoding.
    void (async () => {
      try {
        const response = await fetch(src, { signal: abort.signal })
        if (!response.ok || abort.signal.aborted) return
        const bytes = await response.arrayBuffer()
        if (abort.signal.aborted) return
        context = new AudioContext()
        const buffer = await context.decodeAudioData(bytes)
        if (!abort.signal.aborted) setPeaks(waveformPeaks(buffer.getChannelData(0)))
      } catch { /* The neutral seek rail remains usable when decoding is unavailable. */ }
      finally { if (context && context.state !== 'closed') void context.close() }
    })()
    return () => { abort.abort() }
  }, [started, src])

  async function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (!audio.paused) { audio.pause(); return }
    if (error) { setError(false); audio.load() }
    setStarted(true); setLoading(true)
    try { await audio.play() }
    catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setLoading(false)
      if (!(cause instanceof DOMException && cause.name === 'NotAllowedError')) setError(true)
    }
  }

  return <div className={styles.soundcloudPlayer} role="group" aria-label={`Trình nghe ${sourceLabel}: ${track.title}`}>
    <div className={styles.soundcloudCover}>
      <TrackArtwork track={track} large />
      <span className={styles.soundcloudBadge}>{sourceLabel.toUpperCase()}</span>
      <div className={styles.soundcloudControls}>
        <div className={styles.soundcloudTransport}>
          <button type="button" className={styles.soundcloudPlay} onClick={() => void toggle()} aria-label={`${error ? 'Thử lại' : playing ? 'Tạm dừng' : 'Phát'} ${track.title}`}>
            {error ? (
              <span key="retry" className={styles.playIconSwap}><RotateCcw size={22} aria-hidden="true" /></span>
            ) : loading && !playing ? (
              <Loader2 size={22} className={styles.spin} aria-hidden="true" />
            ) : playing ? (
              <span key="pause" className={styles.playIconSwap}><Pause size={22} fill="currentColor" aria-hidden="true" /></span>
            ) : (
              <span key="play" className={styles.playIconSwap}><Play size={22} fill="currentColor" aria-hidden="true" /></span>
            )}
          </button>
          <span className={styles.soundcloudTime}>{time(position)} <span>/ {time(duration)}</span></span>
          {track.source_url && <a href={track.source_url} target="_blank" rel="noopener noreferrer" aria-label={`Mở bản gốc ${track.title}`}><ExternalLink size={17} aria-hidden="true" /></a>}
        </div>
        <div className={styles.soundcloudWave}>
          <svg viewBox="0 0 288 56" preserveAspectRatio="none" aria-hidden="true">
            <defs><clipPath id={clipId}><rect ref={clipRectRef} width="0" height="56" /></clipPath></defs>
            {waveGroups}
          </svg>
          <span className={`${styles.soundcloudPlayheadTrack} ${started && !error && (playing || position > 0) ? styles.soundcloudPlayheadVisible : ''}`} aria-hidden="true">
            <span ref={playheadRef} className={styles.soundcloudPlayhead} />
          </span>
          <input type="range" min="0" max={duration || 0} step="0.1" value={Math.min(position, duration)} disabled={!duration || !started || error} aria-label={`Tua ${track.title}`} aria-valuetext={`${time(position)} trên ${time(duration)}`} onChange={event => {
            const audio = audioRef.current
            if (!audio || audio.readyState < 1) return
            const next = Number(event.target.value)
            audio.currentTime = next
            setPosition(next)
            syncVisualProgress(duration > 0 ? next / duration : 0)
          }} />
        </div>
        <p className={styles.soundcloudStatus} role="status">{error ? 'Không tải được âm thanh. Nhấn thử lại hoặc mở bản gốc.' : loading ? 'Đang tải âm thanh…' : 'Bấm hoặc kéo trên sóng để tua'}</p>
      </div>
    </div>
    <audio ref={audioRef} src={src} preload="none" autoPlay={autoPlay} aria-label={`Âm thanh ${track.title}`} onPlay={event => {
      document.querySelectorAll('audio').forEach(audio => { if (audio !== event.currentTarget) audio.pause() })
      setPlaying(true); setStarted(true)
    }} onPlaying={() => setLoading(false)} onWaiting={() => setLoading(true)} onCanPlay={event => {
      const value = event.currentTarget.duration
      if (Number.isFinite(value)) setDuration(value)
      setLoading(false)
    }} onPause={() => { setPlaying(false); setLoading(false) }} onEnded={() => { setPlaying(false); setLoading(false) }} onTimeUpdate={event => setPosition(event.currentTarget.currentTime)} onError={() => { setError(true); setLoading(false); setPlaying(false) }} />
  </div>
}
