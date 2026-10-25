'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { Headphones, ArrowRight, Trophy, RotateCcw, Undo2, ArrowLeft, Check } from 'lucide-react'
import { currentPair, roundLabel, type Battle } from '@/lib/songBattle'
import type { BattleTrack } from '@/lib/songBattleSources'
import { TrackArtwork } from './TrackArtwork'
import { WaveformCoverPlayer } from './WaveformCoverPlayer'
import styles from './lab.module.css'

const CHOOSE_DELAY = 2000
type Choice = { id: string; turn: number; x: number; y: number }

export function BattleView({ battle, currentId, onPreview, onChoose, onUndo, onReplay, onExit }: {
  battle: Battle<BattleTrack>
  currentId?: string
  onPreview: (track: BattleTrack) => void
  onChoose: (id: string, turn: number) => void
  onUndo: () => void
  onReplay: () => void
  onExit: () => void
}) {
  const pair = currentPair(battle)
  const total = battle.entrants.length - 1
  const [choice, setChoice] = useState<Choice | null>(null)
  const choosingId = choice?.turn === battle.history.length ? choice.id : null
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingChoice = useRef<Choice | null>(null)
  const lastClick = useRef<number | null>(null)

  // Cancel the previous turn's delayed choice when the match changes or unmounts.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      pendingChoice.current = null
      lastClick.current = null
    }
  }, [battle.history.length])

  const finishChoice = useCallback(() => {
    const selected = pendingChoice.current
    if (!selected) return
    pendingChoice.current = null
    lastClick.current = null
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setChoice(null)
    onChoose(selected.id, selected.turn)
  }, [onChoose])

  const handleChoose = useCallback((trackId: string, turn: number, event: MouseEvent<HTMLButtonElement>) => {
    if (pendingChoice.current) return
    const card = event.currentTarget.closest('article')!.getBoundingClientRect()
    const selected = { id: trackId, turn, x: innerWidth / 2 - card.x - card.width / 2, y: innerHeight / 2 - card.y - card.height / 2 }
    pendingChoice.current = selected
    setChoice(selected)
    timerRef.current = setTimeout(finishChoice, CHOOSE_DELAY)
  }, [finishChoice])

  function contestantClass(trackId: string) {
    if (!choosingId) return styles.contestant
    if (trackId === choosingId) return `${styles.contestant} ${styles.contestantWinner}`
    return `${styles.contestant} ${styles.contestantLoser}`
  }

  return <section className={`${styles.battleSection} ${choosingId ? styles.battleChoosing : ''}`} aria-label="Cuộc đấu âm nhạc" onClickCapture={event => {
    // Capture both clicks even when the card moves between taps. Consuming the
    // second click prevents it from selecting a song in the following match.
    const now = performance.now()
    if (pendingChoice.current && lastClick.current !== null && now - lastClick.current < 350) {
      event.preventDefault(); event.stopPropagation(); finishChoice()
    } else lastClick.current = now
  }}>
    {choosingId && <div className={styles.choiceSkip}>
      <span role="status">Đã chọn · Nhấp đúp để chuyển tiếp</span>
      <button type="button" onClick={finishChoice} aria-label="Bỏ qua chuyển cảnh">Bỏ qua <ArrowRight size={14} aria-hidden="true" /></button>
    </div>}
    <div className={styles.battleToolbar}>
      <button type="button" className={styles.textButton} onClick={onExit}><ArrowLeft size={16} aria-hidden="true" /> Về danh sách</button>
      <span className={styles.eyebrow}>{battle.entrants.length} BÀI / {battle.history.length} TRÊN {total} LỰA CHỌN</span>
      <button type="button" className={styles.textButton} disabled={!battle.history.length || !!choosingId} onClick={onUndo} aria-label="Quay lại lựa chọn trước"><Undo2 size={16} aria-hidden="true" /> Chọn lại</button>
    </div>
    <progress className={styles.progress} value={battle.history.length} max={total} aria-label="Tiến độ cuộc đấu" />
    {pair ? <>
      <header className={styles.matchHeading} aria-live="polite" aria-atomic="true">
        <span className={styles.eyebrow}>NGHE BẰNG TAI. CHỌN BẰNG CẢM XÚC.</span>
        <h2 tabIndex={-1} id="match-title">{roundLabel(battle.round.length)}</h2>
        <p>Trận {battle.match + 1} / {battle.round.length / 2} <span>·</span> Bài nào xứng đáng đi tiếp?</p>
      </header>
      <div className={`${styles.matchGrid} ${choosingId ? styles.matchGridChoosing : ''}`} key={battle.history.length}>
        {pair.map((track, index) => <article className={contestantClass(track.id)} key={track.id} style={choosingId === track.id && choice ? { '--winner-x': `${choice.x}px`, '--winner-y': `${choice.y}px` } as CSSProperties : undefined}>
          <div className={styles.contestantLabel}><span>LỰA CHỌN {index === 0 ? 'A' : 'B'}</span><span>{track.source}</span></div>
          <div className={styles.contestantHeader}>
            <TrackArtwork track={track} />
            <div className={styles.contestantMeta}><h3>{track.title}</h3><p>{track.artist}</p></div>
          </div>
          {track.source === 'youtube' && track.youtube_id ? (
            <div className={styles.contestantEmbed}>
              <iframe title={`YouTube: ${track.title}`} src={`https://www.youtube.com/embed/${encodeURIComponent(track.youtube_id)}?rel=0`} width="100%" height="480" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowFullScreen />
            </div>
          ) : track.source === 'spotify' && track.spotify_id ? (
            <div className={styles.contestantEmbed}>
              <iframe title={`Spotify: ${track.title}`} src={`https://open.spotify.com/embed/track/${encodeURIComponent(track.spotify_id)}?theme=0`} width="100%" height="280" allow="autoplay; encrypted-media" />
            </div>
          ) : track.source === 'soundcloud' && track.soundcloud_id ? (
            <div className={`${styles.contestantEmbed} ${styles.contestantCoverEmbed}`}><WaveformCoverPlayer track={track} /></div>
          ) : track.source === 'musicweb' && track.stream_url ? (
            <div className={`${styles.contestantEmbed} ${styles.contestantCoverEmbed}`}><WaveformCoverPlayer track={track} /></div>
          ) : (
            <div className={`${styles.contestantEmbed} ${styles.contestantCoverEmbed}`}>
              <button type="button" className={styles.coverButton} onClick={() => onPreview(track)} aria-label={`Nghe thử ${track.title}`}>
                <TrackArtwork track={track} large />
                <span className={styles.coverListen}><Headphones size={18} aria-hidden="true" /> {currentId === track.id ? 'Đang mở trình nghe' : 'Nghe thử'}</span>
              </button>
            </div>
          )}
          <button type="button" className={styles.chooseButton} aria-disabled={!!choosingId} onClick={event => handleChoose(track.id, battle.history.length, event)} aria-label={`Chọn bài ${track.title}`}>
            {choosingId === track.id ? <><Check size={17} aria-hidden="true" /> Đã chọn</> : <>Chọn bài này <ArrowRight size={17} aria-hidden="true" /></>}
          </button>
        </article>)}
        <span className={`${styles.vs} ${choosingId ? styles.vsExit : ''}`} aria-hidden="true">vs.</span>
      </div>
    </> : battle.champion ? <>
      <div className={styles.champion}>
        <div className={styles.championConfetti} aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => <span key={i} className={styles.confettiPiece} style={{ '--i': i } as React.CSSProperties} />)}
        </div>
        <span className={styles.championMedal}><Trophy size={25} strokeWidth={1.4} aria-hidden="true" /></span>
        <span className={styles.eyebrow}>BÀI HÁT VÔ ĐỊCH</span>
        <h2 id="match-title" tabIndex={-1}>Gu nhạc đã lên tiếng.</h2>
        <div className={styles.championArtwork}><TrackArtwork track={battle.champion} large /></div>
        <h3>{battle.champion.title}</h3><p>{battle.champion.artist}</p>
        <div className={styles.championActions}>
          <button type="button" className={styles.primaryButton} onClick={() => onPreview(battle.champion!)}><Headphones size={17} aria-hidden="true" /> Nghe lại bài thắng</button>
          <button type="button" className={styles.secondaryButton} onClick={onReplay}><RotateCcw size={17} aria-hidden="true" /> Chơi lại</button>
        </div>
        <p className={styles.finePrint}>{battle.entrants.length} bài hát. {total} lựa chọn. Một bài dành cho bạn.</p>
      </div>
      <details className={styles.history}>
        <summary>Hành trình đến ngôi vô địch <span>{total} trận</span></summary>
        <ol>{battle.history.map((choice, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span><div><small>{roundLabel(choice.roundSize)} · {choice.left.title} / {choice.right.title}</small><strong>{choice.winner.title}</strong></div><Trophy size={15} aria-label="Bài đi tiếp" /></li>)}</ol>
      </details>
    </> : null}
  </section>
}
