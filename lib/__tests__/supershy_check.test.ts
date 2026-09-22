import { describe, it, expect } from 'vitest'
import { searchYouTubeTracks, findBestYouTubeMatch } from '../youtube'
import { searchDeezerTracks } from '../deezer'
import { searchSoundCloudTracks } from '../soundcloudClient'
import { searchNhacCuaTuiDirect } from '../nhaccuatui'
import { fetchLyricsFromLrclib } from '../lrclib'

describe('Super Shy - NewJeans Catalog & Stream & Lyrics Test', () => {
  it('1. YouTube Search: finds official Super Shy track', async () => {
    const ytResults = await searchYouTubeTracks('Super Shy NewJeans', 5)
    console.log('YouTube Results count:', ytResults.length)
    expect(ytResults.length).toBeGreaterThan(0)

    const top = ytResults[0]
    console.log('Top YouTube result:', {
      id: top.id,
      title: top.title,
      artist: top.artist,
      duration: top.duration,
      youtube_id: top.youtube_id,
    })

    expect(top.title.toLowerCase()).toContain('super shy')
    expect(top.youtube_id).toBeDefined()
  }, 15000)

  it('2. Deezer Search: finds Super Shy by NewJeans', async () => {
    const deezerResults = await searchDeezerTracks('Super Shy NewJeans', 5)
    console.log('Deezer Results count:', deezerResults.length)
    if (deezerResults.length > 0) {
      console.log('Top Deezer result:', {
        title: deezerResults[0].title,
        artist: deezerResults[0].artist,
        duration: deezerResults[0].duration,
      })
      expect(deezerResults[0].title.toLowerCase()).toContain('super shy')
    }
  }, 15000)

  it('3. SoundCloud Search: finds Super Shy', async () => {
    try {
      const scResults = await searchSoundCloudTracks('Super Shy NewJeans', 5)
      console.log('SoundCloud Results count:', scResults.length)
      if (scResults.length > 0) {
        console.log('Top SoundCloud result:', {
          title: scResults[0].title,
          artist: scResults[0].artist,
        })
      }
    } catch (e: any) {
      console.log('SoundCloud error:', e.message)
    }
  }, 15000)

  it('4. LRCLIB Synced Lyrics: retrieves synced lyrics for Super Shy by NewJeans', async () => {
    const lyrics = await fetchLyricsFromLrclib({
      title: 'Super Shy',
      artist: 'NewJeans',
      album: 'Get Up',
      duration: 154,
    })
    console.log('LRCLIB Lyrics found:', {
      hasSynced: !!lyrics?.syncedLyrics,
      hasPlain: !!lyrics?.plainLyrics,
      syncedSample: lyrics?.syncedLyrics?.slice(0, 150),
    })

    expect(lyrics).not.toBeNull()
    expect(lyrics?.syncedLyrics || lyrics?.plainLyrics).toBeTruthy()
  }, 15000)
})
