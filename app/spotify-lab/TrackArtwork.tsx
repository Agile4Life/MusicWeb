import { useState } from 'react'
import { Disc3 } from 'lucide-react'
import type { BattleTrack } from '@/lib/songBattleSources'
import styles from './lab.module.css'

export function TrackArtwork({ track, large = false }: { track: BattleTrack; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return <div className={large ? styles.artworkLarge : styles.artwork}>
    {/* Remote covers come from the existing catalog APIs. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {track.cover_url && track.cover_url !== failedUrl ? <img src={track.cover_url} alt="" loading="lazy" onError={() => setFailedUrl(track.cover_url)} /> : <Disc3 aria-hidden="true" />}
  </div>
}
