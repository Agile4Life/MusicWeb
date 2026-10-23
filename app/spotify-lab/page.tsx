'use client'

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, Disc3, Headphones, ListMusic, Music2, X, Shuffle, Globe2 } from 'lucide-react'
import { createBattle, chooseWinner, undoChoice, type Battle } from '@/lib/songBattle'
import { mergeBattleTracks, type BattleTrack } from '@/lib/songBattleSources'
import { SourcePicker } from './SourcePicker'
import { BattleView } from './BattleView'
import { PreviewPlayer } from './PreviewPlayer'
import { TrackArtwork } from './TrackArtwork'
import { CommunityLibrary } from './CommunityLibrary'
import { PublishDeckDialog } from './PublishDeckDialog'
import { DeckShare } from './DeckShare'
import { getCommunityDeck } from './communityClient'
import { isDeckId, type CommunityDeck } from '@/lib/songBattleCommunity'
import { normalizeBattleTrack } from '@/lib/songBattleSources'
import styles from './lab.module.css'

const SIZES = [2, 4, 8, 16, 32, 64]

export default function SpotifyLabPage() {
  /* Override body overflow:hidden (set in globals.css for the (app) shell) so this standalone page scrolls. */
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'auto'
    return () => { document.body.style.overflow = prev }
  }, [])
  const router = useRouter()
  const [pool, setPool] = useState<BattleTrack[]>([])
  const [size, setSize] = useState(4)
  const [battle, setBattle] = useState<Battle<BattleTrack> | null>(null)
  const [current, setCurrent] = useState<BattleTrack | null>(null)
  const [exitPending, setExitPending] = useState(false)
  const [exitDestination, setExitDestination] = useState<string | null>(null)
  const [view, setView] = useState<'community' | 'builder'>('community')
  const [selectedDeck, setSelectedDeck] = useState<CommunityDeck | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [communityError, setCommunityError] = useState('')
  const [communityNotice, setCommunityNotice] = useState('')
  const deckRequest = useRef<AbortController | null>(null)
  const headingRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const matchVersion = battle?.history.length
  const inBattle = battle !== null

  const openDeck = useCallback(async (id: string) => {
    deckRequest.current?.abort()
    if (!isDeckId(id)) { setOpeningId(null); setCommunityError('Link bộ bài không hợp lệ.'); return }
    const controller = new AbortController()
    deckRequest.current = controller
    setOpeningId(id); setCommunityError(''); setCommunityNotice(''); setCurrent(null)
    try {
      const { deck } = await getCommunityDeck(id, controller.signal)
      if (controller.signal.aborted) return
      setSelectedDeck(deck); setPool(deck.tracks); setSize(deck.tracks.length >= 4 ? 4 : 2)
      setView('builder'); setBattle(null)
      window.history.replaceState(null, '', `/spotify-lab?deck=${deck.id}`)
    } catch (error) { if (!controller.signal.aborted) setCommunityError(error instanceof Error ? error.message : 'Không mở được bộ bài.') }
    finally { if (!controller.signal.aborted) setOpeningId(null) }
  }, [])

  useEffect(() => {
    let disposed = false
    queueMicrotask(() => {
      if (disposed) return
      const id = new URLSearchParams(window.location.search).get('deck')
      if (id) void openDeck(id)
      else {
        try {
          const saved = sessionStorage.getItem('musicweb-song-battle-draft')
          if (saved) {
            const parsed: unknown = JSON.parse(saved)
            if (Array.isArray(parsed)) {
              const tracks = parsed.map(normalizeBattleTrack).filter((track): track is BattleTrack => track !== null)
              if (tracks.length) { setPool(mergeBattleTracks([], tracks)); setView('builder'); setPublishOpen(true) }
            }
            sessionStorage.removeItem('musicweb-song-battle-draft')
          }
        } catch { /* A draft is optional when browser storage is unavailable. */ }
      }
    })
    return () => { disposed = true; deckRequest.current?.abort() }
  }, [openDeck])

  useEffect(() => {
    if (inBattle) {
      headingRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
      document.getElementById('match-title')?.focus({ preventScroll: true })
    }
  }, [matchVersion, inBattle])

  useEffect(() => {
    if (exitPending) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [exitPending])

  useEffect(() => {
    if (!battle || battle.champion) return
    function beforeUnload(event: BeforeUnloadEvent) { event.preventDefault() }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [battle])

  /* Lock body overflow when in active battle (full-viewport mode) */
  useEffect(() => {
    if (inBattle) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = 'auto' }
    }
  }, [inBattle])

  function preview(track: BattleTrack) {
    setCurrent(previous => previous?.id === track.id ? null : track)
    requestAnimationFrame(() => previewRef.current?.scrollIntoView({ block: 'nearest', behavior: 'instant' }))
  }
  function cancelDeckLoad() { deckRequest.current?.abort(); setOpeningId(null) }
  function start() { cancelDeckLoad(); setCurrent(null); setBattle(createBattle(pool, size)) }
  function choose(id: string, turn: number) {
    setCurrent(null)
    setBattle(previous => previous ? chooseWinner(previous, id, turn) : null)
  }
  function undo() { setCurrent(null); setBattle(previous => previous ? undoChoice(previous) : null) }
  function exit() {
    setExitDestination(null)
    if (battle && !battle.champion && battle.history.length) { setExitPending(true); return }
    setCurrent(null); setBattle(null)
  }
  function navigateHome(event: MouseEvent<HTMLAnchorElement>) {
    if (!battle || battle.champion || !battle.history.length || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    setExitDestination('/'); setExitPending(true)
  }

  return <main className={`${styles.root} ${inBattle ? styles.rootBattle : ''}`} data-theme-style="minimal-flat">
    <div className={styles.shell}>
      {/* Hide masthead + hero + shared deck when in active battle */}
      {!inBattle && <>
        <nav className={styles.masthead} aria-label="Điều hướng Spotify Lab">
          <Link href="/" className={styles.wordmark} onClick={navigateHome}><Disc3 size={21} aria-hidden="true" /> music<span>/ lab</span></Link>
          <span className={styles.mastheadNote}>A LITTLE LESS SCROLL. A LITTLE MORE SOUL.</span>
          <Link href="/" className={styles.backLink} onClick={navigateHome}><ArrowLeft size={15} aria-hidden="true" /> MusicWeb</Link>
        </nav>
        <header className={styles.hero}>
          <div><span className={styles.eyebrow}><span className={styles.statusDot} /> SPOTIFY LAB / ĐỌ NHẠC</span>
            <h1>Hai bài hát.<br />{' '}Một <em>lựa chọn.</em></h1>
          </div>
          <div className={styles.heroAside}><p>Đôi khi, gu nhạc chỉ cần một câu trả lời.<br />{' '}Nghe thử, chọn bài bạn yêu hơn và tìm ra<br className={styles.desktopBreak} /> ca khúc đứng đầu playlist của riêng mình.</p><span className={styles.heroFootnote}><Headphones size={14} aria-hidden="true" /> Đeo tai nghe. Tin cảm xúc.</span></div>
        </header>
        <nav className={styles.modeNav} aria-label="Chế độ Spotify Lab">
          <button type="button" aria-pressed={view === 'community'} onClick={() => { cancelDeckLoad(); setView('community'); setCurrent(null) }}><Globe2 size={16} aria-hidden="true" /> Bộ bài cộng đồng</button>
          <button type="button" aria-pressed={view === 'builder'} onClick={() => { cancelDeckLoad(); setView('builder'); setCurrent(null) }}><Headphones size={16} aria-hidden="true" /> Tạo cuộc đấu</button>
        </nav>
        {communityError && <p role="alert" className={styles.error}>{communityError}</p>}
        {communityNotice && <p role="status" className={styles.notice}>{communityNotice}</p>}
        {openingId && <p role="status" className={styles.feedback}>Đang mở bộ bài…</p>}
        {selectedDeck && view === 'builder' && <section className={styles.sharedDeck} aria-label="Bộ bài đang chơi">
          <div><span className={styles.eyebrow}>BỘ BÀI CỘNG ĐỒNG</span><h2>{selectedDeck.name}</h2><p>bởi {selectedDeck.creator_name} · {selectedDeck.track_count} bài</p>{selectedDeck.description && <p>{selectedDeck.description}</p>}</div>
          <DeckShare key={selectedDeck.id} id={selectedDeck.id} />
        </section>}
      </>}
      <div ref={headingRef} className={styles.contentAnchor}>
        {battle ? <BattleView battle={battle} currentId={current?.id} onPreview={preview} onChoose={choose} onUndo={undo}
          onReplay={() => { setCurrent(null); setBattle(createBattle(battle.entrants, battle.entrants.length)) }} onExit={exit} />
          : view === 'community' ? <CommunityLibrary openingId={openingId} onOpen={id => { void openDeck(id) }}
            onCreate={() => { cancelDeckLoad(); setSelectedDeck(null); setView('builder'); setCurrent(null); window.history.replaceState(null, '', '/spotify-lab') }}
            onDeleted={id => { if (selectedDeck?.id === id) { setSelectedDeck(null); window.history.replaceState(null, '', '/spotify-lab') } }} />
          : <div className={styles.setupGrid}>
            <SourcePicker selected={pool} onAdd={tracks => setPool(previous => mergeBattleTracks(previous, tracks))} onPreview={preview} />
            <aside className={styles.poolPanel} aria-labelledby="pool-title">
              <div className={styles.poolHeading}><span className={styles.eyebrow}>02 / DANH SÁCH THI ĐẤU</span><ListMusic size={21} strokeWidth={1.4} aria-hidden="true" /></div>
              <div className={styles.poolTitle}><h2 id="pool-title">Sân khấu của bạn.</h2><span>{pool.length} bài đã chọn</span></div>
              {pool.length ? <>
                <div className={styles.poolActions}><span>Các bài trùng được tự động bỏ qua.</span><button type="button" onClick={() => { setCurrent(null); setPool([]) }}>Xóa tất cả</button></div>
                <ol className={styles.poolList}>{pool.map((track, index) => <li key={track.id}>
                  <span className={styles.poolIndex}>{String(index + 1).padStart(2, '0')}</span><TrackArtwork track={track} />
                  <div className={styles.trackInfo}><strong>{track.title}</strong><span>{track.artist} <small>· {track.source}</small></span></div>
                  <button type="button" className={styles.iconButton} aria-label={`Xóa ${track.title}`} onClick={() => { setPool(previous => previous.filter(item => item.id !== track.id)); if (current?.id === track.id) setCurrent(null) }}><X size={15} aria-hidden="true" /></button>
                </li>)}</ol>
              </> : <div className={styles.poolEmpty}><Music2 size={29} strokeWidth={1.2} aria-hidden="true" /><p>Chưa có bài hát nào.</p><span>Thêm ít nhất 2 bài để mở màn.</span></div>}
              <div className={styles.roundSetup}><label id="round-size-label">Quy mô cuộc đấu</label><div className={styles.sizeOptions} role="group" aria-labelledby="round-size-label">{SIZES.map(value => <button key={value} type="button" aria-pressed={size === value} disabled={pool.length < value} onClick={() => setSize(value)}>{value} bài</button>)}</div>
                <p className={styles.finePrint}><Shuffle size={13} aria-hidden="true" /> Ghép cặp ngẫu nhiên{pool.length > size ? ` · Lấy ${size} trong ${pool.length} bài` : ''}</p>
                <button type="button" className={styles.startButton} onClick={start} disabled={pool.length < size}>Bắt đầu đọ nhạc <ArrowRight size={18} aria-hidden="true" /></button>
                <p className={styles.startHint}>{pool.length < size ? `Thêm ${size - pool.length} bài nữa hoặc chọn quy mô nhỏ hơn.` : `${size - 1} lựa chọn để tìm ra bài hát vô địch.`}</p>
                <div className={styles.publishPrompt}><button type="button" className={styles.secondaryButton} disabled={pool.length < 2} onClick={() => setPublishOpen(true)}><Globe2 size={16} aria-hidden="true" /> {selectedDeck?.is_owner ? 'Cập nhật bộ bài' : 'Đăng bộ bài'}</button><p className={styles.finePrint}>{selectedDeck?.is_owner ? 'Lưu thay đổi để mọi người chơi phiên bản mới.' : 'Lưu gu nhạc của bạn để mọi người cùng chơi.'}</p></div>
              </div>
            </aside>
          </div>}
      </div>
      {!inBattle && <div ref={previewRef} className={styles.previewAnchor}>{current && <PreviewPlayer key={current.id} track={current} onClose={() => setCurrent(null)} />}</div>}
      <footer className={styles.footer}><span>GOOD MUSIC. TOUGH CHOICES.</span><span>Made for your ears, by MusicWeb.</span></footer>
    </div>
    {publishOpen && <PublishDeckDialog tracks={pool} editing={selectedDeck?.is_owner ? selectedDeck : null} onClose={() => setPublishOpen(false)}
      onPreserveDraft={() => { try { sessionStorage.setItem('musicweb-song-battle-draft', JSON.stringify(pool)) } catch { /* Browser storage can be unavailable. */ } }}
      onSaved={(deck, updated) => { setSelectedDeck(deck); setPublishOpen(false); setCommunityNotice(updated ? 'Đã cập nhật bộ bài.' : 'Bộ bài đã được đăng công khai.'); window.history.replaceState(null, '', `/spotify-lab?deck=${deck.id}`) }} />}
    <dialog ref={dialogRef} className={styles.dialog} onCancel={() => setExitPending(false)} onClose={() => setExitPending(false)}>
      <h2>Rời cuộc đấu?</h2><p>{exitDestination ? 'Các bài đã thêm và tiến trình cuộc đấu sẽ mất khi rời trang.' : 'Các bài đã thêm vẫn được giữ. Tiến trình cuộc đấu hiện tại sẽ kết thúc.'}</p>
      <div><button type="button" className={styles.secondaryButton} onClick={() => setExitPending(false)}>Chơi tiếp</button><button type="button" className={styles.primaryButton} onClick={() => { setExitPending(false); setCurrent(null); if (exitDestination) router.push(exitDestination); else setBattle(null) }}>{exitDestination ? 'Rời trang' : 'Về danh sách'}</button></div>
    </dialog>
  </main>
}
