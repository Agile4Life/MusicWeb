'use client'

import { useEffect, useMemo, useState } from 'react'
import { currentPair, type Battle } from '@/lib/songBattle'
import { resolveBattleTrackPlayback } from '@/lib/songBattlePlayback'
import type { BattleTrack } from '@/lib/songBattleSources'

export function useBattlePlayback(battle: Battle<BattleTrack> | null, current: BattleTrack | null) {
  const [playback, setPlayback] = useState(() => new Map<BattleTrack, BattleTrack>())
  const pair = battle ? currentPair(battle) : null
  const left = pair?.[0]
  const right = pair?.[1]

  useEffect(() => {
    let active = true
    const visible = new Set([left, right, current].filter((track): track is BattleTrack => !!track?.needs_metadata_resolution))
    for (const track of visible) {
      void resolveBattleTrackPlayback(track).then(resolved => {
        if (active) setPlayback(previous => new Map(previous).set(track, resolved))
      })
    }
    return () => { active = false }
  }, [left, right, current])

  // Transport changes must not change tournament choices, saved IDs, or pool deduplication.
  const playableBattle = useMemo(() => battle ? {
    ...battle,
    round: battle.round.map(track => playback.get(track) || track),
    champion: battle.champion ? playback.get(battle.champion) || battle.champion : null,
  } : null, [battle, playback])

  return {
    battle: playableBattle,
    current: current ? playback.get(current) || current : null,
    resolvingPreview: !!current?.needs_metadata_resolution && !playback.has(current),
  }
}
