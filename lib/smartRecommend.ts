import { Track } from '@/types'
import { searchYouTubeTracks, NEGATIVE_KEYWORDS, normalizeTitle } from './youtube'
import { deduplicateQueueTracks } from './utils'

export interface TrackMetadataAnalysis {
  region: 'vn' | 'kr' | 'jp' | 'us' | 'global'
  genre: 'pop' | 'ballad' | 'rap' | 'remix' | 'indie' | 'general'
  queryTerms: string[]
}

/**
 * Helper to remove Vietnamese diacritics / accents from text
 */
export function removeDiacritics(str: string): string {
  if (!str) return ''
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

/**
 * 🧠 Detect Region (Country/Language) and Genre of a Track
 */
export function analyzeTrackMetadata(track: Track): TrackMetadataAnalysis {
  const title = (track.title || '').toLowerCase()
  const artist = (track.artist || '').toLowerCase()
  const text = `${title} ${artist}`
  const textNorm = removeDiacritics(text)

  // 1. Detect Region / Country (Structured if ... else if chain)
  let region: TrackMetadataAnalysis['region'] = 'global'

  // Korean Hangul (가-힣) or K-Pop artists
  const koreanRegex = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/
  const kpopArtists = ['bts', 'blackpink', 'newjeans', 'twice', 'iu', 'seventeen', 'exo', 'stray kids', 'le sserafim', 'aespa', 'bigbang', 'red velvet', 'ive', 'nct', 'txt', 'itzy']

  // Japanese (Kanji / Hiragana / Katakana) or J-Pop artists
  const japaneseRegex = /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/
  const jpopArtists = ['yoasobi', 'kenshi yonezu', 'ado', 'aimer', 'radwimps', 'hige dandism', 'lisa', 'one ok rock', 'evelyn', 'eve', 'vaundy']

  // Vietnamese diacritics or V-Pop artists (both accented and unaccented)
  const vietnameseRegex = /[áàảãạâấầẩẫậăắằẳẵặéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/i
  const vpopArtists = [
    'mck', 'sơn tùng', 'son tung', 'hieuthuhai', 'hngle', 'vũ', 'vu', 'đen', 'den',
    'hoàng thùy linh', 'hoang thuy linh', 'grey d', 'tlinh', 'bảo anh', 'bao anh',
    'hồ quang hiếu', 'ho quang hieu', 'phan mạnh quỳnh', 'phan manh quynh',
    'bùi anh tuấn', 'bui anh tuan', 'mr siro', 'soobin', 'vũ phụng tiên',
    'đạt g', 'dat g', 'trịnh thăng bình', 'trinh thang binh', 'dương hoàng yến',
    'rhyder', 'captain', 'wxrdie', '24k.right', 'mono', 'phương phương thảo',
    'trung quân', 'trung quan', 'văn mai hương', 'van mai huong', 'đức phúc', 'duc phuc',
    'erik', 'hoà minzy', 'hoa minzy', 'jack', 'j97', 'k-icm', 'bích phương', 'bich phuong'
  ]

  const westernArtists = ['taylor swift', 'ariana grande', 'drake', 'the weeknd', 'justin bieber', 'bruno mars', 'ed sheeran', 'billie eilish', 'post malone', 'dua lipa', 'coldplay', 'maroon 5', 'katy perry', 'rihanna', 'beyonce', 'lady gaga', 'sza', 'travis scott', 'kanye west', 'eminem']

  if (koreanRegex.test(text) || kpopArtists.some((a) => textNorm.includes(a))) {
    region = 'kr'
  } else if (japaneseRegex.test(text) || jpopArtists.some((a) => textNorm.includes(a))) {
    region = 'jp'
  } else if (
    vietnameseRegex.test(text) ||
    vpopArtists.some((a) => textNorm.includes(removeDiacritics(a)))
  ) {
    region = 'vn'
  } else if (westernArtists.some((a) => textNorm.includes(a))) {
    region = 'us'
  } else if (/^[a-z0-9\s.,'?!()-]+$/i.test(text)) {
    // If text is ASCII only, check if artist looks Western vs default Global/VN
    region = 'us'
  }

  // 2. Detect Genre / Style
  let genre: TrackMetadataAnalysis['genre'] = 'pop'
  if (/\b(remix|house|edm|vinahouse|dj|club|bounce|dance|dubstep)\b/i.test(textNorm)) {
    genre = 'remix'
  } else if (/\b(rap|hiphop|hip-hop|trap|r&b|rnb|drill)\b/i.test(textNorm)) {
    genre = 'rap'
  } else if (/\b(ballad|lofi|chill|acoustic|piano|sad|buon|tam trang)\b/i.test(textNorm)) {
    genre = 'ballad'
  } else if (/\b(indie|alternative|rock|band)\b/i.test(textNorm)) {
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
 * Parallelized & Filtered against negative keywords (cover, karaoke, etc.)
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
    // 1. Fetch YouTube candidates in PARALLEL and filter NEGATIVE_KEYWORDS (cover, karaoke, etc.)
    const ytTasks = analysis.queryTerms.map((query) =>
      searchYouTubeTracks(query, 10)
        .then((results) =>
          results.filter((tr) => {
            const normTitle = normalizeTitle(tr.title || '')
            return !NEGATIVE_KEYWORDS.some((kw) => normTitle.includes(kw))
          })
        )
        .catch(() => [])
    )

    const ytResultsArray = await Promise.all(ytTasks)

    // Add YouTube matches next
    for (const ytResults of ytResultsArray) {
      for (const tr of ytResults) {
        if (!existingIds.has(tr.id) && recommended.length < limit + 10) {
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
