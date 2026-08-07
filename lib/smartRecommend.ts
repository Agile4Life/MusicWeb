import { Track } from '@/types'
import { searchITunesTracks } from './itunes'
import { searchYouTubeTracks } from './youtube'
import { deduplicateQueueTracks } from './utils'

export interface TrackMetadataAnalysis {
  region: 'vn' | 'kr' | 'jp' | 'us' | 'global'
  genre: 'pop' | 'ballad' | 'rap' | 'remix' | 'indie' | 'general'
  queryTerms: string[]
}

/**
 * 🧠 Detect Region (Country/Language) and Genre of a Track
 */
export function analyzeTrackMetadata(track: Track): TrackMetadataAnalysis {
  const title = (track.title || '').toLowerCase()
  const artist = (track.artist || '').toLowerCase()
  const text = `${title} ${artist}`

  // 1. Detect Region / Country
  let region: TrackMetadataAnalysis['region'] = 'global'

  // Korean Hangul (가-힣) or K-Pop artists
  const koreanRegex = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/
  const kpopArtists = ['bts', 'blackpink', 'newjeans', 'twice', 'iu', 'seventeen', 'exo', 'stray kids', 'le sserafim', 'aespa', 'bigbang', 'red velvet', 'ive', 'nct', 'txt', 'itzy']
  if (koreanRegex.test(text) || kpopArtists.some((a) => artist.includes(a))) {
    region = 'kr'
  }
  // Japanese (Kanji / Hiragana / Katakana) or J-Pop artists
  const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/
  const jpopArtists = ['yoasobi', 'kenshi yonezu', 'ado', 'aimer', 'radwimps', 'hige dandism', 'lisa', 'one ok rock', 'evelyn', 'eve', 'vaundy']
  if (japaneseRegex.test(text) || jpopArtists.some((a) => artist.includes(a))) {
    region = 'jp'
  }
  // Vietnamese diacritics or V-Pop artists
  const vietnameseRegex = /[áàảãạâấầẩẫậăắằẳẵặéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/i
  const vpopArtists = ['mck', 'sơn tùng', 'hieuthuhai', 'hngle', 'vũ', 'đen', 'hoàng thùy linh', 'grey d', 'tlinh', 'bảo anh', 'hồ quang hiếu', 'phan mạnh quỳnh', 'bùi anh tuấn', 'mr siro', 'soobin', 'vũ phụng tiên', 'đạt g', 'trịnh thang bình', 'dương hoàng yến', 'võ hạ trâm', 'rhyder', 'captain', 'wxrdie', '24k.right']
  if (vietnameseRegex.test(text) || vpopArtists.some((a) => artist.includes(a))) {
    region = 'vn'
  }
  // US-UK Western default if Latin characters with non-Vietnamese
  if (region === 'global') {
    const westernArtists = ['taylor swift', 'ariana grande', 'drake', 'the weeknd', 'justin bieber', 'bruno mars', 'ed sheeran', 'billie eilish', 'post malone', 'dua lipa', 'coldplay', 'maroon 5', 'katy perry', 'rihanna', 'beyonce', 'lady gaga', 'sza', 'travis scott', 'kanye west', 'eminem']
    if (westernArtists.some((a) => artist.includes(a))) {
      region = 'us'
    } else if (/^[a-z0-9\s.,'?!()-]+$/i.test(text)) {
      region = 'us'
    }
  }

  // 2. Detect Genre / Style
  let genre: TrackMetadataAnalysis['genre'] = 'pop'
  if (/\b(remix|house|edm|vinahouse|dj|club|bounce|dance|dubstep)\b/i.test(text)) {
    genre = 'remix'
  } else if (/\b(rap|hiphop|hip-hop|trap|r&b|rnb|drill)\b/i.test(text)) {
    genre = 'rap'
  } else if (/\b(ballad|lofi|chill|acoustic|piano|sad|buồn|tâm trạng)\b/i.test(text)) {
    genre = 'ballad'
  } else if (/\b(indie|alternative|rock|band)\b/i.test(text)) {
    genre = 'indie'
  }

  // 3. Generate query terms for recommendation search
  const queryTerms: string[] = []
  const cleanArtist = (track.artist || '').replace(/[\(\[\{].*?[\)\]\}]/g, '').trim()

  if (cleanArtist && cleanArtist !== 'Nghệ sĩ chưa xác định' && cleanArtist !== 'YouTube Artist') {
    queryTerms.push(`${cleanArtist} hit songs`)
  }

  const regionNames: Record<string, string> = {
    vn: 'Vpop Nhạc Việt Hay Nhất',
    kr: 'Kpop Top Hits Trending',
    jp: 'Jpop Anime Top Hits',
    us: 'USUK Top Billboard Hits',
    global: 'Global Top Trending Hits',
  }

  const genreKeywords: Record<string, string> = {
    remix: 'Remix House Vinahouse',
    rap: 'Rap Hiphop Chill',
    ballad: 'Ballad Lofi Nhạc Trẻ Tâm Trạng',
    indie: 'Indie Chill Acoustic',
    pop: 'Pop Hits',
    general: 'Hits',
  }

  queryTerms.push(`${regionNames[region]} ${genreKeywords[genre]}`)
  queryTerms.push(`${regionNames[region]}`)

  return { region, genre, queryTerms }
}

/**
 * 🚀 Fetch Smart Recommended Related Tracks matching region & genre
 */
export async function getSmartRecommendedTracks(
  seedTrack: Track,
  existingQueue: Track[] = [],
  limit = 10
): Promise<Track[]> {
  if (!seedTrack) return []

  const analysis = analyzeTrackMetadata(seedTrack)
  const existingIds = new Set(existingQueue.map((t) => t.id))
  existingIds.add(seedTrack.id)

  const recommended: Track[] = []

  try {
    // 1. Fetch iTunes candidates by region code
    const itunesRegion = analysis.region === 'kr' ? 'kr' : analysis.region === 'jp' ? 'jp' : analysis.region === 'vn' ? 'vn' : 'us'
    const itunesQuery = seedTrack.artist && seedTrack.artist !== 'Nghệ sĩ chưa xác định'
      ? `${seedTrack.artist}`
      : analysis.queryTerms[0]

    const itunesResults = await searchITunesTracks(itunesQuery, 12).catch(() => [])
    for (const tr of itunesResults) {
      if (!existingIds.has(tr.id)) {
        existingIds.add(tr.id)
        recommended.push(tr)
      }
    }

    // 2. Fetch YouTube candidates using region & genre queries
    for (const query of analysis.queryTerms) {
      if (recommended.length >= limit) break
      const ytResults = await searchYouTubeTracks(query, 10).catch(() => [])
      for (const tr of ytResults) {
        if (!existingIds.has(tr.id)) {
          existingIds.add(tr.id)
          recommended.push(tr)
        }
      }
    }
  } catch (err) {
    console.warn('getSmartRecommendedTracks warning:', err)
  }

  const deduplicated = deduplicateQueueTracks(recommended)
  return deduplicated.slice(0, limit)
}
