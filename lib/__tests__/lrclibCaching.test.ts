import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())

describe('lyrics provider cache', () => {
  it('retries the real LRCLIB and YouTube provider flow after a transient miss', async () => {
    vi.resetModules()
    const { fetchLyricsFromLrclib } = await import('../lrclib')
    let recovered = false
    vi.stubGlobal('fetch', async (url: string) => {
      if (recovered && String(url).includes('/api/youtube/lyrics')) {
        return new Response(JSON.stringify({ plainLyrics: 'Provider recovered' }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    })
    const track = { title: 'Provider recovery song', artist: 'Artist', youtubeId: 'recoveryVideo' }
    expect(await fetchLyricsFromLrclib(track)).toBeNull()
    recovered = true
    expect(await fetchLyricsFromLrclib(track)).toMatchObject({ plainLyrics: 'Provider recovered' })
  })

  it('keeps different YouTube fallback videos separate', async () => {
    vi.resetModules()
    const { fetchLyricsFromLrclib } = await import('../lrclib')
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).includes('/api/youtube/lyrics')) {
        const id = new URL(String(url)).searchParams.get('videoId')
        return new Response(JSON.stringify({ plainLyrics: id === 'first' ? 'First video lyrics' : 'Second video lyrics' }))
      }
      return new Response('{}', { status: 404 })
    })
    const track = { title: 'Two versions', artist: 'Artist' }
    expect(await fetchLyricsFromLrclib({ ...track, youtubeId: 'first' })).toMatchObject({ plainLyrics: 'First video lyrics' })
    expect(await fetchLyricsFromLrclib({ ...track, youtubeId: 'second' })).toMatchObject({ plainLyrics: 'Second video lyrics' })
  })

  it('bounds successful provider results while preserving recent cache hits', async () => {
    vi.resetModules()
    const { fetchLyricsFromLrclib } = await import('../lrclib')
    let text = 'Cached provider lyrics'
    vi.stubGlobal('fetch', async (url: string) => String(url).includes('/api/youtube/lyrics')
      ? new Response(JSON.stringify({ plainLyrics: text }))
      : new Response('{}', { status: 404 }))
    const track = { title: 'Old provider entry', artist: 'Artist' }
    await fetchLyricsFromLrclib(track)
    for (let i = 0; i < 500; i++) await fetchLyricsFromLrclib({ ...track, title: `Other track ${i}` })
    text = 'Refetched provider lyrics'
    expect(await fetchLyricsFromLrclib({ ...track, title: 'Other track 499' })).toMatchObject({ plainLyrics: 'Cached provider lyrics' })
    expect(await fetchLyricsFromLrclib(track)).toMatchObject({ plainLyrics: 'Refetched provider lyrics' })
  })
})
