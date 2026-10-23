'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, Link2, Plus, Check, Headphones, ArrowUpRight, Loader2 } from 'lucide-react'
import { fetchBattleTracks, playlistEndpoint, type BattleTrack } from '@/lib/songBattleSources'
import { TrackArtwork } from './TrackArtwork'
import styles from './lab.module.css'

const SEEDS = ['Vũ.', 'Billie Eilish', 'SOOBIN', 'Frank Ocean', 'Radiohead']
export function SourcePicker({ selected, onAdd, onPreview }: {
  selected: BattleTrack[]
  onAdd: (tracks: BattleTrack[]) => void
  onPreview: (track: BattleTrack) => void
}) {
  const [mode, setMode] = useState<'search' | 'playlist'>('search')
  const [query, setQuery] = useState('')
  const [url, setUrl] = useState('')
  const [results, setResults] = useState<BattleTrack[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const request = useRef<AbortController | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedRef = useRef(selected)
  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => () => { request.current?.abort(); if (debounce.current) clearTimeout(debounce.current) }, [])

  async function search(value: string) {
    request.current?.abort()
    if (debounce.current) clearTimeout(debounce.current)
    setError(''); setNotice('')
    if (!value.trim()) { setResults([]); setBusy(false); return }
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      const tracks = await fetchBattleTracks(`/api/spotify/search?q=${encodeURIComponent(value.trim())}&limit=10`, controller.signal)
      if (controller.signal.aborted) return
      setResults(tracks)
      if (!tracks.length) setNotice('Không tìm thấy bài hát. Thử tên bài hoặc nghệ sĩ khác nhé.')
    } catch (err) {
      if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : 'Không tìm kiếm được.'); setResults([]) }
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  function changeQuery(value: string) {
    setQuery(value)
    request.current?.abort()
    setBusy(false)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => { void search(value) }, 400)
  }

  function changeMode(next: typeof mode) {
    request.current?.abort()
    if (debounce.current) clearTimeout(debounce.current)
    setBusy(false); setMode(next); setError(''); setNotice('')
  }

  async function importPlaylist() {
    setError(''); setNotice('')
    let endpoint: string
    try { endpoint = playlistEndpoint(url) } catch (err) { setError((err as Error).message); return }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    try {
      const tracks = await fetchBattleTracks(endpoint, controller.signal)
      if (controller.signal.aborted) return
      if (!tracks.length) throw new Error('Playlist không có bài phát được hoặc đang riêng tư. Thử playlist công khai khác.')
      const ids = new Set(selectedRef.current.map(track => track.id))
      const count = tracks.filter(track => !ids.has(track.id)).length
      onAdd(tracks)
      setNotice(count ? `Đã thêm ${count} bài mới` : 'Các bài trong playlist này đã có trong danh sách.')
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Không nhập được playlist.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  const selectedIds = new Set(selected.map(track => track.id))
  return <section className={styles.sourcePanel} aria-labelledby="source-title">
    <div className={styles.sectionHeading}><span className={styles.eyebrow}>01 / TUYỂN CHỌN</span><h2 id="source-title">Bắt đầu từ gu nhạc của bạn.</h2></div>
    <div className={styles.tabs} aria-label="Nguồn bài hát">
      <button type="button" aria-pressed={mode === 'search'} onClick={() => changeMode('search')}><Search size={16} aria-hidden="true" /> Tìm bài hát</button>
      <button type="button" aria-pressed={mode === 'playlist'} onClick={() => changeMode('playlist')}><Link2 size={16} aria-hidden="true" /> Nhập playlist</button>
    </div>
    {mode === 'search' ? <>
      <form className={styles.inputRow} onSubmit={event => { event.preventDefault(); void search(query) }}>
        <label className={styles.srOnly} htmlFor="song-query">Tìm bài hát</label>
        <Search size={19} aria-hidden="true" />
        <input id="song-query" value={query} onChange={event => changeQuery(event.target.value)} placeholder="Tên bài hát hoặc nghệ sĩ…" autoComplete="off" />
        <button type="submit" className={styles.smallButton} disabled={!query.trim()}>Tìm kiếm</button>
      </form>
      <div className={styles.seeds}><span>Thử nghe</span>{SEEDS.map(seed => <button key={seed} type="button" onClick={() => { setQuery(seed); void search(seed) }}>{seed}</button>)}</div>
    </> : <>
      <p className={styles.description}>Mang playlist yêu thích vào cuộc đấu. Hỗ trợ Spotify, YouTube và SoundCloud.</p>
      <form className={styles.importForm} onSubmit={event => { event.preventDefault(); void importPlaylist() }}>
        <label htmlFor="playlist-link" className={styles.srOnly}>Link playlist</label>
        <input id="playlist-link" type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="Dán link playlist công khai…" />
        <button type="submit" className={styles.primaryButton} disabled={busy || !url.trim()}>{busy ? <Loader2 size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />} {busy ? 'Đang nhập…' : 'Thêm playlist'}</button>
      </form>
      <p className={styles.finePrint}>Bài được thêm vào ván chơi này. Thư viện cá nhân của bạn không thay đổi.</p>
    </>}
    {busy && <p role="status" className={styles.feedback}><Loader2 size={16} aria-hidden="true" /> {mode === 'search' ? 'Đang tìm bài hát…' : 'Đang lấy bài từ playlist…'}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    {mode === 'search' && results.length > 0 ? <div className={styles.results} aria-label="Kết quả tìm kiếm" aria-busy={busy}>
      <div className={styles.listHeading}><span>{results.length} KẾT QUẢ</span><button type="button" onClick={() => onAdd(results)}><Plus size={14} aria-hidden="true" /> Thêm tất cả</button></div>
      {results.map(track => {
        const added = selectedIds.has(track.id)
        return <div key={track.id} className={styles.trackRow}>
          <TrackArtwork track={track} />
          <div className={styles.trackInfo}><strong>{track.title}</strong><span>{track.artist}</span></div>
          <button type="button" className={styles.iconButton} aria-label={`Nghe thử ${track.title}`} title="Nghe thử" onClick={() => onPreview(track)}><Headphones size={18} aria-hidden="true" /></button>
          <button type="button" className={styles.addButton} disabled={added} aria-label={`${added ? 'Đã thêm' : 'Thêm'} ${track.title}`} onClick={() => onAdd([track])}>{added ? <Check size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}</button>
        </div>
      })}
    </div> : mode === 'search' && !busy && !error && !notice ? <div className={styles.sourceEmpty}>
      <Headphones size={32} strokeWidth={1.2} aria-hidden="true" /><h3>Một bài hay. Một đối thủ xứng tầm.</h3><p>Tìm vài bài bạn thích hoặc nhập cả playlist.<br />Nghe thử trước, quyết định sau.</p>
      <button type="button" onClick={() => changeMode('playlist')}>Khám phá từ playlist <ArrowUpRight size={16} aria-hidden="true" /></button>
    </div> : null}
  </section>
}
