import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeTrackKey, normalizeTrackField, durationBucket } from '@/lib/normalizeTrackKey'
import { normalizeTitle, stripDiacritics } from '@/lib/youtube'
import { searchYouTubeTracks, findBestYouTubeMatch } from '@/lib/youtube'
import {
  normalizeNhacCuaTuiSearchResponse,
  findBestNhacCuaTuiMatch,
} from '@/lib/nhaccuatui'
import { resolveNctSongDetailCached } from '@/lib/nctCacheStore'
import { getPrimaryArtistName } from '@/lib/artistParser'
import { findMemoryDriveTrack } from '@/lib/driveTracksMap'
import { searchSoundCloudTracks } from '@/lib/soundcloudClient'
import { resolveCatalogCandidates } from '@/lib/catalogResolutionRace'
import {
  findBestSoundCloudMatch,
  isCatalogTrackMatch,
  stripNonIdentityAnnotations,
} from '@/lib/catalogMatching'
import {
  readSharedResolution, writeSharedResolution,
  type ResolutionCacheIdentity,
} from '@/lib/serverStreamResolutionCache'

export const dynamic = 'force-dynamic'

// ── L1: In-memory cache for burst (same Vercel instance) ─────────────
interface L1Entry {
  source: string | null
  resolvedId: string | null
  title?: string | null
  artist?: string | null
  duration?: number | null
  coverUrl?: string | null
  isMiss: boolean
  expiresAt: number
  sharedGeneration?: string
}

const l1Cache = new Map<string, L1Entry>()
const inFlightResolutions = new Map<string, { generation: number; sharedGeneration?: string; promise: Promise<L1Entry> }>()
const cacheGenerations = new Map<string, number>()
const observedSharedGenerations = new Map<string, string>()
// A generation check cannot revoke a DB write already on the wire. Serialize
// publications per key; the DB generation guard coordinates other instances.
const cacheMutations = new Map<string, Promise<void>>()
const L1_HIT_TTL = 10 * 60 * 1000    // 10 min for hits
const L1_MISS_TTL = 60 * 1000         // 1 min for misses
const L1_MAX_SIZE = 2000

function evictL1IfFull(): void {
  if (l1Cache.size >= L1_MAX_SIZE) {
    const oldest = l1Cache.keys().next().value
    if (oldest !== undefined) l1Cache.delete(oldest)
  }
}

function generationFor(key: string): number {
  return cacheGenerations.get(key) || 0
}

function storeL1(key: string, generation: number, entry: L1Entry): void {
  if (generationFor(key) !== generation) return
  evictL1IfFull()
  l1Cache.set(key, entry)
}

function mutateCache(key: string, generation: number, mutation: () => PromiseLike<unknown>): Promise<void> {
  const previous = cacheMutations.get(key) || Promise.resolve()
  const pending = previous.then(async () => {
    if (generationFor(key) === generation) await mutation()
  }).catch((error: unknown) => {
    console.warn('Failed to update stream resolution cache:', error)
  })
  cacheMutations.set(key, pending)
  void pending.then(() => {
    if (cacheMutations.get(key) === pending) cacheMutations.delete(key)
  })
  return pending
}

function persistResolution(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  meta: ResolutionCacheIdentity & { cacheKey: string; generation: number; sharedGeneration: string },
  result: L1Entry,
): Promise<void> {
  return mutateCache(meta.cacheKey, meta.generation, async () => {
    const published = await writeSharedResolution(supabase, meta, meta.sharedGeneration, result)
    if (published?.accepted && published.generation === meta.sharedGeneration) {
      storeL1(meta.cacheKey, meta.generation, { ...result, sharedGeneration: meta.sharedGeneration })
    }
  })
}

// ── Supabase client (service role for cache RPCs) ────────────────────
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const key = serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  if (!serviceKey) {
    console.warn(
      'SUPABASE_SERVICE_ROLE_KEY missing — resolve-stream falling back to anon key; ' +
      'shared resolution caching is disabled; direct track lookup remains available.'
    )
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

// ── NCT API helpers (server-side, no round-trip via our own search route) ──
const DEFAULT_NCT_API_BASE_URL = 'https://music-api.vanhuy2004h.io.vn'

async function searchNctServer(query: string) {
  try {
    const base = process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL
    const url = new URL(base)
    url.pathname = '/api/search'
    url.searchParams.set('q', query)
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(1800),
    })
    if (!res.ok) return []
    const payload: unknown = await res.json()
    return normalizeNhacCuaTuiSearchResponse(payload)
  } catch {
    return []
  }
}

// ── Drive file ID extraction (mirrors PlayerContext logic) ──────────
function extractDriveFileId(path: string): string | null {
  if (!path) return null
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{20,})/,
    /id=([a-zA-Z0-9_-]{20,})/,
    /drive-stream\/([a-zA-Z0-9_-]{20,})/,
  ]
  for (const p of patterns) {
    const m = path.match(p)
    if (m) return m[1]
  }
  return null
}

function isPreviewUrl(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return (
    lower.includes('preview') ||
    lower.includes('itunes.apple.com') ||
    lower.includes('audio-ssl.itunes.apple.com') ||
    lower.includes('is1-ssl.mzstatic.com') ||
    lower.includes('mzstatic.com') ||
    lower.startsWith('itunes:') ||
    lower.includes('spotify.com') ||
    lower.startsWith('spotify:') ||
    lower.includes('p.scdn.co') ||
    lower.includes('scdn.co') ||
    lower.includes('deezer.com') ||
    lower.startsWith('deezer:') ||
    lower.includes('dzcdn.net')
  )
}

// ── Server-side full resolution (Drive ‖ NCT ‖ YouTube ‖ SoundCloud) ────
async function resolveStream(
  title: string,
  artist: string,
  duration: number | undefined,
  supabase: ReturnType<typeof getSupabaseAdmin>,
  onLatePreferredResult?: (result: L1Entry) => void,
  album?: string,
): Promise<L1Entry> {
  const primaryArtist = getPrimaryArtistName(artist) || artist
  const cleanTitle = normalizeTitle(title)
  const cleanPrimaryArtist = normalizeTitle(primaryArtist)
  const cleanArtist = normalizeTitle(artist)
  const searchableTitle = stripNonIdentityAnnotations(title) || cleanTitle || title
  const queryStr = `${searchableTitle} ${primaryArtist}`.trim()

  // === 1. Drive: Fast Local In-Memory & DB Check (<1ms) ===
  async function tryDrive(): Promise<L1Entry | null> {
    const memTrack = findMemoryDriveTrack(title, artist, duration)
    if (memTrack) {
      return {
        source: 'drive',
        resolvedId: memTrack.file_path,
        title: memTrack.title,
        artist: memTrack.artist,
        duration: memTrack.duration,
        coverUrl: memTrack.cover_url || undefined,
        isMiss: false,
        expiresAt: Date.now() + L1_HIT_TTL,
      }
    }

    if (!supabase || !cleanTitle) return null
    try {
      const { data: localMatches } = await supabase
        .from('tracks')
        .select('*')
        .or(`title.ilike.%${cleanTitle}%,artist.ilike.%${cleanTitle}%`)
        .limit(10)
      if (!localMatches || localMatches.length === 0) return null

      for (const lt of localMatches) {
        if (!lt.file_path || isPreviewUrl(lt.file_path)) continue
        if (!isCatalogTrackMatch(lt, { title, artist: primaryArtist || artist, duration })) continue

        const driveId = lt.drive_file_id || extractDriveFileId(lt.file_path)
        const isPlayableDrive = driveId || (
          lt.file_path?.startsWith('http') &&
          !isPreviewUrl(lt.file_path) &&
          (lt.file_path.includes('drive.google') || lt.file_path.includes('googleusercontent') || /\.(mp3|flac|m4a|wav|aac|ogg)(?:[?#]|$)/i.test(lt.file_path))
        )
        if (isPlayableDrive) {
          return {
            source: 'drive',
            resolvedId: lt.file_path || lt.id,
            title: lt.title,
            artist: lt.artist,
            duration: lt.duration,
            coverUrl: lt.cover_url,
            isMiss: false,
            expiresAt: Date.now() + L1_HIT_TTL,
          }
        }
      }
      return null
    } catch (e) {
      console.warn('Drive track lookup error in resolve-stream:', e)
      return null
    }
  }

  // === 2. NCT: Search NhacCuaTui + Validate Playable Audio URL ===
  async function tryNct(): Promise<L1Entry | null> {
    try {
      let nctCandidates = await searchNctServer(queryStr)
      if (nctCandidates.length === 0 && cleanTitle && cleanTitle !== queryStr) {
        nctCandidates = await searchNctServer(cleanTitle)
      }
      if (nctCandidates.length === 0) return null

      let remaining = nctCandidates
      for (let attempt = 0; attempt < 2 && remaining.length > 0; attempt++) {
        const match = findBestNhacCuaTuiMatch(remaining, {
          title,
          artist: primaryArtist || artist,
          duration,
          album,
        })
        if (!match?.id) break

        const detail = await resolveNctSongDetailCached(match.id, 1800)
        if (detail?.audioUrl) {
          return {
            source: 'nhaccuatui',
            resolvedId: match.id,
            title: detail.title || match.title,
            artist: detail.artist || match.artist,
            duration: detail.duration ?? match.duration ?? undefined,
            coverUrl: detail.coverUrl || match.thumbnail || null,
            isMiss: false,
            expiresAt: Date.now() + L1_HIT_TTL,
          }
        }

        remaining = remaining.filter((c) => c.id !== match.id)
      }
      return null
    } catch (e) {
      return null
    }
  }

  // === 3. YouTube: High-Speed Single Targeted Search (<300ms) ===
  async function tryYoutube(): Promise<L1Entry | null> {
    try {
      const primaryQuery = `${cleanTitle || title} ${cleanPrimaryArtist || primaryArtist}`.trim()
      let candidates = await searchYouTubeTracks(primaryQuery, 10).catch(() => [])

      if (candidates.length === 0 && cleanTitle) {
        candidates = await searchYouTubeTracks(`${cleanTitle} ${cleanArtist}`, 8).catch(() => [])
      }

      if (candidates.length === 0) return null

      const best = findBestYouTubeMatch(candidates, title, primaryArtist || artist, duration, album)
      if (!best?.youtube_id) return null

      return {
        source: 'youtube',
        resolvedId: best.youtube_id,
        title: best.title || undefined,
        artist: best.artist || undefined,
        duration: best.duration,
        isMiss: false,
        expiresAt: Date.now() + L1_HIT_TTL,
      }
    } catch (e) {
      console.warn('YouTube resolution error in resolve-stream:', e)
      return null
    }
  }

  // === 4. SoundCloud: Fast Full-Length Audio Fallback ===
  async function trySoundCloud(): Promise<L1Entry | null> {
    try {
      const scQuery = `${cleanTitle || title} ${cleanPrimaryArtist || primaryArtist}`.trim()
      const candidates = await searchSoundCloudTracks(scQuery, 5).catch(() => [])
      if (candidates.length === 0) return null

      const match = findBestSoundCloudMatch(candidates, {
        title,
        artist: primaryArtist || artist,
        duration,
      })

      if (!match?.soundcloud_id && !match?.id) return null
      const scId = match.soundcloud_id ? String(match.soundcloud_id) : match.id.replace(/^sc-/, '')
      return {
        source: 'soundcloud',
        resolvedId: scId,
        title: match.title,
        artist: match.artist,
        duration: match.duration,
        coverUrl: match.cover_url || null,
        isMiss: false,
        expiresAt: Date.now() + L1_HIT_TTL,
      }
    } catch {
      return null
    }
  }

  // 1. Instant check for local Drive (<5ms)
  const driveResult = await tryDrive()
  if (driveResult) return driveResult

  // 2. Parallel priority race: NCT (preferred with 1000ms grace window) -> SoundCloud (preferred audio fallback) -> YouTube
  const resolved = await resolveCatalogCandidates(
    tryNct,
    [trySoundCloud, tryYoutube],
    1000,
    onLatePreferredResult,
  )
  if (resolved) return resolved

  // === Miss — Tất cả các nguồn đều không tìm được ===
  return {
    source: null,
    resolvedId: null,
    isMiss: true,
    expiresAt: Date.now() + L1_MISS_TTL,
  }
}

// ── Route handler ───────────────────────────────────────────────────

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url)
  const title = (url.searchParams.get('title') || '').trim()
  const artist = (url.searchParams.get('artist') || '').trim()
  const album = (url.searchParams.get('album') || '').trim() || undefined
  const durationStr = url.searchParams.get('duration')
  const duration = durationStr ? parseInt(durationStr, 10) : undefined
  const invalidate = url.searchParams.get('invalidate') === '1'

  if (!title) {
    return NextResponse.json({ error: 'Missing title parameter' }, { status: 400 })
  }

  const titleKey = normalizeTrackField(title)
  const albumKey = normalizeTrackField(album)
  const baseArtistKey = normalizeTrackField(artist)
  const artistKey = albumKey ? `${baseArtistKey}___${albumKey}` : baseArtistKey
  const durBucket = durationBucket(duration)
  const cacheKey = normalizeTrackKey(title, artist, duration, album)

  const supabase = getSupabaseAdmin()
  let generation = generationFor(cacheKey) + (invalidate ? 1 : 0)
  if (invalidate) {
    // Revoke ownership synchronously, before waiting on any network mutation.
    cacheGenerations.set(cacheKey, generation)
    l1Cache.delete(cacheKey)
    inFlightResolutions.delete(cacheKey)
  }

  // ── Invalidate path ───────────────────────────────────────────────
  const identity = { titleKey, artistKey, durBucket }
  // Every instance must consult the shared version before using its own cache.
  // An unavailable protocol never falls back to unversioned L2 writes/reads.
  const sharedClient = supabase && process.env.SUPABASE_SERVICE_ROLE_KEY ? supabase : null
  let shared = sharedClient ? await readSharedResolution(sharedClient, identity, invalidate) : null
  const previouslyObserved = observedSharedGenerations.get(cacheKey)
  if (shared && previouslyObserved && BigInt(shared.generation) < BigInt(previouslyObserved)) {
    // A delayed read response must not roll this instance back to an older epoch.
    shared = await readSharedResolution(sharedClient!, identity, false)
  }
  const latestObserved = observedSharedGenerations.get(cacheKey)
  if (shared && latestObserved && BigInt(shared.generation) < BigInt(latestObserved)) shared = null
  if (shared) {
    const observed = observedSharedGenerations.get(cacheKey)
    if (observed && observed !== shared.generation) {
      generation = generationFor(cacheKey) + 1
      cacheGenerations.set(cacheKey, generation)
      l1Cache.delete(cacheKey)
      inFlightResolutions.delete(cacheKey)
    } else {
      generation = generationFor(cacheKey)
    }
    observedSharedGenerations.set(cacheKey, shared.generation)
  }

  // ── L1 check ──────────────────────────────────────────────────────
  if (!invalidate) {
    const l1 = l1Cache.get(cacheKey)
    if (l1 && Date.now() < l1.expiresAt &&
        (shared ? l1.sharedGeneration === shared.generation && shared.entry !== null &&
          l1.source === shared.entry.source && l1.resolvedId === shared.entry.resolvedId &&
          l1.isMiss === shared.entry.isMiss
          : !supabase && !l1.sharedGeneration)) {
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[ResolveStream:L1] Cache HIT for "${title}" by "${artist}" (source: ${l1.source})`)
      }
      return respondWith(l1)
    }
  }

  // ── Direct Drive mapping (after shared version validation) ──────────
  const memDrive = findMemoryDriveTrack(title, artist, duration)
  if (memDrive) {
    const driveEntry: L1Entry = {
      source: 'drive',
      resolvedId: memDrive.file_path,
      title: memDrive.title,
      artist: memDrive.artist,
      duration: memDrive.duration,
      coverUrl: memDrive.cover_url || undefined,
      isMiss: false,
      expiresAt: Date.now() + L1_HIT_TTL,
    }
    // Drive memory mappings are direct source metadata, not an L2 match.
    if (!supabase) storeL1(cacheKey, generation, driveEntry)
    return respondWith(driveEntry)
  }

  // ── L2 check (Supabase) ───────────────────────────────────────────
  if (shared?.entry && !invalidate) {
    const sharedEntry: L1Entry = {
      ...shared.entry,
      sharedGeneration: shared.generation,
      expiresAt: Math.min(shared.entry.expiresAt, Date.now() + (shared.entry.isMiss ? L1_MISS_TTL : L1_HIT_TTL)),
    }
    storeL1(cacheKey, generation, sharedEntry)
    return respondWith(sharedEntry)
  }

  // ── In-Flight Request Deduplication (Thundering Herd / Stampede Protection) ──
  if (!invalidate) {
    const existingInFlight = inFlightResolutions.get(cacheKey)
    if (existingInFlight?.generation === generation &&
        (shared ? existingInFlight.sharedGeneration === shared.generation
          : !supabase && !existingInFlight.sharedGeneration)) {
      try {
        const resolvedEntry = await existingInFlight.promise
        return respondWith(resolvedEntry)
      } catch {
        // Fall through to re-resolve if in-flight failed
      }
    }
  }

  // ── Resolve (cold path) with In-Flight Coalescing ───────────────────
  const resolvePromise = (async (): Promise<L1Entry> => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[ResolveStream:Cold] Starting upstream resolve for "${title}" by "${artist}"`)
    }
    const tCold = Date.now()
    const meta = { cacheKey, titleKey, artistKey, durBucket, generation, sharedGeneration: shared?.generation }
    let initialStored = false
    let latePreferred: L1Entry | undefined
    const publish = async (entry: L1Entry): Promise<void> => {
      if (generationFor(cacheKey) !== generation) return
      if (sharedClient && meta.sharedGeneration !== undefined) {
        await persistResolution(sharedClient, { ...meta, sharedGeneration: meta.sharedGeneration }, entry)
      } else if (!supabase) {
        storeL1(cacheKey, generation, entry)
      }
    }
    const result = await resolveStream(title, artist, duration, supabase, (preferred) => {
      // The callback can run in the microtask gap before this await resumes.
      // Store the initial winner first, then the preferred upgrade in order.
      latePreferred = preferred
      if (initialStored) void publish(preferred)
    }, album)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[ResolveStream:Cold] Completed in ${Date.now() - tCold}ms: source=${result.source}, id=${result.resolvedId}`)
    }

    await publish(result)
    initialStored = true
    if (latePreferred) await publish(latePreferred)

    return result
  })()

  if (generationFor(cacheKey) === generation) {
    inFlightResolutions.set(cacheKey, { promise: resolvePromise, generation, sharedGeneration: shared?.generation })
  }

  try {
    const result = await resolvePromise
    return respondWith(result)
  } finally {
    if (inFlightResolutions.get(cacheKey)?.promise === resolvePromise) {
      inFlightResolutions.delete(cacheKey)
    }
  }
}

function respondWith(entry: L1Entry): Response {
  if (entry.isMiss) {
    return NextResponse.json({ miss: true }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const resolvedId = entry.resolvedId || ''
  let streamUrl: string | null = null
  if (entry.source === 'nhaccuatui') {
    streamUrl = `/api/nhaccuatui/stream?id=${encodeURIComponent(resolvedId)}`
  } else if (entry.source === 'soundcloud') {
    streamUrl = `/api/soundcloud/stream?id=${encodeURIComponent(resolvedId)}`
  } else if (entry.source === 'drive') {
    const fileId = extractDriveFileId(resolvedId) || resolvedId
    streamUrl = fileId.startsWith('http') || fileId.startsWith('/') ? fileId : `/api/drive-stream?fileId=${encodeURIComponent(fileId)}`
  } else if (entry.source === 'youtube') {
    streamUrl = `/api/yt-stream?id=${encodeURIComponent(resolvedId)}`
  }

  return NextResponse.json({
    source: entry.source,
    id: entry.resolvedId,
    resolvedId: entry.resolvedId,
    title: entry.title,
    artist: entry.artist,
    duration: entry.duration,
    coverUrl: entry.coverUrl,
    streamUrl,
  }, {
    status: 200,
    // L1/L2 caches own invalidation. HTTP caches cannot coordinate that state.
    headers: { 'Cache-Control': 'no-store' },
  })
}
