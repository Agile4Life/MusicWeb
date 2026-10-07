import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parseLrc, parsePlainLyrics } from '@/lib/lrcParser'
import { getTrackLyricsCacheKey } from '@/lib/lyricsFlow'

// Execute the production effect; only provider I/O and React state setters are doubled.
const source = readFileSync(resolve(__dirname, '../MobileFullviewPlayer.tsx'), 'utf8')
const ast = ts.createSourceFile('MobileFullviewPlayer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effectSource = ''
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' &&
      node.arguments[0]?.getText(ast).includes('getPrimaryLyrics(')) {
    effectSource = node.arguments[0].getText(ast)
  }
  ts.forEachChild(node, visit)
}
visit(ast)
if (!effectSource) throw new Error('Mobile lyrics effect not found')

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const track = (id: string) => ({ id, title: id, artist: 'Artist', duration: 180 })
const result = (text: string) => ({ syncedLyrics: `[00:01.00]${text}`, plainLyrics: null })
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function setup() {
  const primary = deferred<ReturnType<typeof result> | null>()
  const romaji = deferred<string[]>()
  const state = { lyrics: [] as { text: string; romaji?: string }[], synced: false, loading: false, writes: 0 }
  const cache = new Map()
  const env = createContext({
    currentTrack: track('A'), globalLyricsCache: cache,
    lyricsReqIdRef: { current: 0 }, getTrackLyricsCacheKey,
    setLyrics: (value: typeof state.lyrics) => { state.lyrics = value; state.writes++ },
    setIsSynced: (value: boolean) => { state.synced = value; state.writes++ },
    setLyricsLoading: (value: boolean) => { state.loading = value; state.writes++ },
    getPrimaryLyrics: () => primary.promise,
    fetchLyricsRomaji: () => romaji.promise,
    parseLrc, parsePlainLyrics,
    console: { warn() {} },
  })
  const effect = runInContext(ts.transpileModule(`(${effectSource})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, env) as () => (() => void) | undefined
  function cacheB() {
    // Seed both old and metadata-aware keys so this suite catches request ownership,
    // independently of the separate cache-identity regression.
    const value = { lyrics: [{ time: 1, text: 'B cached' }], isSynced: true }
    cache.set('B', value)
    cache.set(getTrackLyricsCacheKey(track('B')), value)
  }
  return { env, state, primary, romaji, effect, cacheB }
}

describe('mobile lyrics request ownership', () => {
  it('looks up corrected metadata even when the track ID is unchanged', async () => {
    const e = setup()
    e.cacheB()
    e.env.currentTrack = { ...track('B'), duration: 240 }
    e.effect()
    expect(e.state.loading).toBe(true)
    expect(e.state.lyrics).toEqual([])
    e.primary.resolve(result('Correct version'))
    await flush()
    expect(e.state.lyrics[0].text).toBe('Correct version')
  })

  it('keeps cached B lyrics after pending A completes', async () => {
    const e = setup()
    const cleanup = e.effect()
    cleanup?.()
    e.cacheB()
    e.env.currentTrack = track('B')
    e.effect()
    e.primary.resolve(result('A stale'))
    await flush()
    expect(e.state.lyrics.map((line) => line.text)).toEqual(['B cached'])
    expect(e.state.loading).toBe(false)
  })

  it('keeps cached B lyrics after A romaji completes', async () => {
    const e = setup()
    const cleanup = e.effect()
    e.primary.resolve(result('A original'))
    await flush()
    expect(e.state.lyrics[0].text).toBe('A original')
    cleanup?.()
    e.cacheB()
    e.env.currentTrack = track('B')
    e.effect()
    e.romaji.resolve(['A romaji'])
    await flush()
    expect(e.state.lyrics.map((line) => line.text)).toEqual(['B cached'])
  })

  it('keeps lyrics cleared after the active track is removed', async () => {
    const e = setup()
    const cleanup = e.effect()
    cleanup?.()
    e.env.currentTrack = null
    e.effect()
    e.primary.resolve(result('A stale'))
    await flush()
    expect(e.state.lyrics).toEqual([])
    expect(e.state.synced).toBe(false)
    expect(e.state.loading).toBe(false)
  })

  it('does not write lyrics or loading state after unmount', async () => {
    const e = setup()
    const cleanup = e.effect()
    cleanup?.()
    const writesAtUnmount = e.state.writes
    e.primary.resolve(result('A stale'))
    await flush()
    e.romaji.resolve(['A romaji'])
    await flush()
    expect(e.state.writes).toBe(writesAtUnmount)
  })
})
