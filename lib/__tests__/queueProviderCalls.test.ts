import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueueTrack } from '@/types/queue'

const providers = vi.hoisted(() => ({
  nct: vi.fn(), soundcloud: vi.fn(), radio: vi.fn(), related: vi.fn(), top: vi.fn(), topic: vi.fn(), spotify: vi.fn(),
  rpc: vi.fn(), from: vi.fn(),
}))
vi.mock('../deezer', () => ({
  getDeezerArtistRadio: providers.radio, getDeezerRelatedArtistsTopTracks: providers.related,
  getDeezerArtistTopTracks: providers.top, searchDeezerTracks: providers.topic,
}))
vi.mock('../spotify', () => ({ searchSpotifyTracks: providers.spotify }))
vi.mock('../nhaccuatui', () => ({ searchNhacCuaTuiDirect: providers.nct }))
vi.mock('../soundcloudClient', () => ({ searchSoundCloudTracks: providers.soundcloud }))
vi.mock('@/lib/serverUser', () => ({ adminClient: { rpc: providers.rpc, from: providers.from } }))

import { buildNextQueue } from '../queueRecommend'

const seed: QueueTrack = {
  id: 'deezer-seed', title: 'Daylight', artist: 'Taylor Swift', duration: 200, cover_url: null,
  source: 'deezer', source_id: 'seed', score: 1, score_reasons: [],
}
function candidate(id: string, artist = 'Taylor Swift'): QueueTrack {
  return {
    ...seed, id: `deezer-${id}`, source_id: id, title: `Song ${id}`, artist,
    score_reasons: ['deezer_artist_radio'],
  }
}

describe('queue upstream provider budget', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    for (const provider of [providers.nct, providers.soundcloud, providers.radio, providers.related, providers.top, providers.topic, providers.spotify]) {
      provider.mockResolvedValue([])
    }
    providers.rpc.mockResolvedValue({ data: [], error: null })
    const query = {
      select: () => query, eq: () => query, order: () => query,
      limit: async () => ({ data: [] }), in: async () => ({ data: [] }),
    }
    providers.from.mockReturnValue(query)
  })

  it('stops after primary results fill the filtered diverse queue', async () => {
    providers.radio.mockResolvedValue([candidate('a'), candidate('b')])
    const result = await buildNextQueue(seed, [], undefined, 2)

    expect(result.tracks).toHaveLength(2)
    expect(providers.soundcloud).toHaveBeenCalledTimes(1)
    expect(providers.related).not.toHaveBeenCalled()
    expect(providers.topic).not.toHaveBeenCalled()
    expect(providers.top).not.toHaveBeenCalled()
    expect(providers.spotify).not.toHaveBeenCalled()
    expect(result.sources_failed).not.toContain('deezer_related')
  })

  it('expands when enough raw results still fail the per-artist diversity requirement', async () => {
    providers.radio.mockResolvedValue(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => candidate(id)))
    providers.related.mockResolvedValue([candidate('g', 'Sabrina Carpenter'), candidate('h', 'Sabrina Carpenter')])

    const result = await buildNextQueue(seed, [], undefined, 4)
    expect(providers.related).toHaveBeenCalledOnce()
    expect(result.tracks).toHaveLength(4)
    expect(result.tracks.filter((track) => track.artist === 'Taylor Swift')).toHaveLength(2)
  })

  it('checks session history and skipped tracks before deciding primary results are sufficient', async () => {
    providers.radio.mockResolvedValue([
      candidate('a'), candidate('b'), candidate('heard', 'Sabrina Carpenter'), candidate('skipped', 'Sabrina Carpenter'),
    ])
    providers.related.mockResolvedValue([candidate('g', 'Ariana Grande'), candidate('h', 'Ariana Grande')])
    providers.rpc.mockImplementation(async (name: string) => ({
      data: name === 'fn_get_frequently_skipped_tracks' ? [{ track_id: 'deezer-skipped' }] : [], error: null,
    }))

    const result = await buildNextQueue(seed, [candidate('heard', 'Sabrina Carpenter')], 'test-user', 4)
    expect(providers.related).toHaveBeenCalledOnce()
    expect(result.tracks).toHaveLength(4)
    expect(result.tracks.map((track) => track.id)).not.toContain('deezer-heard')
    expect(result.tracks.map((track) => track.id)).not.toContain('deezer-skipped')
  })

  it('keeps Spotify fallback when primary and expansion providers fail', async () => {
    providers.radio.mockRejectedValue(new Error('radio offline'))
    providers.soundcloud.mockRejectedValue(new Error('search offline'))
    providers.spotify.mockResolvedValue([
      { ...candidate('fallback-a'), id: 'spotify-a', spotify_id: 'a', source: 'spotify' },
      { ...candidate('fallback-b'), id: 'spotify-b', spotify_id: 'b', source: 'spotify' },
    ])

    const result = await buildNextQueue(seed, [], undefined, 2)
    expect(result.tracks).toHaveLength(2)
    expect(result.sources_used).toContain('spotify_fallback')
  })

  it('uses Spotify when diversity leaves a short queue even with five raw candidates', async () => {
    providers.radio.mockResolvedValue(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => candidate(id)))
    providers.related.mockResolvedValue(['g', 'h', 'i', 'j'].map((id) => candidate(id, 'Sabrina Carpenter')))
    providers.spotify.mockResolvedValue([
      { ...candidate('fallback-a', 'Ariana Grande'), id: 'spotify-a', spotify_id: 'a', source: 'spotify' },
      { ...candidate('fallback-b', 'Ariana Grande'), id: 'spotify-b', spotify_id: 'b', source: 'spotify' },
    ])

    const result = await buildNextQueue(seed, [], undefined, 6)
    expect(result.tracks).toHaveLength(6)
    expect(result.sources_used).toContain('spotify_fallback')
  })
})
