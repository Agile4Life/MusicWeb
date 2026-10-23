'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { Globe2, X } from 'lucide-react'
import type { BattleTrack } from '@/lib/songBattleSources'
import type { CommunityDeck } from '@/lib/songBattleCommunity'
import { saveCommunityDeck } from './communityClient'
import styles from './lab.module.css'

export function PublishDeckDialog({ tracks, editing, onClose, onSaved, onPreserveDraft }: {
  tracks: BattleTrack[]
  editing: CommunityDeck | null
  onClose: () => void
  onSaved: (deck: CommunityDeck, updated: boolean) => void
  onPreserveDraft: () => void
}) {
  const { data: session, status } = useSession()
  const dialog = useRef<HTMLDialogElement>(null)
  const saving = useRef(false)
  const [name, setName] = useState(editing?.name || '')
  const [description, setDescription] = useState(editing?.description || '')
  const [creatorInput, setCreator] = useState<string | null>(null)
  const creator = creatorInput ?? editing?.creator_name ?? session?.user?.name ?? 'Thành viên MusicWeb'
  const canSave = tracks.length >= 2 && tracks.length <= 512 && Boolean(name.trim() && creator.trim())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal() }, [])

  async function save() {
    if (saving.current || !canSave || status !== 'authenticated') return
    saving.current = true; setBusy(true); setError('')
    try {
      const { deck } = await saveCommunityDeck({ name: name.trim(), description: description.trim(), creator_name: creator.trim(), tracks }, editing)
      onSaved(deck, Boolean(editing))
    } catch (err) { setError(err instanceof Error ? err.message : 'Không lưu được bộ bài.') }
    finally { saving.current = false; setBusy(false) }
  }

  return <dialog ref={dialog} className={`${styles.dialog} ${styles.publishDialog}`} onCancel={event => { if (busy) event.preventDefault() }} onClose={onClose} aria-labelledby="publish-title">
    <div className={styles.modalHeading}><Globe2 size={22} aria-hidden="true" /><button type="button" className={styles.iconButton} disabled={busy} aria-label="Đóng cửa sổ đăng bộ bài" onClick={onClose}><X size={18} aria-hidden="true" /></button></div>
    {status === 'loading' ? <p role="status">Đang kiểm tra tài khoản…</p> : status !== 'authenticated' ? <>
      <h2 id="publish-title">Đăng nhập để đăng bộ bài</h2><p>Bạn có thể chơi tự do. Đăng nhập để lưu và chia sẻ bộ bài của mình với mọi người.</p>
      <Link className={styles.primaryButton} href="/login?returnTo=%2Fspotify-lab" onClick={onPreserveDraft}>Đăng nhập</Link>
    </> : <form onSubmit={event => { event.preventDefault(); void save() }}>
      <h2 id="publish-title">{editing ? 'Cập nhật bộ bài' : 'Đăng bộ bài của bạn'}</h2>
      <p>{tracks.length} bài đã chọn. Mọi người sẽ chơi và chọn bài theo gu riêng.</p>
      <label htmlFor="deck-name">Tên bộ bài</label><input id="deck-name" required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="Ví dụ: Những bài hát đi qua tuổi trẻ" disabled={busy} />
      <label htmlFor="deck-description">Mô tả bộ bài</label><textarea id="deck-description" maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} placeholder="Một lời giới thiệu cho cuộc đấu của bạn…" rows={3} disabled={busy} />
      <label htmlFor="deck-creator">Tên hiển thị của bạn</label><input id="deck-creator" required maxLength={80} value={creator} onChange={event => setCreator(event.target.value)} disabled={busy} />
      {tracks.length > 512 && <p role="alert" className={styles.error}>Mỗi bộ bài tối đa 512 bài. Hãy bớt bài trước khi đăng.</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.publishActions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={onClose}>Hủy</button><button type="submit" className={styles.primaryButton} disabled={busy || !canSave}>{busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Đăng công khai'}</button></div>
    </form>}
  </dialog>
}
