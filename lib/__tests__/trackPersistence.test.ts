import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Track } from '@/types'
import { resolveExternalTrackId, addTrackToPlaylist } from '../trackPersistence'

interface MockQuery {
  select: (columns: string) => MockQuery
  insert?: (row: any) => MockQuery
  eq: (column: string, value: string | null) => MockQuery
  ilike?: (column: string, value: string | null) => MockQuery
  limit?: (count: number) => Promise<{ data: any[] | null }>
  single?: () => Promise<{ data: any | null; error?: any }>
}

type MockSupabase = {
  from: (table: string) => MockQuery
  rpc?: (fn: string, params: any) => Promise<{ error?: any }>
}

function createMockSupabase(selectRow?: any, insertRow?: any, onInsert?: (row: any) => void): SupabaseClient {
  const selectQuery: MockQuery = {
    select(columns: string) {
      return this
    },
    eq(column: string, value: string | null) {
      return this
    },
    ilike(column: string, value: string | null) {
      return this
    },
    limit(count: number) {
      return Promise.resolve({ data: selectRow ? [selectRow] : [] })
    },
  }

  const insertQuery: MockQuery = {
    select(columns: string) {
      return this
    },
    insert(row: any) {
      if (onInsert) onInsert(row)
      return this
    },
    single() {
      return Promise.resolve({ data: insertRow || null, error: insertRow ? undefined : { message: 'insert failed' } })
    },
    eq(column: string, value: string | null) {
      return this
    },
    ilike(column: string, value: string | null) {
      return this
    },
  }

  const supabase = {
    from(table: string) {
      if (table === 'tracks') {
        return {
          select: selectQuery.select.bind(selectQuery),
          insert: insertQuery.insert?.bind(insertQuery),
          eq: selectQuery.eq.bind(selectQuery),
          ilike: selectQuery.ilike?.bind(selectQuery),
          limit: selectQuery.limit?.bind(selectQuery),
          single: insertQuery.single?.bind(insertQuery),
        }
      }
      if (table === 'playlist_tracks') {
        return {
          insert: () => Promise.resolve({ error: undefined }),
        }
      }
      return selectQuery
    },
    rpc: () => Promise.resolve({ error: undefined }),
  } as unknown as SupabaseClient

  return supabase
}

describe('resolveExternalTrackId', () => {
  it('returns local track id unchanged when valid UUID', async () => {
    const supabase = createMockSupabase()
    const track: Track = {
      id: '00000000-0000-4000-a000-000000000005',
      user_id: 'user-1',
      title: 'Local Song',
      artist: 'Artist',
      duration: 120,
      file_path: '/music/song.mp3',
      cover_url: null,
      created_at: new Date().toISOString(),
      source: 'local',
    }

    const result = await resolveExternalTrackId(supabase, track, 'user-1')
    expect(result).toBe('00000000-0000-4000-a000-000000000005')
  })

  it('resolves an existing external track by nhaccuatui_id', async () => {
    const supabase = createMockSupabase({ id: 'existing-uuid' })
    const track: Track = {
      id: 'nct-abc',
      user_id: 'nhaccuatui-global',
      title: 'NCT Song',
      artist: 'Artist',
      duration: 180,
      file_path: '',
      cover_url: null,
      created_at: new Date().toISOString(),
      source: 'nhaccuatui',
      nhaccuatui_id: 'abc',
    }

    const result = await resolveExternalTrackId(supabase, track, 'user-1')
    expect(result).toBe('existing-uuid')
  })

  it('inserts a new external track when no row exists and returns new id', async () => {
    const supabase = createMockSupabase(undefined, { id: 'new-uuid' })
    const track: Track = {
      id: 'yt-video-1',
      user_id: 'youtube-global',
      title: 'YouTube Song',
      artist: 'YouTube Artist',
      duration: 200,
      file_path: 'https://www.youtube.com/watch?v=video-1',
      cover_url: 'https://img.youtube.com/vi/video-1/hqdefault.jpg',
      created_at: new Date().toISOString(),
      source: 'youtube',
      youtube_id: 'video-1',
    }

    const result = await resolveExternalTrackId(supabase, track, 'user-1')
    expect(result).toBe('new-uuid')
  })

  it('inserts a new external track when id prefix is present but source fields are missing', async () => {
    let insertedRow: any = null
    const supabase = createMockSupabase(undefined, { id: 'new-uuid' }, (row) => {
      insertedRow = row
    })

    const track: Track = {
      id: 'yt-video-1',
      user_id: 'youtube-global',
      title: 'YouTube Song',
      artist: 'YouTube Artist',
      duration: 200,
      file_path: '',
      cover_url: 'https://img.youtube.com/vi/video-1/hqdefault.jpg',
      created_at: new Date().toISOString(),
    }

    const result = await resolveExternalTrackId(supabase, track, 'user-1')

    expect(result).toBe('new-uuid')
    expect(insertedRow).not.toBeNull()
    expect(insertedRow.source).toBe('youtube')
    expect(insertedRow.youtube_id).toBe('video-1')
    expect(insertedRow.file_path).toBe('https://www.youtube.com/watch?v=video-1')
  })

  it('inserts a new deezer external track when id prefix is present and source is missing', async () => {
    let insertedRow: any = null
    const supabase = createMockSupabase(undefined, { id: 'new-uuid' }, (row) => {
      insertedRow = row
    })

    const track: Track = {
      id: 'deezer-12345',
      user_id: 'deezer-global',
      title: 'Deezer Song',
      artist: 'Deezer Artist',
      duration: 180,
      file_path: 'https://www.deezer.com/track/12345',
      cover_url: 'https://api.deezer.com/track/12345/image',
      created_at: new Date().toISOString(),
    }

    const result = await resolveExternalTrackId(supabase, track, 'user-1')

    expect(result).toBe('new-uuid')
    expect(insertedRow).not.toBeNull()
    expect(insertedRow.source).toBe('deezer')
    expect(insertedRow.file_path).toBe('https://www.deezer.com/track/12345')
  })
})

describe('addTrackToPlaylist', () => {
  it('handles 401 unauthenticated response with login prompt', async () => {
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Vui lòng đăng nhập' }),
    }) as any

    const track: Track = {
      id: '00000000-0000-4000-a000-000000000005',
      user_id: 'user-1',
      title: 'Song',
      duration: 180,
      file_path: '',
      cover_url: null,
      created_at: new Date().toISOString(),
    }
    const result = await addTrackToPlaylist('pl-1', track)
    expect(result.success).toBe(false)
    expect(result.message).toContain('Vui lòng đăng nhập')

    global.fetch = originalFetch
  })

  it('successfully adds valid track to playlist', async () => {
    const originalFetch = global.fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: 'Đã thêm bài hát vào playlist!' }),
    }) as any

    const track: Track = {
      id: '00000000-0000-4000-a000-000000000005',
      user_id: 'user-1',
      title: 'Song',
      duration: 180,
      file_path: '',
      cover_url: null,
      created_at: new Date().toISOString(),
    }
    const result = await addTrackToPlaylist('pl-1', track)
    expect(result.success).toBe(true)
    expect(result.message).toContain('Đã thêm bài hát vào playlist!')

    global.fetch = originalFetch
  })
})


