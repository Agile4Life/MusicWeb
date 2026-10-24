'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Disc3, Loader2, Plus, Search } from 'lucide-react'
import { fetchBattleTracks, type BattleTrack } from '@/lib/songBattleSources'
import { communityRequest } from './communityClient'
import styles from './lab.module.css'

interface Album { id: string; name: string; artist: string; cover_url: string | null }

export function AlbumSourcePicker({ onAdd }: { onAdd: (tracks: BattleTrack[]) => void }) {
  const [query, setQuery] = useState('')
  const [albums, setAlbums] = useState<Album[]>([])
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef<AbortController | null>(null)

  async function load(value: string) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true); setImporting(null); setError(''); setNotice('')
    try {
      const data = await communityRequest<Album[]>(value.trim()
        ? `/api/albums/search?q=${encodeURIComponent(value.trim())}` : '/api/albums/new-releases', { signal: controller.signal })
      if (!controller.signal.aborted) setAlbums(Array.isArray(data) ? data : [])
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Không tải được album.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  useEffect(() => {
    let disposed = false
    queueMicrotask(() => { if (!disposed) void load('') })
    return () => { disposed = true; request.current?.abort() }
  }, [])

  async function importAlbum(album: Album) {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setImporting(album.id); setBusy(false); setError(''); setNotice('')
    try {
      const tracks = await fetchBattleTracks(`/api/albums/${encodeURIComponent(album.id)}`, controller.signal)
      if (controller.signal.aborted) return
      if (!tracks.length) { setNotice('Album này chưa có bài hát có thể nhập.'); return }
      onAdd(tracks)
      setNotice(`Đã nhập ${tracks.length} bài từ album ${album.name}. Bạn có thể đăng bộ bài công khai.`)
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Không nhập được album.')
    } finally { if (!controller.signal.aborted) setImporting(null) }
  }

  return <section aria-label="Album trên MusicWeb">
    <p className={styles.description}>Chọn album từ thư viện trên web chính để tạo và đăng bộ bài công khai.</p>
    <form className={styles.inputRow} onSubmit={event => { event.preventDefault(); void load(query) }}>
      <Search size={18} aria-hidden="true" />
      <label className={styles.srOnly} htmlFor="battle-album-query">Tìm album trên MusicWeb</label>
      <input id="battle-album-query" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tên album hoặc nghệ sĩ…" />
      <button type="submit" className={styles.smallButton} disabled={busy}>Tìm album</button>
    </form>
    {busy ? <p role="status">Đang tải album…</p> : <div className={styles.results}>
      {albums.map((album, index) => <div key={album.id} className={styles.trackRow} style={{ '--row-index': Math.min(index, 10) } as CSSProperties}>
        <div className={styles.artwork}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {album.cover_url ? <img src={album.cover_url} alt="" loading="lazy" /> : <Disc3 aria-hidden="true" />}
        </div>
        <div className={styles.trackInfo}><strong>{album.name}</strong><span>{album.artist}</span></div>
        <button type="button" className={styles.addButton} disabled={Boolean(importing)} aria-label={`Thêm album ${album.name}`} onClick={() => void importAlbum(album)}>
          {importing === album.id ? <Loader2 size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
        </button>
      </div>)}
      {!albums.length && !error && <p>Không tìm thấy album. Thử tên album hoặc nghệ sĩ khác.</p>}
    </div>}
    {error && <p role="alert" className={styles.error}>{error} <button type="button" className={styles.textButton} onClick={() => void load(query)}>Thử lại</button></p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
  </section>
}
