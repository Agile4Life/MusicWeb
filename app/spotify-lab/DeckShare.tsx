'use client'

import { useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'
import styles from './lab.module.css'

export function DeckShare({ id }: { id: string }) {
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  function reveal() { setLink(`${window.location.origin}/spotify-lab?deck=${encodeURIComponent(id)}`) }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true) }
    catch { document.getElementById('deck-share-link')?.focus(); setCopied(false) }
  }
  return <div className={styles.shareWrap}>
    <button type="button" className={styles.secondaryButton} onClick={reveal}><Share2 size={15} aria-hidden="true" /> Chia sẻ bộ bài</button>
    {link && <div className={styles.shareField}>
      <label className={styles.srOnly} htmlFor="deck-share-link">Link chia sẻ bộ bài</label>
      <input id="deck-share-link" value={link} readOnly onFocus={event => event.currentTarget.select()} />
      <button type="button" className={styles.iconButton} onClick={() => { void copy() }} aria-label={copied ? 'Đã sao chép' : 'Sao chép link'}>{copied ? <Check size={17} aria-hidden="true" /> : <Copy size={17} aria-hidden="true" />}</button>
    </div>}
    {copied && <span role="status" className={styles.finePrint}>Đã sao chép link.</span>}
  </div>
}
