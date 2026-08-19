import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizeTrackKey, normalizeTrackField, durationBucket } from '@/lib/normalizeTrackKey'
import { normalizeTitle } from '@/lib/youtube'
import { searchYouTubeTracks, findBestYouTubeMatch } from '@/lib/youtube'
import {
  normalizeNhacCuaTuiSearchResponse,
  normalizeNhacCuaTuiSongResponse,
  findBestNhacCuaTuiMatch,
} from '@/lib/nhaccuatui'
import { getPrimaryArtistName } from '@/lib/artistParser'
import { findMemoryDriveTrack } from '@/lib/driveTracksMap'
import { searchSoundCloudTracks } from '@/lib/soundcloudClient'

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
}

const l1Cache = new Map<string, L1Entry>()
const L1_HIT_TTL = 10 * 60 * 1000    // 10 min for hits
const L1_MISS_TTL = 60 * 1000         // 1 min for misses
const L1_MAX_SIZE = 2000

function evictL1IfFull(): void {
  if (l1Cache.size >= L1_MAX_SIZE) {
    const oldest = l1Cache.keys().next().value
    if (oldest !== undefined) l1Cache.delete(oldest)
  }
}

// ── Supabase client (service role for upserts) ──────────────────────
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const key = serviceKey || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  if (!serviceKey) {
    console.warn(
      'SUPABASE_SERVICE_ROLE_KEY missing — resolve-stream falling back to anon key; ' +
      'L2 cache writes to stream_resolutions may silently fail under RLS.'
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

async function fetchNctSong(id: string) {
  try {
    const base = process.env.NCT_API_BASE_URL || DEFAULT_NCT_API_BASE_URL
    const url = new URL(base)
    url.pathname = `/api/song/${encodeURIComponent(id)}`
    const res = await fetch(url.toString(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(1800),
    })
    if (!res.ok) return null
    return normalizeNhacCuaTuiSongResponse(await res.json())
  } catch {
    return null
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
  supabase: any,
): Promise<L1Entry> {
  const primaryArtist = getPrimaryArtistName(artist) || artist
  const cleanTitle = normalizeTitle(title)
  const cleanPrimaryArtist = normalizeTitle(primaryArtist)
  const cleanArtist = normalizeTitle(artist)
  const queryStr = `${title.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()} ${primaryArtist}`.trim()

  // === 1. Drive: Fast Local In-Memory & DB Check (<1ms) ===
  async function tryDrive(): Promise<L1Entry | null> {
    const memTrack = findMemoryDriveTrack(title, artist)
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

      for (const lt of localMatches as any[]) {
        if (!lt.file_path || isPreviewUrl(lt.file_path)) continue
        const ltTitle = normalizeTitle(lt.title)
        const ltArtist = normalizeTitle(lt.artist || '')
        const titleMatches = ltTitle.includes(cleanTitle) || cleanTitle.includes(ltTitle)
        const artistMatches = !cleanArtist || ltArtist.includes(cleanArtist) || cleanArtist.includes(ltArtist) || ltArtist.includes(cleanPrimaryArtist)
        if (!titleMatches || !artistMatches) continue

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

  // === 2. NCT: Search NhacCuaTui (Single Fast Search Round-Trip <600ms) ===
  async function tryNct(): Promise<L1Entry | null> {
    try {
      let nctCandidates = await searchNctServer(queryStr)
      if (nctCandidates.length === 0 && cleanTitle && cleanTitle !== queryStr) {
        nctCandidates = await searchNctServer(cleanTitle)
      }
      if (nctCandidates.length === 0) return null

      const match = findBestNhacCuaTuiMatch(nctCandidates, { title, artist: primaryArtist || artist, duration })
        || nctCandidates[0]

      if (!match?.id) return null
      return {
        source: 'nhaccuatui',
        resolvedId: match.id,
        title: match.title,
        artist: match.artist,
        duration: match.duration ?? undefined,
        coverUrl: match.thumbnail || null,
        isMiss: false,
        expiresAt: Date.now() + L1_HIT_TTL,
      }
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

      let best = findBestYouTubeMatch(candidates, title, primaryArtist || artist, duration)
      if (!best && candidates.length > 0) {
        best = candidates[0]
      }

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

      const match = candidates.find((c) => {
        if (!c.duration || !duration) return true
        return Math.abs(c.duration - duration) <= 30
      }) || candidates[0]

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

  // 2. Run NCT, YouTube, and SoundCloud searches in parallel with strict priority
  const [nctResult, ytResult, scResult] = await Promise.all([
    tryNct(),
    tryYoutube(),
    trySoundCloud(),
  ])
  if (nctResult) return nctResult
  if (ytResult) return ytResult
  if (scResult) return scResult

  // === Miss — Tất cả các nguồn đều không tìm được ===
  return {
    source: null,
    resolvedId: null,
    isMiss: true,
    expiresAt: Date.now() + L1_MISS_TTL,
  }
}

// ── Route handler ───────────────────────────────────────────────────
const HIT_TTL_DAYS = 30
const MISS_TTL_HOURS = 1

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url)
  const title = (url.searchParams.get('title') || '').trim()
  const artist = (url.searchParams.get('artist') || '').trim()
  const durationStr = url.searchParams.get('duration')
  const duration = durationStr ? parseInt(durationStr, 10) : undefined
  const invalidate = url.searchParams.get('invalidate') === '1'

  if (!title) {
    return NextResponse.json({ error: 'Missing title parameter' }, { status: 400 })
  }

  const titleKey = normalizeTrackField(title)
  const artistKey = normalizeTrackField(artist)
  const durBucket = durationBucket(duration)
  const cacheKey = normalizeTrackKey(title, artist, duration)

  const supabase = getSupabaseAdmin()

  // ── Invalidate path ───────────────────────────────────────────────
  if (invalidate && supabase) {
    try {
      await supabase
        .from('stream_resolutions')
        .delete()
        .eq('title_key', titleKey)
        .eq('artist_key', artistKey)
        .eq('duration_bucket', durBucket)
    } catch (e) {
      console.warn('Failed to invalidate stream_resolutions row:', e)
    }
    l1Cache.delete(cacheKey)
    // Fall through to re-resolve
  }

  // ── L1 check ──────────────────────────────────────────────────────
  if (!invalidate) {
    const l1 = l1Cache.get(cacheKey)
    if (l1 && Date.now() < l1.expiresAt) {
      return respondWith(l1)
    }
  }

  // ⚡ ── Instant In-Memory Drive Cache Check (<0.01ms, zero DB latency) ────
  const memDrive = findMemoryDriveTrack(title, artist)
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
    evictL1IfFull()
    l1Cache.set(cacheKey, driveEntry)
    return respondWith(driveEntry)
  }

  // ── L2 check (Supabase) ───────────────────────────────────────────
  if (supabase && !invalidate) {
    try {
      const { data: row } = await supabase
        .from('stream_resolutions')
        .select('*')
        .eq('title_key', titleKey)
        .eq('artist_key', artistKey)
        .eq('duration_bucket', durBucket)
        .single()

      if (row && new Date(row.expires_at) > new Date()) {
        // Promote to L1
        const l1Entry: L1Entry = {
          source: row.source,
          resolvedId: row.resolved_id,
          title: row.resolved_title,
          artist: row.resolved_artist,
          duration: row.resolved_duration,
          coverUrl: row.resolved_cover_url,
          isMiss: row.is_miss,
          expiresAt: Date.now() + L1_HIT_TTL,
        }
        evictL1IfFull()
        l1Cache.set(cacheKey, l1Entry)

        return respondWith(l1Entry)
      }
    } catch {
      // L2 miss or Supabase error — continue to resolve
    }
  }

  // ── Resolve (cold path) ───────────────────────────────────────────
  const result = await resolveStream(title, artist, duration, supabase)

  // Store in L1
  evictL1IfFull()
  l1Cache.set(cacheKey, result)

  // Store in L2 (Supabase) — upsert
  if (supabase) {
    try {
      const expiresAt = new Date(
        Date.now() + (result.isMiss
          ? MISS_TTL_HOURS * 60 * 60 * 1000
          : HIT_TTL_DAYS * 24 * 60 * 60 * 1000)
      ).toISOString()

      await supabase
        .from('stream_resolutions')
        .upsert({
          title_key: titleKey,
          artist_key: artistKey,
          duration_bucket: durBucket,
          source: result.source,
          resolved_id: result.resolvedId,
          resolved_title: result.title || null,
          resolved_artist: result.artist || null,
          resolved_duration: result.duration || null,
          resolved_cover_url: result.coverUrl || null,
          is_miss: result.isMiss,
          fail_count: 0,
          updated_at: new Date().toISOString(),
          expires_at: expiresAt,
        }, {
          onConflict: 'title_key,artist_key,duration_bucket',
        })
    } catch (e) {
      console.warn('Failed to persist stream resolution:', e)
    }
  }

  return respondWith(result)
}

function respondWith(entry: L1Entry): Response {
  if (entry.isMiss) {
    return NextResponse.json({ miss: true }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  return NextResponse.json({
    source: entry.source,
    id: entry.resolvedId,
    resolvedId: entry.resolvedId,
    title: entry.title,
    artist: entry.artist,
    duration: entry.duration,
    coverUrl: entry.coverUrl,
  }, {
    status: 200,
    headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' },
  })
}
