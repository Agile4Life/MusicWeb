import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ListeningHistoryItem, Track } from '@/types'
import { fetchListeningHistory, getRecentUniqueTracks } from '../listeningHistory'

type QueryResult = {
  data?: any[] | null
  error?: { message: string }
}

type QueryBehavior = {
  listeningHistory?: QueryResult
  tracks?: QueryResult
}

function createMockSupabase(behavior: QueryBehavior = {}) {
  const calls: Array<{ table: string; method: string; args: any[] }> = []

  const listeningHistoryQuery = {
    select: vi.fn((columns: string) => {
      calls.push({ table: 'listening_history', method: 'select', args: [columns] })
      return listeningHistoryQuery
    }),
    eq: vi.fn((column: string, value: string) => {
      calls.push({ table: 'listening_history', method: 'eq', args: [column, value] })
      return listeningHistoryQuery
    }),
    order: vi.fn((column: string, options: { ascending: boolean }) => {
      calls.push({ table: 'listening_history', method: 'order', args: [column, options] })
      return listeningHistoryQuery
    }),
    limit: vi.fn(async (count: number) => {
      calls.push({ table: 'listening_history', method: 'limit', args: [count] })
      return behavior.listeningHistory ?? { data: [], error: undefined }
    }),
  }

  const tracksQuery = {
    select: vi.fn((columns: string) => {
      calls.push({ table: 'tracks', method: 'select', args: [columns] })
      return tracksQuery
    }),
    in: vi.fn(async (column: string, values: string[]) => {
      calls.push({ table: 'tracks', method: 'in', args: [column, values] })
      return behavior.tracks ?? { data: [], error: undefined }
    }),
    order: vi.fn((column: string, options: { ascending: boolean }) => {
      calls.push({ table: 'tracks', method: 'order', args: [column, options] })
      return tracksQuery
    }),
    limit: vi.fn(async (count: number) => {
      calls.push({ table: 'tracks', method: 'limit', args: [count] })
      return behavior.tracks ?? { data: [], error: undefined }
    }),
  }

  const supabase = {
    from(table: string) {
      if (table === 'listening_history') return listeningHistoryQuery
      if (table === 'tracks') return tracksQuery
      throw new Error(`Unexpected table: ${table}`)
    },
  } as unknown as SupabaseClient

  return { supabase, calls, listeningHistoryQuery, tracksQuery }
}

describe('fetchListeningHistory', () => {
  it('preserves duplicate listening history rows for the same track', async () => {
    const { supabase, calls } = createMockSupabase({
      listeningHistory: {
        data: [
          { id: 'history-1', user_id: 'user-1', track_id: 'track-1', played_at: '2026-08-13T10:00:00.000Z' },
          { id: 'history-2', user_id: 'user-1', track_id: 'track-1', played_at: '2026-08-13T09:00:00.000Z' },
        ],
      },
      tracks: {
        data: [
          { id: 'track-1', title: 'Song A', artist: 'Artist A', duration: 180, file_path: '/a.mp3', cover_url: null, created_at: '2026-08-13T00:00:00.000Z' },
        ],
      },
    })

    const history = await fetchListeningHistory(supabase, 'user-1', 20)

    expect(history).toHaveLength(2)
    expect(history.map((item) => item.id)).toEqual(['history-1', 'history-2'])
    expect(history.every((item) => item.track?.id === 'track-1')).toBe(true)
    expect(calls.find((call) => call.table === 'listening_history' && call.method === 'select')?.args[0]).toBe('id, user_id, track_id, played_at')
    expect(calls.find((call) => call.table === 'tracks' && call.method === 'in')?.args).toEqual(['id', ['track-1']])
  })

  it('returns recent unique tracks in latest-play order', () => {
    const items: ListeningHistoryItem[] = [
      {
        id: 'history-1',
        user_id: 'user-1',
        track_id: 'track-1',
        played_at: '2026-08-13T10:00:00.000Z',
        track: { id: 'track-1', user_id: 'user-1', title: 'Newest', duration: 180, file_path: '/1.mp3', cover_url: null, created_at: '2026-08-13T00:00:00.000Z' },
      },
      {
        id: 'history-2',
        user_id: 'user-1',
        track_id: 'track-2',
        played_at: '2026-08-13T09:00:00.000Z',
        track: { id: 'track-2', user_id: 'user-1', title: 'Middle', duration: 180, file_path: '/2.mp3', cover_url: null, created_at: '2026-08-13T00:00:00.000Z' },
      },
      {
        id: 'history-3',
        user_id: 'user-1',
        track_id: 'track-1',
        played_at: '2026-08-13T08:00:00.000Z',
        track: { id: 'track-1', user_id: 'user-1', title: 'Older duplicate', duration: 180, file_path: '/1.mp3', cover_url: null, created_at: '2026-08-13T00:00:00.000Z' },
      },
    ]

    const uniqueTracks = getRecentUniqueTracks(items)

    expect(uniqueTracks.map((track) => track.id)).toEqual(['track-1', 'track-2'])
    expect(uniqueTracks[0].title).toBe('Newest')
  })

  it('skips listening history rows whose tracks are missing', async () => {
    const { supabase } = createMockSupabase({
      listeningHistory: {
        data: [
          { id: 'history-1', user_id: 'user-1', track_id: 'track-1', played_at: '2026-08-13T10:00:00.000Z' },
          { id: 'history-2', user_id: 'user-1', track_id: 'track-2', played_at: '2026-08-13T09:00:00.000Z' },
        ],
      },
      tracks: {
        data: [
          { id: 'track-1', title: 'Song A', artist: 'Artist A', duration: 180, file_path: '/a.mp3', cover_url: null, created_at: '2026-08-13T00:00:00.000Z' },
        ],
      },
    })

    const history = await fetchListeningHistory(supabase, 'user-1', 20)

    expect(history).toHaveLength(1)
    expect(history[0].id).toBe('history-1')
    expect(history[0].track?.id).toBe('track-1')
  })

  it('returns query errors to the caller', async () => {
    const { supabase } = createMockSupabase({
      listeningHistory: {
        error: { message: 'history query failed' },
      },
    })

    await expect(fetchListeningHistory(supabase, 'user-1', 20)).rejects.toThrow('history query failed')
  })
})
