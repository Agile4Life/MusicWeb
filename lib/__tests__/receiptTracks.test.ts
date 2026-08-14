import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchReceiptTracks } from '../receiptTracks'
import { getAllValidUserIds, getValidUserId } from '../accessControl'
import { fetchFavoriteTracks } from '../favoriteTracks'

describe('getAllValidUserIds defense-in-depth', () => {
  it('handles email string passed as second parameter directly', () => {
    const ids = getAllValidUserIds(null, 'test@example.com')
    expect(ids.length).toBeGreaterThan(0)
    expect(ids[0]).toBe(getValidUserId({ email: 'test@example.com' }))
  })

  it('handles NextAuth session object in second parameter', () => {
    const ids = getAllValidUserIds(null, {
      user: { name: 'Phong', email: 'phong@example.com' },
    })
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain(getValidUserId({ email: 'phong@example.com' }))
  })

  it('handles Supabase currentUser and NextAuth session simultaneously', () => {
    const ids = getAllValidUserIds(
      { id: '11111111-1111-4000-a000-000000000001', email: 'supa@example.com' },
      { user: { email: 'next@example.com' } }
    )
    expect(ids).toContain('11111111-1111-4000-a000-000000000001')
    expect(ids).toContain(getValidUserId({ email: 'supa@example.com' }))
    expect(ids).toContain(getValidUserId({ email: 'next@example.com' }))
  })
})

describe('fetchReceiptTracks', () => {
  it('returns queue tracks when source is queue', async () => {
    const mockSupabase = {} as SupabaseClient
    const currentTrack = { id: 't-1', title: 'Song 1', artist: 'Artist 1', duration: 180 } as any
    const queue = [
      { id: 't-1', title: 'Song 1', artist: 'Artist 1', duration: 180 },
      { id: 't-2', title: 'Song 2', artist: 'Artist 2', duration: 240 },
    ] as any[]

    const result = await fetchReceiptTracks({
      supabase: mockSupabase,
      source: 'queue',
      currentTrack,
      queue,
    })

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ id: 't-1', title: 'Song 1', artist: 'Artist 1', duration: 180 })
    expect(result[1]).toEqual({ id: 't-2', title: 'Song 2', artist: 'Artist 2', duration: 240 })
  })

  it('fetches history tracks and falls back to in-memory queue if DB history is empty', async () => {
    const listeningHistoryQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    const mockSupabase = {
      from: vi.fn().mockReturnValue(listeningHistoryQuery),
    } as unknown as SupabaseClient

    const currentTrack = { id: 'fallback-1', title: 'Fallback Song', artist: 'Artist', duration: 200 } as any

    const result = await fetchReceiptTracks({
      supabase: mockSupabase,
      source: 'history',
      currentUser: { email: 'user@example.com' },
      currentTrack,
      queue: [],
    })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('fallback-1')
    expect(result[0].title).toBe('Fallback Song')
  })

  it('fetches history from database with correct track metadata', async () => {
    const historyData = [
      { id: 'h-1', user_id: 'user-1', track_id: 't-1', played_at: '2026-08-14T10:00:00Z' },
      { id: 'h-2', user_id: 'user-1', track_id: 't-2', played_at: '2026-08-14T09:00:00Z' },
    ]
    const tracksData = [
      { id: 't-1', title: 'DB Track 1', artist: 'Artist 1', duration: 210 },
      { id: 't-2', title: 'DB Track 2', artist: 'Artist 2', duration: 195 },
    ]

    const historyQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: historyData, error: null }),
    }
    const tracksQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: tracksData, error: null }),
    }

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'listening_history') return historyQuery
        if (table === 'tracks') return tracksQuery
        throw new Error(`Unexpected table: ${table}`)
      }),
    } as unknown as SupabaseClient

    const result = await fetchReceiptTracks({
      supabase: mockSupabase,
      source: 'history',
      currentUser: { id: 'user-1', email: 'user@test.com' },
    })

    expect(result).toHaveLength(2)
    expect(result[0].title).toBe('DB Track 1')
    expect(result[1].title).toBe('DB Track 2')
  })

  it('fetches favorites from favorite_tracks junction table and returns receipt tracks', async () => {
    const favData = [
      { id: 'f-1', user_id: 'user-1', track_id: 't-fav-1', created_at: '2026-08-14T10:00:00Z' },
    ]
    const tracksData = [
      { id: 't-fav-1', title: 'Fav Song 1', artist: 'Fav Artist', duration: 220 },
    ]

    const favQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: favData, error: null }),
    }
    const tracksQuery = {
      select: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: tracksData, error: null }),
    }

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'favorite_tracks') return favQuery
        if (table === 'tracks') return tracksQuery
        throw new Error(`Unexpected table: ${table}`)
      }),
    } as unknown as SupabaseClient

    const result = await fetchReceiptTracks({
      supabase: mockSupabase,
      source: 'favorites',
      currentUser: { id: 'user-1', email: 'user@test.com' },
    })

    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Fav Song 1')
  })
})
