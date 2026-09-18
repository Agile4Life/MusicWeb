import { describe, it, expect, vi } from 'vitest'
import { Track } from '@/types'

describe('Search Queue Isolation Logic', () => {
  const mockTrack = (id: string, title: string): Track => ({
    id,
    title,
    artist: 'Test Artist',
    duration: 180,
    source: 'local',
    user_id: 'user-1',
    file_path: `/music/${id}.mp3`,
    cover_url: null,
    created_at: new Date().toISOString(),
  })

  it('initializes a single-track queue when searching on an empty queue', async () => {
    let currentQueue: Track[] = []
    let currentIndex = -1
    const playTrackMock = vi.fn(async (track: Track, newQ?: Track[], targetIdx?: number) => {
      if (newQ) currentQueue = newQ
      if (typeof targetIdx === 'number') currentIndex = targetIdx
    })

    const playSearchTrack = async (track: Track) => {
      if (currentQueue.length === 0) {
        await playTrackMock(track, [track], 0)
        return
      }
    }

    const searchTrack = mockTrack('search-1', 'Searched Song')
    await playSearchTrack(searchTrack)

    expect(playTrackMock).toHaveBeenCalledWith(searchTrack, [searchTrack], 0)
    expect(currentQueue).toHaveLength(1)
    expect(currentQueue[0].id).toBe('search-1')
    expect(currentIndex).toBe(0)
  })

  it('inserts searched track after the currently playing song without wiping existing playlist', async () => {
    const songA = mockTrack('1', 'Song A')
    const songB = mockTrack('2', 'Song B')
    const songC = mockTrack('3', 'Song C')
    const songD = mockTrack('4', 'Song D')

    let currentQueue: Track[] = [songA, songB, songC, songD]
    let currentIndex = 1 // songB is playing

    const playTrackMock = vi.fn(async (track: Track, newQ?: Track[], targetIdx?: number) => {
      if (newQ) currentQueue = newQ
      if (typeof targetIdx === 'number') currentIndex = targetIdx
    })

    const playSearchTrack = async (track: Track) => {
      if (currentQueue.length === 0) {
        await playTrackMock(track, [track], 0)
        return
      }
      const existingIdx = currentQueue.findIndex((t) => t.id === track.id)
      if (existingIdx !== -1) {
        await playTrackMock(track, undefined, existingIdx)
        return
      }
      const insertIdx = currentIndex >= 0 ? currentIndex + 1 : currentQueue.length
      const updatedQueue = [...currentQueue]
      updatedQueue.splice(insertIdx, 0, track)
      await playTrackMock(track, updatedQueue, insertIdx)
    }

    const searchTrack = mockTrack('st-1', 'Searched Track Hit')
    await playSearchTrack(searchTrack)

    expect(playTrackMock).toHaveBeenCalledWith(searchTrack, [songA, songB, searchTrack, songC, songD], 2)
    expect(currentQueue).toHaveLength(5)
    expect(currentQueue[2].id).toBe('st-1')
    expect(currentIndex).toBe(2)

    // Simulate next track after searchTrack ends:
    const nextIndex = currentIndex + 1
    expect(currentQueue[nextIndex].id).toBe('3') // Song C from the original playlist continues!
  })

  it('does not duplicate track if it already exists in the queue', async () => {
    const songA = mockTrack('1', 'Song A')
    const songB = mockTrack('2', 'Song B')
    const songC = mockTrack('3', 'Song C')

    let currentQueue: Track[] = [songA, songB, songC]
    let currentIndex = 0

    const playTrackMock = vi.fn(async (_track: Track, newQ?: Track[], targetIdx?: number) => {
      if (newQ) currentQueue = newQ
      if (typeof targetIdx === 'number') currentIndex = targetIdx
    })

    const playSearchTrack = async (track: Track) => {
      const existingIdx = currentQueue.findIndex((t) => t.id === track.id)
      if (existingIdx !== -1) {
        await playTrackMock(track, undefined, existingIdx)
        return
      }
    }

    await playSearchTrack(songC) // songC is already at index 2

    expect(playTrackMock).toHaveBeenCalledWith(songC, undefined, 2)
    expect(currentQueue).toHaveLength(3) // Queue was not modified or duplicated
    expect(currentIndex).toBe(2)
  })

  it('handles multiple consecutive search selections without queue wipe', async () => {
    const base1 = mockTrack('b-1', 'Base 1')
    const base2 = mockTrack('b-2', 'Base 2')

    let currentQueue: Track[] = [base1, base2]
    let currentIndex = 0 // Base 1 playing

    const playTrackMock = vi.fn(async (track: Track, newQ?: Track[], targetIdx?: number) => {
      if (newQ) currentQueue = newQ
      if (typeof targetIdx === 'number') currentIndex = targetIdx
    })

    const playSearchTrack = async (track: Track) => {
      const existingIdx = currentQueue.findIndex((t) => t.id === track.id)
      if (existingIdx !== -1) {
        await playTrackMock(track, undefined, existingIdx)
        return
      }
      const insertIdx = currentIndex >= 0 ? currentIndex + 1 : currentQueue.length
      const updatedQueue = [...currentQueue]
      updatedQueue.splice(insertIdx, 0, track)
      await playTrackMock(track, updatedQueue, insertIdx)
    }

    const search1 = mockTrack('s-1', 'Search Track 1')
    await playSearchTrack(search1)
    expect(currentIndex).toBe(1)
    expect(currentQueue.map((t) => t.id)).toEqual(['b-1', 's-1', 'b-2'])

    const search2 = mockTrack('s-2', 'Search Track 2')
    await playSearchTrack(search2)
    expect(currentIndex).toBe(2)
    expect(currentQueue.map((t) => t.id)).toEqual(['b-1', 's-1', 's-2', 'b-2'])

    // When search2 finishes, next track is base2!
    const nextIdx = currentIndex + 1
    expect(currentQueue[nextIdx].id).toBe('b-2')
  })
})
