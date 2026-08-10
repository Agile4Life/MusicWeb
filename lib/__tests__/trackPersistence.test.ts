import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Track } from '@/types'
import { resolveExternalTrackId } from '../trackPersistence'

interface MockQuery {
  select: (columns: string) => MockQuery
  eq: (column: string, value: string | null) => MockQuery
  limit?: (count: number) => Promise<{ data: any[] | null }>
  single?: () => Promise<{ data: any | null; error?: any }>
}

type MockSupabase = {
  from: (table: string) => MockQuery
}

function createMockSupabase(selectRow?: any, insertRow?: any): SupabaseClient {
  const selectQuery = {
    select(columns: string) {
      return this
    },
    eq(column: string, value: string | null) {
      return this
    },
    limit(count: number) {
      return Promise.resolve({ data: selectRow ? [selectRow] : [] })
    },
  } as unknown as MockQuery

  const insertQuery = {
    insert(row: any) {
      return this
    },
    select(columns: string) {
      return this
    },
    single() {
      return Promise.resolve({ data: insertRow || null, error: insertRow ? undefined : { message: 'insert failed' } })
    },
  } as unknown as MockQuery

  const supabase = {
    from(table: string) {
      if (table === 'tracks') {
        return {
          select: selectQuery.select.bind(selectQuery),
          insert: insertQuery.insert.bind(insertQuery),
          eq: selectQuery.eq.bind(selectQuery),
          limit: selectQuery.limit.bind(selectQuery),
          single: insertQuery.single.bind(insertQuery),
        }
      }
      return selectQuery
    },
  } as unknown as SupabaseClient

  return supabase
}

describe('resolveExternalTrackId', () => {
  it('returns local track id unchanged', async () => {
    const supabase = createMockSupabase()
    const track: Track = {
      id: 'local-123',
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
    expect(result).toBe('local-123')
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
})
