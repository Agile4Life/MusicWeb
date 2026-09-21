import { describe, it, expect } from 'vitest'
import { extractCleanTitleAndArtist, fetchLyricsFromLrclib } from '../lrclib'

describe('Lyrics Debug Tests', () => {
  it('should clean title and artist correctly for Sơn Tùng M-TP', () => {
    const rawTitle = 'Sơn Tùng M-TP - Chúng Ta Của Tương Lai (Official Music Video)'
    const rawArtist = 'Sơn Tùng M-TP'
    const cleaned = extractCleanTitleAndArtist(rawTitle, rawArtist)

    console.log('Cleaned result:', cleaned)
    expect(cleaned.cleanTitle).toBe('Chúng Ta Của Tương Lai')
    expect(cleaned.cleanArtist).toBe('Sơn Tùng M-TP')
  })

  it('should clean title and artist when title contains artist prefix', () => {
    const rawTitle = 'Sơn Tùng M-TP - Lạc Trôi'
    const cleaned = extractCleanTitleAndArtist(rawTitle, 'Sơn Tùng M-TP')
    expect(cleaned.cleanTitle).toBe('Lạc Trôi')
    expect(cleaned.cleanArtist).toBe('Sơn Tùng M-TP')
  })

  it('should fetch lyrics from LRCLIB for a popular song', async () => {
    const result = await fetchLyricsFromLrclib({
      title: 'Chúng Ta Của Tương Lai',
      artist: 'Sơn Tùng M-TP',
    })
    console.log('LRCLIB Result for Sơn Tùng M-TP:', result ? { id: result.id, trackName: result.trackName, hasSynced: !!result.syncedLyrics } : null)
    expect(result).not.toBeNull()
  })

  it('should test LRCLIB fallback with YouTube videoId if LRCLIB has no lyrics', async () => {
    // Testing a song that might fail LRCLIB or need youtube fallback
    const result = await fetchLyricsFromLrclib({
      title: 'Thiên Lý Ơi',
      artist: 'J97',
      youtubeId: 'W8rP_F9S-n4', // example YouTube video ID
    })
    console.log('LRCLIB/YT Fallback Result for J97:', result ? { source: result.artistName, plainLyricsLen: result.plainLyrics?.length } : null)
  }, 15000)

  it('should find lyrics by searching YouTube Music for audio track when MV videoId has no lyrics', async () => {
    const query = 'Sơn Tùng M-TP Lạc Trôi audio'
    const searchRes = await fetch('https://www.youtube.com/youtubei/v1/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB_REMIX',
            clientVersion: '1.20240101.01.00',
            hl: 'vi',
            gl: 'VN',
          },
        },
        query,
      }),
    })

    const searchData = await searchRes.json()
    const str = JSON.stringify(searchData)
    const matches = Array.from(new Set(Array.from(str.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)).map(m => m[1])))
    console.log('Search candidates:', matches.slice(0, 5))

    let foundLyrics = null
    for (const vid of matches.slice(0, 5)) {
      const nextRes = await fetch(`https://www.youtube.com/youtubei/v1/next`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB_REMIX',
              clientVersion: '1.20240101.01.00',
              hl: 'vi',
              gl: 'VN',
            },
          },
          videoId: vid,
        }),
      })

      const nextData = await nextRes.json()
      const tabs = nextData?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || []
      let browseId: string | null = null
      for (const t of tabs) {
        const endpoint = t.tabRenderer?.endpoint?.browseEndpoint
        if (endpoint?.browseId?.startsWith('MPLYt')) {
          browseId = endpoint.browseId
          break
        }
      }

      if (browseId) {
        const browseRes = await fetch('https://www.youtube.com/youtubei/v1/browse', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          body: JSON.stringify({
            context: {
              client: {
                clientName: 'WEB_REMIX',
                clientVersion: '1.20240101.01.00',
                hl: 'vi',
                gl: 'VN',
              },
            },
            browseId,
          }),
        })
        const browseData = await browseRes.json()
        const shelf = browseData?.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer
        const rawLyrics = shelf?.description?.runs?.map((r: any) => r.text).join('') || ''
        if (rawLyrics.length > 15) {
          foundLyrics = { vid, len: rawLyrics.length, sample: rawLyrics.substring(0, 80) }
          break
        }
      }
    }
    console.log('Found YouTube Lyrics result:', foundLyrics)
    expect(foundLyrics).not.toBeNull()
  })
})
