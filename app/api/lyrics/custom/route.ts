import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/authOptions'
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server'
import { adminClient } from '@/lib/serverUser'
import { getValidUserId, isAdmin } from '@/lib/accessControl'
import { resolveExternalTrackId } from '@/lib/trackPersistence'
import {
  CustomLyricsTrackIdentity,
  customLyricsToLrclibResponse,
  makeCustomLyricsLookupKey,
} from '@/lib/customLyrics'
import type { Track } from '@/types'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// In-memory store for instant reflection & fallback when DB is unreachable
const customLyricsMemoryStore = new Map<string, string | null>()

function getCandidateKeys(track: CustomLyricsTrackIdentity): string[] {
  const keys = new Set<string>()
  keys.add(makeCustomLyricsLookupKey(track))

  if (track.id && UUID_REGEX.test(track.id.trim())) {
    keys.add(`uuid:${track.id.trim().toLowerCase()}`)
  }
  const title = (track.title || '').trim().toLowerCase()
  const artist = (track.artist || '').trim().toLowerCase()
  if (title) {
    keys.add(`meta:${title}::${artist}`)
  }
  return Array.from(keys)
}

function isSupabaseConfigured(): boolean {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  return Boolean(url && !url.includes('placeholder.supabase.co'))
}

async function getAuthenticatedUserEmail(): Promise<string> {
  try {
    const session = await getServerSession(authOptions)
    if (session?.user?.email) {
      return session.user.email.trim().toLowerCase()
    }
  } catch {}

  try {
    const supabase = await createSupabaseServerClient()
    const { data } = await supabase.auth.getUser()
    if (data?.user?.email) {
      return data.user.email.trim().toLowerCase()
    }
  } catch {}

  return ''
}

function buildTrackOrFilters(track: CustomLyricsTrackIdentity): string[] {
  const filters: string[] = []
  const id = (track.id || '').trim()
  if (id && UUID_REGEX.test(id)) {
    filters.push(`id.eq.${id}`)
  }
  if (track.nhaccuatui_id) {
    filters.push(`nhaccuatui_id.eq.${track.nhaccuatui_id.trim()}`)
  }
  if (track.youtube_id) {
    filters.push(`youtube_id.eq.${track.youtube_id.trim()}`)
  }
  if (track.spotify_id) {
    filters.push(`spotify_id.eq.${track.spotify_id.trim()}`)
  }

  const scId =
    track.soundcloud_id ||
    (track.file_path?.startsWith('soundcloud:')
      ? track.file_path.slice('soundcloud:'.length).trim()
      : id.startsWith('sc-')
        ? id.slice(3).trim()
        : '')
  if (scId) {
    filters.push(`file_path.eq.soundcloud:${String(scId).trim()}`)
  }
  if (track.file_path && !track.file_path.includes(',')) {
    filters.push(`file_path.eq.${track.file_path.trim()}`)
  }
  return filters
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const track: CustomLyricsTrackIdentity = {
      id: searchParams.get('id'),
      source: searchParams.get('source'),
      title: searchParams.get('title') || '',
      artist: searchParams.get('artist'),
      album: searchParams.get('album'),
      duration: Number(searchParams.get('duration') || 0) || 0,
      youtube_id: searchParams.get('youtube_id'),
      nhaccuatui_id: searchParams.get('nhaccuatui_id'),
      soundcloud_id: searchParams.get('soundcloud_id'),
      spotify_id: searchParams.get('spotify_id'),
      file_path: searchParams.get('file_path'),
    }

    const candidateKeys = getCandidateKeys(track)
    for (const key of candidateKeys) {
      if (customLyricsMemoryStore.has(key)) {
        const memLyrics = customLyricsMemoryStore.get(key)
        if (!memLyrics) {
          return NextResponse.json({ found: false, rawLyrics: null, data: null })
        }
        const data = customLyricsToLrclibResponse(
          {
            id: track.id,
            title: track.title || 'Untitled Track',
            artist: track.artist,
            album: track.album,
            duration: track.duration,
          },
          memLyrics,
        )
        return NextResponse.json({ found: Boolean(data), rawLyrics: memLyrics, data })
      }
    }

    if (isSupabaseConfigured()) {
      const orFilters = buildTrackOrFilters(track)
      let matchedLyrics: string | null = null

      if (orFilters.length > 0) {
        const { data: idRows } = await adminClient
          .from('tracks')
          .select('id, title, artist, album, duration, lyrics')
          .or(orFilters.join(','))
          .not('lyrics', 'is', null)
          .limit(5)

        const validRow = (idRows || []).find((r) => typeof r.lyrics === 'string' && r.lyrics.trim().length > 0)
        if (validRow?.lyrics) {
          matchedLyrics = validRow.lyrics.trim()
        }
      }

      if (!matchedLyrics && track.title && track.title.trim()) {
        let query = adminClient
          .from('tracks')
          .select('id, title, artist, album, duration, lyrics')
          .ilike('title', track.title.trim())
          .not('lyrics', 'is', null)

        if (track.artist && track.artist.trim()) {
          query = query.ilike('artist', track.artist.trim())
        }

        const { data: titleRows } = await query.limit(5)
        const validRow = (titleRows || []).find((r) => typeof r.lyrics === 'string' && r.lyrics.trim().length > 0)
        if (validRow?.lyrics) {
          matchedLyrics = validRow.lyrics.trim()
        }
      }

      if (matchedLyrics) {
        for (const key of candidateKeys) {
          customLyricsMemoryStore.set(key, matchedLyrics)
        }
        const data = customLyricsToLrclibResponse(
          {
            id: track.id,
            title: track.title || 'Untitled Track',
            artist: track.artist,
            album: track.album,
            duration: track.duration,
          },
          matchedLyrics,
        )
        return NextResponse.json({ found: Boolean(data), rawLyrics: matchedLyrics, data })
      }
    }

    return NextResponse.json({ found: false, rawLyrics: null, data: null })
  } catch (err) {
    console.warn('[/api/lyrics/custom GET] error:', err)
    return NextResponse.json({ found: false, rawLyrics: null, data: null })
  }
}

export async function POST(req: NextRequest) {
  try {
    const email = await getAuthenticatedUserEmail()
    if (!email || !isAdmin(email)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Chỉ tài khoản Admin đã đăng nhập mới có quyền viết hoặc chỉnh sửa lời bài hát.',
        },
        { status: 403 },
      )
    }

    const body = await req.json()
    const rawTrack = body?.track as Track | undefined
    if (!rawTrack || !rawTrack.title) {
      return NextResponse.json(
        { success: false, error: 'Thiếu thông tin bài hát cần lưu lời.' },
        { status: 400 },
      )
    }

    const normalizedLyrics =
      typeof body?.lyrics === 'string' && body.lyrics.trim().length > 0
        ? body.lyrics.replace(/\r\n/g, '\n').trim()
        : null

    const candidateKeys = getCandidateKeys(rawTrack)
    for (const key of candidateKeys) {
      customLyricsMemoryStore.set(key, normalizedLyrics)
    }

    let persistedTrackId: string | null = null

    if (isSupabaseConfigured()) {
      const adminUserId = getValidUserId({ email })

      try {
        // 1. If saving non-empty lyrics, ensure at least one row exists in `public.tracks`
        if (normalizedLyrics) {
          persistedTrackId = await resolveExternalTrackId(adminClient, rawTrack, adminUserId)
          if (persistedTrackId) {
            customLyricsMemoryStore.set(`uuid:${persistedTrackId.toLowerCase()}`, normalizedLyrics)
          }
        }

        // 2. Update all matching rows by ID / external identifiers
        const orFilters = buildTrackOrFilters({
          ...rawTrack,
          id: persistedTrackId || rawTrack.id,
        })
        if (orFilters.length > 0) {
          await adminClient
            .from('tracks')
            .update({ lyrics: normalizedLyrics })
            .or(orFilters.join(','))
        }

        // 3. Also update rows matching exact title + artist (case-insensitive)
        if (rawTrack.title.trim()) {
          let updateQuery = adminClient
            .from('tracks')
            .update({ lyrics: normalizedLyrics })
            .ilike('title', rawTrack.title.trim())

          if (rawTrack.artist && rawTrack.artist.trim()) {
            updateQuery = updateQuery.ilike('artist', rawTrack.artist.trim())
          }
          await updateQuery
        }
      } catch (dbErr) {
        console.warn('[/api/lyrics/custom POST] DB persistence warning (cached in memory):', dbErr)
      }
    }

    const data = customLyricsToLrclibResponse(
      {
        id: persistedTrackId || rawTrack.id,
        title: rawTrack.title,
        artist: rawTrack.artist,
        album: rawTrack.album,
        duration: rawTrack.duration,
      },
      normalizedLyrics,
    )

    return NextResponse.json({
      success: true,
      trackId: persistedTrackId || rawTrack.id,
      rawLyrics: normalizedLyrics,
      data,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Lỗi xử lý lưu lời bài hát'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

