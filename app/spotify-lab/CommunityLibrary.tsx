'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { ArrowRight, ChevronLeft, ChevronRight, Disc3, ListMusic, Plus, Search, Trash2, UserRound } from 'lucide-react'
import type { CommunityDeckSummary } from '@/lib/songBattleCommunity'
import { communityRequest, listCommunityDecks } from './communityClient'
import styles from './lab.module.css'

export function CommunityLibrary({ onOpen, onCreate, onDeleted, openingId }: {
  onOpen: (id: string) => void
  onCreate: () => void
  onDeleted: (id: string) => void
  openingId: string | null
}) {
  const { status } = useSession()
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [decks, setDecks] = useState<CommunityDeckSummary[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(12)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<CommunityDeckSummary | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const activeMine = mine && status === 'authenticated'

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setBusy(true); setError('')
      try {
        const data = await listCommunityDecks(search, page, activeMine, controller.signal)
        if (controller.signal.aborted) return
        setDecks(data.decks); setTotal(data.total); setPageSize(data.pageSize)
        if (page > 1 && data.total <= (page - 1) * data.pageSize) setPage(Math.max(1, Math.ceil(data.total / data.pageSize)))
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Không tải được thư viện.') }
      finally { if (!controller.signal.aborted) setBusy(false) }
    }
    void load()
    return () => controller.abort()
  }, [search, page, activeMine, revision])
  useEffect(() => {
    if (deleting && !dialog.current?.open) dialog.current?.showModal()
    else if (!deleting) dialog.current?.close()
  }, [deleting])

  async function remove() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true); setDeleteError('')
    try {
      await communityRequest(`/api/song-battles/${deleting.id}`, { method: 'DELETE' })
      onDeleted(deleting.id); setDeleting(null); setRevision(value => value + 1)
    } catch (err) { setDeleteError(err instanceof Error ? err.message : 'Không xóa được bộ bài.') }
    finally { setDeleteBusy(false) }
  }
  const pages = Math.max(1, Math.ceil(total / pageSize))

  return <section className={styles.library} aria-labelledby="library-title">
    <header className={styles.libraryHeading}><div><span className={styles.eyebrow}>TỪ PLAYLIST CỦA MỌI NGƯỜI</span><h2 id="library-title">Gu nhạc, cùng chia sẻ.</h2><p>Chọn một bộ bài. Tìm bài hát vô địch của riêng bạn.</p></div><button type="button" className={styles.primaryButton} onClick={onCreate}><Plus size={17} aria-hidden="true" /> Tạo bộ bài</button></header>
    <div className={styles.libraryToolbar}>
      <form className={styles.inputRow} onSubmit={event => { event.preventDefault(); setPage(1); setSearch(query.trim()); setRevision(value => value + 1) }}><Search size={17} aria-hidden="true" /><label htmlFor="deck-search" className={styles.srOnly}>Tìm bộ bài</label><input id="deck-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm một bộ bài hợp gu…" /><button type="submit" className={styles.smallButton}>Tìm bộ bài</button></form>
      <div className={styles.libraryFilters}><button type="button" aria-pressed={!activeMine} onClick={() => { setMine(false); setPage(1) }}>Tất cả</button><button type="button" aria-pressed={activeMine} disabled={status !== 'authenticated'} title={status !== 'authenticated' ? 'Đăng nhập để xem bộ bài của bạn' : undefined} onClick={() => { setMine(true); setPage(1) }}><UserRound size={14} aria-hidden="true" /> Của tôi</button></div>
    </div>
    {busy ? <p role="status" className={styles.libraryStatus}>Đang tìm những cuộc đấu hay…</p>
      : error ? <div className={styles.libraryStatus}><p role="alert" className={styles.error}>{error}</p><button type="button" className={styles.secondaryButton} onClick={() => setRevision(value => value + 1)}>Thử lại</button><p className={styles.finePrint}>Bạn vẫn có thể tạo một cuộc đấu và chơi ngay.</p></div>
        : !decks.length ? <div className={styles.libraryStatus}><ListMusic size={30} strokeWidth={1.2} aria-hidden="true" /><h3>{search ? 'Chưa tìm thấy bộ bài này.' : activeMine ? 'Gu nhạc của bạn đang chờ được chia sẻ.' : 'Cuộc đấu đầu tiên có thể là của bạn.'}</h3><p>{search ? 'Thử một tên khác hoặc tạo bộ bài mới.' : 'Thêm những bài bạn yêu thích và mời mọi người cùng chọn.'}</p><button type="button" className={styles.primaryButton} onClick={onCreate}>Tạo bộ bài đầu tiên <ArrowRight size={16} aria-hidden="true" /></button></div>
          : <>
            <div className={styles.deckGrid} aria-busy={Boolean(openingId)}>{decks.map(deck => <article key={deck.id} className={styles.deckCard}>
              <div className={styles.deckCardCover}>{deck.cover_url ? <DeckCover url={deck.cover_url} /> : <Disc3 size={64} strokeWidth={.6} aria-hidden="true" />}<span>{deck.track_count} BÀI HÁT</span></div>
              <div className={styles.deckCardBody}><span className={styles.deckCreator}>bởi {deck.creator_name}{deck.is_owner ? ' · của bạn' : ''}</span><h3>{deck.name}</h3><p>{deck.description || 'Một bộ bài, nhiều gu nhạc. Bạn sẽ chọn bài nào?'}</p>
                <div className={styles.deckCardActions}><button type="button" className={styles.textButton} disabled={Boolean(openingId)} aria-label={`Chơi ${deck.name}`} onClick={() => onOpen(deck.id)}>{openingId === deck.id ? 'Đang mở…' : 'Chơi bộ này'} <ArrowRight size={16} aria-hidden="true" /></button>{deck.is_owner && <button type="button" className={styles.iconButton} onClick={() => { setDeleteError(''); setDeleting(deck) }} aria-label={`Xóa bộ bài ${deck.name}`}><Trash2 size={15} aria-hidden="true" /></button>}</div>
              </div>
            </article>)}</div>
            <nav className={styles.pagination} aria-label="Phân trang bộ bài"><span>{total} bộ bài · Trang {page} / {pages}</span><div><button type="button" className={styles.iconButton} aria-label="Trang trước" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} aria-hidden="true" /></button><button type="button" className={styles.iconButton} aria-label="Trang tiếp" disabled={page >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight size={18} aria-hidden="true" /></button></div></nav>
          </>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="delete-deck-title" onCancel={event => { if (deleteBusy) event.preventDefault() }} onClose={() => setDeleting(null)}>
      <h2 id="delete-deck-title">Xóa bộ bài này?</h2><p>“{deleting?.name}” sẽ được gỡ khỏi thư viện cộng đồng và link chia sẻ.</p>{deleteError && <p role="alert" className={styles.error}>{deleteError}</p>}
      <div><button type="button" className={styles.secondaryButton} disabled={deleteBusy} onClick={() => setDeleting(null)}>Giữ lại</button><button type="button" className={styles.primaryButton} disabled={deleteBusy} onClick={() => { void remove() }}>{deleteBusy ? 'Đang xóa…' : 'Xóa bộ bài'}</button></div>
    </dialog>
  </section>
}

function DeckCover({ url }: { url: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <Disc3 size={64} strokeWidth={.6} aria-hidden="true" />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
}
