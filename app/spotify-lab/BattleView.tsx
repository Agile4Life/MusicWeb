'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Headphones, ArrowRight, Trophy, RotateCcw, Undo2, ArrowLeft, Sparkles } from 'lucide-react'
import { currentPair, roundLabel, type Battle } from '@/lib/songBattle'
import type { BattleTrack } from '@/lib/songBattleSources'
import { TrackArtwork } from './TrackArtwork'
import styles from './lab.module.css'

const CHOOSE_DELAY = 750

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
  const [choosingId, setChoosingId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear choosing state when battle state changes (new pair appears)
  useEffect(() => {
    setChoosingId(null)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [battle.history.length])

  const handleChoose = useCallback((trackId: string, turn: number) => {
    if (choosingId) return // prevent double-click during animation
    setChoosingId(trackId)
    timerRef.current = setTimeout(() => {
      onChoose(trackId, turn)
    }, CHOOSE_DELAY)
  }, [choosingId, onChoose])

  function contestantClass(trackId: string) {
    if (!choosingId) return styles.contestant
    if (trackId === choosingId) return `${styles.contestant} ${styles.contestantWinner}`
    return `${styles.contestant} ${styles.contestantLoser}`
  }

  return <section className={styles.battleSection} aria-label="Cuộc đấu âm nhạc">
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
        {pair.map((track, index) => <article className={contestantClass(track.id)} key={track.id}>
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
          ) : track.source === 'musicweb' && track.stream_url ? (
            <div className={styles.contestantEmbed}>
              <div className={styles.musicwebPlayer}>
                <TrackArtwork track={track} large />
                <audio controls autoPlay src={track.stream_url} aria-label={`Nghe ${track.title}`} />
                <span className={styles.musicwebLabel}>MusicWeb · {track.nhaccuatui_id ? 'NhacCuaTui' : track.drive_file_id ? 'Drive' : 'Stream'}</span>
              </div>
            </div>
          ) : (
            <button type="button" className={styles.coverButton} onClick={() => onPreview(track)} aria-label={`Nghe thử ${track.title}`}>
              <TrackArtwork track={track} large />
              <span className={styles.coverListen}><Headphones size={18} aria-hidden="true" /> {currentId === track.id ? 'Đang mở trình nghe' : 'Nghe thử'}</span>
            </button>
          )}
          <button type="button" className={styles.chooseButton} disabled={!!choosingId} onClick={() => handleChoose(track.id, battle.history.length)} aria-label={`Chọn bài ${track.title}`}>
            {choosingId === track.id ? <><Sparkles size={17} aria-hidden="true" /> Đã chọn!</> : <>Chọn bài này <ArrowRight size={17} aria-hidden="true" /></>}
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
