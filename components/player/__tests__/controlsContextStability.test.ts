import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Regression guard for the context split: every callback exposed through the
 * controls context must keep a stable identity across play/pause/buffer/queue
 * changes. If one closes over frequently-changing state, `controlsValue` is
 * re-created and ALL controls-only consumers (TrackList, TopBar, pages…)
 * re-render on every state change, defeating the split.
 */
const source = readFileSync(path.resolve(__dirname, '../PlayerContext.tsx'), 'utf8').replace(/\r\n/g, '\n')

const VOLATILE_STATE = [
  'isPlaying',
  'isBuffering',
  'volume',
  'queue',
  'currentTrack',
  'currentIndex',
  'isShuffle',
  'repeatMode',
  'isQueueOpen',
  'isNowPlayingOpen',
  'duration',
  'playbackError',
]

function controlsMembers(): string[] {
  const block = source.match(/const controlsValue = useMemo<PlayerControlsContextType>\(\s*\(\) => \(\{([\s\S]*?)\}\),/)
  expect(block, 'controlsValue block not found').toBeTruthy()
  return block![1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function depsOf(name: string): string[] | null {
  const re = new RegExp(`const ${name} = useCallback\\(([\\s\\S]*?)\\n  \\}, \\[([^\\]]*)\\]\\)`)
  const m = source.match(re)
  if (!m) return null // not a plain useCallback (e.g. alias) — skip
  return m[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

describe('controls context callbacks stay referentially stable', () => {
  const members = controlsMembers()

  it('finds the controls members', () => {
    expect(members).toContain('togglePlay')
    expect(members).toContain('playTrack')
  })

  for (const name of [
    'playTrack',
    'playSearchTrack',
    'togglePlay',
    'seek',
    'setVolume',
    'nextTrack',
    'prevTrack',
    'toggleShuffle',
    'toggleRepeat',
    'toggleFavoriteCurrentTrack',
    'addToQueue',
    'removeFromQueue',
    'clearQueue',
  ]) {
    it(`${name} does not depend on volatile state`, () => {
      const deps = depsOf(name)
      if (deps === null) return
      const offenders = deps.filter((d) => VOLATILE_STATE.includes(d))
      expect(offenders, `${name} deps include volatile state`).toEqual([])
    })
  }
})
