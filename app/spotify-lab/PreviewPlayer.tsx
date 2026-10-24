'use client'

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, X, Headphones } from 'lucide-react'
import type { BattleTrack } from '@/lib/songBattleSources'
import styles from './lab.module.css'
import { WaveformCoverPlayer } from './WaveformCoverPlayer'

interface SpotifyController { play(): void; pause(): void; destroy(): void; addListener(event: 'ready', listener: () => void): void }
interface SpotifyApi {
  createController(element: HTMLElement, options: { uri: string; width: string; height: number }, callback: (controller: SpotifyController) => void): void
}
type SpotifyWindow = Window & { onSpotifyIframeApiReady?: (api: SpotifyApi) => void; SpotifyIframeApi?: SpotifyApi }
let apiPromise: Promise<SpotifyApi> | null = null

function loadSpotifyApi(): Promise<SpotifyApi> {
  const spotifyWindow = window as SpotifyWindow
  if (spotifyWindow.SpotifyIframeApi) return Promise.resolve(spotifyWindow.SpotifyIframeApi)
  if (apiPromise) return apiPromise
  apiPromise = new Promise<SpotifyApi>((resolve, reject) => {
    const timeout = setTimeout(() => { apiPromise = null; reject(new Error('Spotify đang phản hồi chậm.')) }, 8000)
    spotifyWindow.onSpotifyIframeApiReady = api => {
      clearTimeout(timeout)
      spotifyWindow.SpotifyIframeApi = api
      resolve(api)
    }
    let script = document.getElementById('spotify-iframe-api') as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = 'spotify-iframe-api'
      script.src = 'https://open.spotify.com/embed/iframe-api/v1'
      script.async = true
      script.onerror = () => { clearTimeout(timeout); apiPromise = null; script?.remove(); reject(new Error('Không tải được Spotify.')) }
      document.body.appendChild(script)
    }
  })
  return apiPromise
}

function SpotifyPreview({ track }: { track: BattleTrack }) {
  const host = useRef<HTMLDivElement>(null)
  const [fallback, setFallback] = useState(false)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (fallback) return
    let disposed = false
    let controller: SpotifyController | null = null
    // createController replaces its element. Keep React's host intact.
    const mount = document.createElement('div')
    host.current?.appendChild(mount)
    let timer: ReturnType<typeof setTimeout> | undefined
    loadSpotifyApi().then(api => {
      if (disposed) return
      timer = setTimeout(() => { if (!disposed) setFallback(true) }, 15000)
      api.createController(mount, { uri: `spotify:track:${track.spotify_id}`, width: '100%', height: 152 }, next => {
        if (disposed) { next.destroy(); return }
        controller = next
        host.current?.querySelector('iframe')?.setAttribute('title', `Spotify: ${track.title}`)
        next.addListener('ready', () => {
          if (disposed) return
          clearTimeout(timer); setReady(true)
          try { next.play() } catch { /* Native embed controls remain available. */ }
        })
      })
    }).catch(() => { if (!disposed) setFallback(true) })
    return () => {
      disposed = true; clearTimeout(timer)
      try { controller?.pause(); controller?.destroy() } catch { /* Already detached by provider. */ }
      mount.remove()
    }
  }, [track.spotify_id, track.title, fallback])
  return <>
    {!ready && <p role="status" className={styles.previewLoading}>Đang tải trình nghe Spotify…</p>}
    {fallback ? <iframe title={`Spotify: ${track.title}`} src={`https://open.spotify.com/embed/track/${encodeURIComponent(track.spotify_id!)}?theme=0`} width="100%" height="152" allow="autoplay; encrypted-media" onLoad={() => setReady(true)} /> : <div ref={host} className={styles.spotifyHost} />}
  </>
}

export function PreviewPlayer({ track, onClose }: { track: BattleTrack; onClose: () => void }) {
  const [audioError, setAudioError] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioUrl = track.preview_url || (track.source === 'musicweb' ? track.stream_url : null)
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !audioUrl || audioError) return
    audio.src = audioUrl
    void audio.play().catch(() => { /* A user can resume with native controls. */ })
    return () => { audio.pause(); audio.removeAttribute('src'); audio.load() }
  }, [audioUrl, audioError])
  return <aside className={styles.preview} aria-label="Trình nghe thử">
    <div className={styles.previewHeading}>
      <Headphones size={17} aria-hidden="true" />
      <div><span className={styles.eyebrow}>ĐANG NGHE THỬ / {track.source.toUpperCase()}</span><strong>{track.title} <span>— {track.artist}</span></strong></div>
      <button type="button" className={styles.iconButton} onClick={onClose} aria-label="Đóng trình nghe thử"><X size={19} aria-hidden="true" /></button>
    </div>
    {(track.source === 'soundcloud' && track.soundcloud_id) || (track.source === 'musicweb' && (track.stream_url || track.preview_url)) ? <WaveformCoverPlayer track={track} autoPlay />
      : audioUrl && !audioError ? <audio ref={audioRef} controls autoPlay src={audioUrl} onError={() => setAudioError(true)} aria-label={`Nghe thử ${track.title}`} />
      : track.source === 'spotify' ? <SpotifyPreview track={track} />
        : track.source === 'youtube' ? <iframe title={`YouTube: ${track.title}`} src={`https://www.youtube.com/embed/${encodeURIComponent(track.youtube_id!)}?autoplay=1&rel=0&end=30`} width="100%" height="190" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen />
          : <p role="alert" className={styles.error}>Không phát được bài này. Nguồn nhạc có thể đã hết hạn hoặc cần quyền truy cập.</p>}
    <p className={styles.previewHint}>{track.source === 'soundcloud' || track.source === 'musicweb' ? 'Nhấn phát trên ảnh bìa và kéo trên sóng để tua bài hát.' : 'Nhấn phát trong trình nghe nếu nhạc chưa bắt đầu. Đoạn nghe và khả năng phát tùy thuộc nguồn cung cấp.'}
      {track.source_url && <a href={track.source_url} target="_blank" rel="noopener noreferrer">Mở bản gốc <ExternalLink size={12} aria-hidden="true" /></a>}
    </p>
  </aside>
}
