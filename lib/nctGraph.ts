/**
 * NhacCuaTui upstream adapter.
 *
 * The routes were written against a private mirror (music-api.vanhuy2004h.io.vn: /api/song/:id,
 * /api/search?q=, /api/chart) that is offline (Cloudflare 1033). NCT's own web app now talks to
 * graph.nhaccuatui.com, so this module calls that and answers with a Response in the mirror's old
 * JSON shape. Callers swap `fetch(url)` for `nctApiFetch(url)` and keep their normalizers.
 *
 * shortcut: unofficial API (the calls nhaccuatui.com itself makes, as in the npm `nhaccuatui-client`);
 * if NCT changes it, only this file needs updating.
 */

const GRAPH_API = 'https://graph.nhaccuatui.com/api'
/** The mirror host these legacy URLs are built on; any base works, only the path is read. */
export const NCT_LEGACY_BASE = 'https://nct.internal'

interface GraphStream { stream?: string; type?: string; onlyVIP?: boolean; status?: number }
interface GraphSong {
  key?: string
  name?: string
  artistName?: string
  image?: string
  duration?: number
  streamURL?: GraphStream[]
}

/** Best free stream: 320 kbps, else 128 kbps; VIP-only (lossless) entries are never returned. */
export function pickGraphStream(streams: GraphStream[] | undefined): string | null {
  const free = (streams || []).filter((s) => s.onlyVIP !== true && s.status === 1 && s.stream)
  const pick = free.find((s) => s.type === '320') || free.find((s) => s.type === '128') || free[0]
  return pick?.stream || null
}

/** Graph song -> the mirror's song shape read by normalizeNhacCuaTui*(). */
export function toLegacySong(song: GraphSong): Record<string, unknown> | null {
  if (!song?.key || !song.name) return null
  return {
    id: song.key,
    title: song.name,
    artist: song.artistName || '',
    thumbnail: song.image || null,
    coverUrl: song.image || null,
    duration: typeof song.duration === 'number' ? song.duration : null,
    audioUrl: pickGraphStream(song.streamURL),
  }
}

function chartKeys(now = new Date()): string[] {
  const year = now.getUTCFullYear()
  // Weekly Top 50; the key carries the year, so fall back to last year's around New Year.
  return [`1-5-d7-${year}`, `1-5-d7-${year - 1}`, `1-5-d360-${year - 1}`]
}

async function graphGet(path: string, params: Record<string, string>, signal?: AbortSignal | null) {
  const url = new URL(`${GRAPH_API}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('timestamp', String(Date.now()))
  const res = await fetch(url, {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Referer: 'https://www.nhaccuatui.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: signal ?? undefined,
  })
  if (!res.ok) return { status: res.status, data: null as unknown }
  const body = (await res.json().catch(() => null)) as { code?: number; data?: unknown } | null
  // code !== 0 is how graph reports unknown keys and other logical errors.
  return { status: body?.code === 0 ? 200 : 404, data: body?.code === 0 ? body.data : null }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/**
 * Drop-in for `fetch()` on the legacy mirror URLs. Supported paths:
 *   /api/song/:id    -> 200 song | 404 unknown song
 *   /api/search?q=   -> 200 { songs: [...] }
 *   /api/chart       -> 200 { songs: [...] }
 * Network errors propagate as rejections, like fetch, so existing retry logic keeps working.
 */
export async function nctApiFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), NCT_LEGACY_BASE)
  const signal = init?.signal

  const song = url.pathname.match(/^\/api\/song\/([^/]+)\/?$/)
  if (song) {
    const key = decodeURIComponent(song[1])
    const r = await graphGet(`v1/song/detail/${encodeURIComponent(key)}`, { key, isDailyMix: 'false' }, signal)
    const legacy = r.data ? toLegacySong(r.data as GraphSong) : null
    return legacy ? json(legacy) : json({ error: 'Song not found' }, r.status === 200 ? 404 : r.status)
  }

  if (url.pathname === '/api/search') {
    const q = url.searchParams.get('q')?.trim() || ''
    if (!q) return json({ songs: [] })
    const r = await graphGet('v3/search/all', { keyword: q, correct: 'false' }, signal)
    if (!r.data && r.status >= 500) return json({ error: 'Upstream error' }, r.status)
    const songs = ((r.data as { songs?: GraphSong[] } | null)?.songs || []).map(toLegacySong).filter(Boolean)
    return json({ songs })
  }

  if (url.pathname === '/api/chart') {
    for (const key of chartKeys()) {
      const r = await graphGet(`v1/playlist/charts/${key}`, { key }, signal)
      const items = (r.data as { items?: GraphSong[] } | null)?.items || []
      if (items.length) return json({ songs: items.map(toLegacySong).filter(Boolean) })
    }
    return json({ songs: [] })
  }

  return json({ error: `Unsupported NCT path ${url.pathname}` }, 404)
}

/** Legacy mirror URL for a song id, for callers that build URLs before fetching. */
export function nctSongUrl(id: string): URL {
  return new URL(`/api/song/${encodeURIComponent(id)}`, NCT_LEGACY_BASE)
}

/** Legacy mirror URL for a search query. */
export function nctSearchUrl(query: string): URL {
  const url = new URL('/api/search', NCT_LEGACY_BASE)
  url.searchParams.set('q', query)
  return url
}
