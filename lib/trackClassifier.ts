import type { Track } from '@/types'
import { deduplicateQueueTracks } from './utils'

export type TrackRegion = 'vn' | 'kr' | 'jp' | 'cn' | 'us' | 'global'
export type TrackGenre = 'ballad' | 'indie' | 'rnb' | 'rap' | 'pop' | 'remix'

export interface TrackStyleProfile {
  region: TrackRegion
  regionConfidence: 'high' | 'medium' | 'low'
  genre: TrackGenre
  subGenres: TrackGenre[]
  artistCanonical: string
  relatedArtists: string[]
  queryTerms: string[]
}

export interface ClassifiableTrackInput {
  id?: string
  title?: string | null
  artist?: string | null
  album?: string | null
  genre?: string | null
  source?: string | null
}

interface ArtistProfileSeed {
  canonical: string
  aliases: string[]
  region: TrackRegion
  genre: TrackGenre
  subGenres?: TrackGenre[]
  related: string[]
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

function normalizeLookupToken(str: string): string {
  return removeDiacritics(str)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const ARTIST_KNOWLEDGE_SEEDS: ArtistProfileSeed[] = [
  // ======================== V-POP: BALLAD ========================
  {
    canonical: 'Bùi Anh Tuấn',
    aliases: ['bui anh tuan'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Trung Quân', 'Mr. Siro', 'Hương Tràm', 'Bằng Kiều', 'Hà Anh Tuấn'],
  },
  {
    canonical: 'Trung Quân',
    aliases: ['trung quan', 'trung quan idol', 'bui trung quan'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Bùi Anh Tuấn', 'Thùy Chi', 'Văn Mai Hương', 'Hà Anh Tuấn'],
  },
  {
    canonical: 'Mr. Siro',
    aliases: ['mr siro', 'mrsiro'],
    region: 'vn',
    genre: 'ballad',
    related: ['Bùi Anh Tuấn', 'Hương Tràm', 'Bảo Anh', 'Erik', 'Đạt G'],
  },
  {
    canonical: 'Hà Anh Tuấn',
    aliases: ['ha anh tuan'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['indie', 'pop'],
    related: ['Phan Mạnh Quỳnh', 'Vũ.', 'Trung Quân', 'Phương Linh'],
  },
  {
    canonical: 'Phan Mạnh Quỳnh',
    aliases: ['phan manh quynh'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['indie'],
    related: ['Hà Anh Tuấn', 'Vũ.', 'Bùi Anh Tuấn', 'Hoàng Dũng'],
  },
  {
    canonical: 'Đức Phúc',
    aliases: ['duc phuc'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Erik', 'Hoà Minzy', 'Noo Phước Thịnh', 'Bùi Anh Tuấn'],
  },
  {
    canonical: 'Erik',
    aliases: ['erik', 'le trung thanh'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Đức Phúc', 'Hoà Minzy', 'Mr. Siro', 'MIN'],
  },
  {
    canonical: 'Hoà Minzy',
    aliases: ['hoa minzy'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Đức Phúc', 'Erik', 'Mr. Siro', 'Văn Mai Hương'],
  },
  {
    canonical: 'Văn Mai Hương',
    aliases: ['van mai huong'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Trung Quân', 'Bùi Anh Tuấn', 'Hứa Kim Tuyền', 'Myra Trần'],
  },
  {
    canonical: 'Hương Tràm',
    aliases: ['huong tram'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Bùi Anh Tuấn', 'Mr. Siro', 'Đức Phúc', 'Erik'],
  },
  {
    canonical: 'Quân A.P',
    aliases: ['quan ap', 'quan a p'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['JayKii', 'Đạt G', 'Erik', 'Lou Hoàng'],
  },
  {
    canonical: 'JayKii',
    aliases: ['jaykii'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Quân A.P', 'Mr. Siro', 'Bùi Anh Tuấn', 'Andiez'],
  },
  {
    canonical: 'Andiez',
    aliases: ['andiez'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['JayKii', 'Hoàng Dũng', 'Bùi Anh Tuấn'],
  },
  {
    canonical: 'Đạt G',
    aliases: ['dat g', 'datg'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['rnb', 'rap'],
    related: ['DuUyen', 'Quân A.P', 'B Ray', 'Masew'],
  },
  {
    canonical: 'Trịnh Thăng Bình',
    aliases: ['trinh thang binh'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Mr. Siro', 'Chi Dân', 'Khắc Việt', 'Bùi Anh Tuấn'],
  },
  {
    canonical: 'Dương Hoàng Yến',
    aliases: ['duong hoang yen'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Bùi Anh Tuấn', 'Trung Quân', 'Quân A.P'],
  },
  {
    canonical: 'Phương Phương Thảo',
    aliases: ['phuong phuong thao'],
    region: 'vn',
    genre: 'ballad',
    related: ['Vũ Phụng Tiên', 'Tăng Phúc', 'Trung Quân'],
  },
  {
    canonical: 'Vũ Phụng Tiên',
    aliases: ['vu phung tien'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Phương Phương Thảo', 'Quân A.P', 'Đạt G'],
  },
  {
    canonical: 'Bảo Anh',
    aliases: ['bao anh'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Mr. Siro', 'Hương Tràm', 'Bích Phương'],
  },
  {
    canonical: 'Hồ Quang Hiếu',
    aliases: ['ho quang hieu'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Khắc Việt', 'Chi Dân', 'Trịnh Thăng Bình'],
  },
  {
    canonical: 'Noo Phước Thịnh',
    aliases: ['noo phuoc thinh'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Đông Nhi', 'Đức Phúc', 'Bùi Anh Tuấn'],
  },
  {
    canonical: 'Mỹ Tâm',
    aliases: ['my tam'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Hà Anh Tuấn', 'Phan Mạnh Quỳnh', 'Bằng Kiều'],
  },
  {
    canonical: 'Anh Tú',
    aliases: ['anh tu', 'voi ban don'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['LyLy', 'Trung Quân', 'Bùi Anh Tuấn', 'Erik'],
  },
  {
    canonical: 'LyLy',
    aliases: ['lyly'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop', 'rnb'],
    related: ['Anh Tú', 'AMEE', 'Hoàng Dũng', 'Orange'],
  },
  {
    canonical: 'Orange',
    aliases: ['orange'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['rnb', 'pop'],
    related: ['LyLy', 'Hoàng Dũng', 'Bùi Anh Tuấn'],
  },
  {
    canonical: 'Tăng Phúc',
    aliases: ['tang phuc'],
    region: 'vn',
    genre: 'ballad',
    related: ['Trương Thảo Nhi', 'Bùi Anh Tuấn', 'Trung Quân'],
  },
  {
    canonical: 'Jack',
    aliases: ['jack', 'j97'],
    region: 'vn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['K-ICM', 'Quân A.P', 'Đạt G'],
  },

  // ======================== V-POP: INDIE / ACOUSTIC ========================
  {
    canonical: 'Vũ.',
    aliases: ['vu', 'hoang thai vu'],
    region: 'vn',
    genre: 'indie',
    subGenres: ['ballad'],
    related: ['Hoàng Dũng', 'Ngọt', 'Chillies', 'Cá Hồi Hoang', 'Thịnh Suy'],
  },
  {
    canonical: 'Hoàng Dũng',
    aliases: ['hoang dung'],
    region: 'vn',
    genre: 'indie',
    subGenres: ['ballad'],
    related: ['Vũ.', 'Phan Mạnh Quỳnh', 'Thịnh Suy', 'GREY D'],
  },
  {
    canonical: 'Ngọt',
    aliases: ['ngot', 'ngot band', 'thang'],
    region: 'vn',
    genre: 'indie',
    related: ['Cá Hồi Hoang', 'Chillies', 'Vũ.', 'Đen'],
  },
  {
    canonical: 'Cá Hồi Hoang',
    aliases: ['ca hoi hoang'],
    region: 'vn',
    genre: 'indie',
    related: ['Ngọt', 'Chillies', 'Vũ.', 'The Cassette'],
  },
  {
    canonical: 'Chillies',
    aliases: ['chillies'],
    region: 'vn',
    genre: 'indie',
    subGenres: ['pop'],
    related: ['Vũ.', 'Ngọt', 'Cá Hồi Hoang', 'Da LAB'],
  },
  {
    canonical: 'Da LAB',
    aliases: ['da lab', 'dalab'],
    region: 'vn',
    genre: 'indie',
    subGenres: ['pop', 'rap'],
    related: ['Chillies', 'Vũ.', 'Đen', 'Tiên Tiên'],
  },
  {
    canonical: 'Thịnh Suy',
    aliases: ['thinh suy'],
    region: 'vn',
    genre: 'indie',
    related: ['Vũ.', 'Hoàng Dũng', 'Ngọt', 'GREY D'],
  },
  {
    canonical: 'Tiên Tiên',
    aliases: ['tien tien'],
    region: 'vn',
    genre: 'indie',
    subGenres: ['rnb', 'pop'],
    related: ['Trang', 'Vũ.', 'JustaTee', 'Hoàng Dũng'],
  },
  {
    canonical: 'Phùng Khánh Linh',
    aliases: ['phung khanh linh'],
    region: 'vn',
    genre: 'indie',
    subGenres: ['pop', 'ballad'],
    related: ['Hoàng Dũng', 'Vũ.', 'LyLy'],
  },
  {
    canonical: 'Kai Đinh',
    aliases: ['kai dinh'],
    region: 'vn',
    genre: 'indie',
    subGenres: ['ballad', 'rnb'],
    related: ['GREY D', 'Hoàng Dũng', 'MIN', 'Orange'],
  },

  // ======================== V-POP: R&B / CHILL ========================
  {
    canonical: 'GREY D',
    aliases: ['grey d', 'greyd', 'doan the lan'],
    region: 'vn',
    genre: 'rnb',
    subGenres: ['indie', 'ballad'],
    related: ['tlinh', 'Wren Evans', 'Hoàng Dũng', 'Vũ.', 'Chillies'],
  },
  {
    canonical: 'Wren Evans',
    aliases: ['wren evans'],
    region: 'vn',
    genre: 'rnb',
    subGenres: ['pop', 'indie'],
    related: ['tlinh', 'GREY D', 'MONO', 'RPT MCK', 'Mỹ Anh'],
  },
  {
    canonical: 'tlinh',
    aliases: ['tlinh', 'nguyen thao linh'],
    region: 'vn',
    genre: 'rnb',
    subGenres: ['rap', 'pop'],
    related: ['RPT MCK', 'Wren Evans', 'GREY D', 'Wxrdie', 'Low G'],
  },
  {
    canonical: 'SOOBIN',
    aliases: ['soobin', 'soobin hoang son'],
    region: 'vn',
    genre: 'rnb',
    subGenres: ['pop', 'ballad'],
    related: ['JustaTee', 'Rhymastic', 'Binz', 'Sơn Tùng M-TP', 'MONO'],
  },
  {
    canonical: 'JustaTee',
    aliases: ['justatee', 'jaytee'],
    region: 'vn',
    genre: 'rnb',
    subGenres: ['rap', 'pop'],
    related: ['Phương Ly', 'Rhymastic', 'SOOBIN', 'BigDaddy'],
  },
  {
    canonical: 'Rhymastic',
    aliases: ['rhymastic', 'yc'],
    region: 'vn',
    genre: 'rnb',
    subGenres: ['rap'],
    related: ['JustaTee', 'SOOBIN', 'Binz', 'Đen'],
  },
  {
    canonical: 'Phương Ly',
    aliases: ['phuong ly'],
    region: 'vn',
    genre: 'rnb',
    subGenres: ['pop', 'indie'],
    related: ['JustaTee', 'AMEE', 'MIN', 'GREY D'],
  },
  {
    canonical: 'AMEE',
    aliases: ['amee'],
    region: 'vn',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['GREY D', 'Phương Ly', 'Hoàng Duyên', 'Ricky Star'],
  },
  {
    canonical: 'MIN',
    aliases: ['min'],
    region: 'vn',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['Erik', 'Phương Ly', 'AMEE', 'JustaTee'],
  },
  {
    canonical: 'VSTRA',
    aliases: ['vstra'],
    region: 'vn',
    genre: 'rnb',
    subGenres: ['indie'],
    related: ['tlinh', 'Obito', 'RPT MCK', 'Wren Evans'],
  },

  // ======================== V-POP: RAP / HIP-HOP ========================
  {
    canonical: 'RPT MCK',
    aliases: ['mck', 'rpt mck', 'nger', 'nghiem vu hoang long'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['rnb'],
    related: ['tlinh', 'Wxrdie', 'Obito', 'HIEUTHUHAI', 'Low G'],
  },
  {
    canonical: 'HIEUTHUHAI',
    aliases: ['hieuthuhai', 'hieu thu hai'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['rnb', 'pop'],
    related: ['HURRYKNG', 'MANBO', 'Negav', 'RPT MCK', 'Obito', 'Wren Evans'],
  },
  {
    canonical: 'HURRYKNG',
    aliases: ['hurrykng'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['rnb'],
    related: ['HIEUTHUHAI', 'MANBO', 'Negav', 'Obito'],
  },
  {
    canonical: 'MANBO',
    aliases: ['manbo'],
    region: 'vn',
    genre: 'rap',
    related: ['HIEUTHUHAI', 'HURRYKNG', 'Negav'],
  },
  {
    canonical: 'Negav',
    aliases: ['negav'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['rnb', 'pop'],
    related: ['HIEUTHUHAI', 'HURRYKNG', 'GREY D', 'Wren Evans'],
  },
  {
    canonical: 'Wxrdie',
    aliases: ['wxrdie'],
    region: 'vn',
    genre: 'rap',
    related: ['RPT MCK', 'tlinh', '24k.Right', 'Low G', 'Gill'],
  },
  {
    canonical: 'Low G',
    aliases: ['low g', 'lowg'],
    region: 'vn',
    genre: 'rap',
    related: ['tlinh', 'RPT MCK', 'Obito', 'Wxrdie', 'Wrxdie'],
  },
  {
    canonical: 'Obito',
    aliases: ['obito'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['rnb'],
    related: ['RPT MCK', 'HIEUTHUHAI', 'VSTRA', 'tlinh', 'Shiki'],
  },
  {
    canonical: '24k.Right',
    aliases: ['24k.right', '24k right', '24kright'],
    region: 'vn',
    genre: 'rap',
    related: ['Wxrdie', 'B Ray', 'Rhyder', 'Double2T', 'RPT MCK'],
  },
  {
    canonical: 'Rhyder',
    aliases: ['rhyder', 'quang anh rhyder'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['rnb', 'pop'],
    related: ['Captain', 'HIEUTHUHAI', 'Obito', '24k.Right'],
  },
  {
    canonical: 'Captain',
    aliases: ['captain', 'captain boy'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['rnb'],
    related: ['Rhyder', 'Obito', 'B Ray', 'HIEUTHUHAI'],
  },
  {
    canonical: 'Đen',
    aliases: ['den', 'den vau'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['indie'],
    related: ['JustaTee', 'Vũ.', 'Ngọt', 'Binz', 'Karik'],
  },
  {
    canonical: 'Binz',
    aliases: ['binz', 'xuan dan'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['rnb'],
    related: ['SOOBIN', 'Rhymastic', 'JustaTee', 'Karik'],
  },
  {
    canonical: 'Karik',
    aliases: ['karik'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['pop'],
    related: ['B Ray', 'OnlyC', 'Binz', 'Đen'],
  },
  {
    canonical: 'B Ray',
    aliases: ['b ray', 'bray'],
    region: 'vn',
    genre: 'rap',
    related: ['Đạt G', 'Masew', 'AMEE', 'Karik', '24k.Right'],
  },
  {
    canonical: 'Double2T',
    aliases: ['double2t'],
    region: 'vn',
    genre: 'rap',
    related: ['Masew', '24k.Right', 'B Ray', 'Rhyder'],
  },
  {
    canonical: 'Robber',
    aliases: ['robber', 'hustlang robber'],
    region: 'vn',
    genre: 'rap',
    related: ['Wxrdie', 'RPT MCK', 'Lil Wuyn', '16 Typh'],
  },

  // ======================== V-POP: POP ========================
  {
    canonical: 'Sơn Tùng M-TP',
    aliases: ['son tung', 'son tung m tp', 'son tung mtp', 'm tp'],
    region: 'vn',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['MONO', 'SOOBIN', 'Wren Evans', 'Tăng Duy Tân'],
  },
  {
    canonical: 'MONO',
    aliases: ['mono', 'nguyen viet hoang'],
    region: 'vn',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['Sơn Tùng M-TP', 'Wren Evans', 'HIEUTHUHAI', 'GREY D', 'SOOBIN'],
  },
  {
    canonical: 'Tăng Duy Tân',
    aliases: ['tang duy tan'],
    region: 'vn',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['MONO', 'Bích Phương', 'Sơn Tùng M-TP', 'Hoàng Thùy Linh'],
  },
  {
    canonical: 'Hoàng Thùy Linh',
    aliases: ['hoang thuy linh'],
    region: 'vn',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['Bích Phương', 'Tăng Duy Tân', 'DTAP', 'Đen'],
  },
  {
    canonical: 'Bích Phương',
    aliases: ['bich phuong'],
    region: 'vn',
    genre: 'pop',
    subGenres: ['ballad', 'rnb'],
    related: ['Hoàng Thùy Linh', 'Tăng Duy Tân', 'MIN', 'Bảo Anh'],
  },
  {
    canonical: 'Quang Hùng MasterD',
    aliases: ['quang hung masterd'],
    region: 'vn',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['Dương Domic', 'Rhyder', 'HIEUTHUHAI', 'Negav'],
  },
  {
    canonical: 'Dương Domic',
    aliases: ['duong domic'],
    region: 'vn',
    genre: 'pop',
    subGenres: ['ballad', 'rnb'],
    related: ['Quang Hùng MasterD', 'HIEUTHUHAI', 'Rhyder', 'JSOL'],
  },
  {
    canonical: 'Hngle',
    aliases: ['hngle'],
    region: 'vn',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['Obito', 'RPT MCK', 'Wren Evans'],
  },
  {
    canonical: 'Dangrangto',
    aliases: ['dangrangto', 'donal', 'youngpuppy'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['rnb'],
    related: ['Obito', 'Low G', 'RPT MCK', 'Wxrdie'],
  },
  {
    canonical: 'marzuz',
    aliases: ['marzuz', 'changg'],
    region: 'vn',
    genre: 'indie',
    subGenres: ['rnb', 'pop'],
    related: ['HIEUTHUHAI', 'Wren Evans', 'GREY D', 'tlinh'],
  },
  {
    canonical: 'BigDaddy',
    aliases: ['bigdaddy', 'big daddy'],
    region: 'vn',
    genre: 'rap',
    subGenres: ['pop'],
    related: ['JustaTee', 'Bích Phương', 'SOOBIN', 'Emily'],
  },
  {
    canonical: 'Fishy',
    aliases: ['fishy'],
    region: 'vn',
    genre: 'rnb',
    subGenres: ['indie'],
    related: ['Obito', 'GREY D', 'Wren Evans'],
  },
  {
    canonical: 'CONGB',
    aliases: ['congb', 'buitruonglinh', 'wean', 'coolkid', 'codynamvo', 'phap kieu', '14 casper', 'sivan'],
    region: 'vn',
    genre: 'pop',
    subGenres: ['rnb', 'rap'],
    related: ['Quang Hùng MasterD', 'Dương Domic', 'HIEUTHUHAI', 'Wren Evans'],
  },

  // ======================== K-POP ========================
  {
    canonical: 'BTS',
    aliases: ['bts', 'bangtan', '방탄소년단'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rap', 'rnb'],
    related: ['Jungkook', 'Jimin', 'SEVENTEEN', 'TXT', 'EXO'],
  },
  {
    canonical: 'Jungkook',
    aliases: ['jungkook', 'jung kook', '정국'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['BTS', 'Jimin', 'V', 'NewJeans', 'SEVENTEEN'],
  },
  {
    canonical: 'Jimin',
    aliases: ['jimin', '지민'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['Jungkook', 'BTS', 'V', 'Taemin'],
  },
  {
    canonical: 'BLACKPINK',
    aliases: ['blackpink', '블랙핑크'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rap'],
    related: ['Jennie', 'Rosé', 'Lisa', 'aespa', 'BABYMONSTER', 'LE SSERAFIM'],
  },
  {
    canonical: 'Jennie',
    aliases: ['jennie', '제니'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rap', 'rnb'],
    related: ['BLACKPINK', 'Rosé', 'Lisa', 'aespa', 'Zico'],
  },
  {
    canonical: 'Rosé',
    aliases: ['rose', '로제'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['ballad', 'indie'],
    related: ['BLACKPINK', 'Jennie', 'IU', 'Taeyeon'],
  },
  {
    canonical: 'Lisa',
    aliases: ['lisa', 'lalisa', '리사'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rap'],
    related: ['BLACKPINK', 'Jennie', 'BABYMONSTER', 'aespa'],
  },
  {
    canonical: 'NewJeans',
    aliases: ['newjeans', '뉴진스'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['ILLIT', 'LE SSERAFIM', 'IVE', 'aespa', 'KISS OF LIFE'],
  },
  {
    canonical: 'ILLIT',
    aliases: ['illit', '아일릿'],
    region: 'kr',
    genre: 'pop',
    related: ['NewJeans', 'IVE', 'LE SSERAFIM', 'TWICE'],
  },
  {
    canonical: 'aespa',
    aliases: ['aespa', '에스파'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rap'],
    related: ['LE SSERAFIM', 'IVE', 'BLACKPINK', 'BABYMONSTER', 'ITZY'],
  },
  {
    canonical: 'IVE',
    aliases: ['ive', '아이브'],
    region: 'kr',
    genre: 'pop',
    related: ['LE SSERAFIM', 'NewJeans', 'aespa', 'TWICE', '(G)I-DLE'],
  },
  {
    canonical: 'LE SSERAFIM',
    aliases: ['le sserafim', 'lesserafim', '르세라핌'],
    region: 'kr',
    genre: 'pop',
    related: ['NewJeans', 'IVE', 'aespa', 'ILLIT', 'KISS OF LIFE'],
  },
  {
    canonical: 'BABYMONSTER',
    aliases: ['babymonster', '베이비몬스터'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rap'],
    related: ['BLACKPINK', 'aespa', '2NE1', 'ITZY'],
  },
  {
    canonical: 'KISS OF LIFE',
    aliases: ['kiss of life', '키스오브라이프'],
    region: 'kr',
    genre: 'rnb',
    subGenres: ['pop'],
    related: ['NewJeans', 'LE SSERAFIM', '(G)I-DLE', 'aespa'],
  },
  {
    canonical: 'IU',
    aliases: ['iu', '아이유'],
    region: 'kr',
    genre: 'ballad',
    subGenres: ['pop', 'indie'],
    related: ['Taeyeon', 'AKMU', 'BOL4', 'Heize'],
  },
  {
    canonical: 'TWICE',
    aliases: ['twice', '트와이스'],
    region: 'kr',
    genre: 'pop',
    related: ['IVE', 'Red Velvet', 'ITZY', 'ILLIT'],
  },
  {
    canonical: 'SEVENTEEN',
    aliases: ['seventeen', '세븐틴'],
    region: 'kr',
    genre: 'pop',
    related: ['BTS', 'NCT', 'TXT', 'RIIZE', 'ENHYPEN'],
  },
  {
    canonical: 'Stray Kids',
    aliases: ['stray kids', '스트레이 키즈'],
    region: 'kr',
    genre: 'rap',
    subGenres: ['pop'],
    related: ['NCT', 'ENHYPEN', 'SEVENTEEN', 'BIGBANG'],
  },
  {
    canonical: 'BIGBANG',
    aliases: ['bigbang', 'g dragon', 'gdragon', 'taeyang', '빅뱅'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rap', 'rnb'],
    related: ['2NE1', 'BTS', 'BLACKPINK', 'EXO'],
  },
  {
    canonical: 'EXO',
    aliases: ['exo', 'baekhyun', '엑소'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rnb', 'ballad'],
    related: ['BTS', 'SEVENTEEN', 'NCT', 'SHINee'],
  },
  {
    canonical: 'Red Velvet',
    aliases: ['red velvet', '레드벨벳'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['TWICE', 'aespa', 'IVE', 'IU'],
  },
  {
    canonical: 'NCT',
    aliases: ['nct', 'nct 127', 'nct dream', '엔시티'],
    region: 'kr',
    genre: 'pop',
    subGenres: ['rap', 'rnb'],
    related: ['RIIZE', 'SEVENTEEN', 'EXO', 'Stray Kids'],
  },
  {
    canonical: 'TXT',
    aliases: ['txt', 'tomorrow x together', '투모로우바이투게더'],
    region: 'kr',
    genre: 'pop',
    related: ['BTS', 'ENHYPEN', 'SEVENTEEN', 'RIIZE'],
  },
  {
    canonical: 'ITZY',
    aliases: ['itzy', '있지'],
    region: 'kr',
    genre: 'pop',
    related: ['aespa', 'TWICE', 'LE SSERAFIM', '(G)I-DLE'],
  },
  {
    canonical: 'RIIZE',
    aliases: ['riize', '라이즈'],
    region: 'kr',
    genre: 'pop',
    related: ['NCT', 'SEVENTEEN', 'TXT', 'TWS'],
  },

  // ======================== J-POP ========================
  {
    canonical: 'YOASOBI',
    aliases: ['yoasobi'],
    region: 'jp',
    genre: 'pop',
    related: ['Ado', 'Kenshi Yonezu', 'Vaundy', 'Official HIGE DANdism', 'Yorushika'],
  },
  {
    canonical: 'Kenshi Yonezu',
    aliases: ['kenshi yonezu', '米津玄師'],
    region: 'jp',
    genre: 'pop',
    subGenres: ['indie'],
    related: ['YOASOBI', 'Vaundy', 'Fujii Kaze', 'RADWIMPS', 'King Gnu'],
  },
  {
    canonical: 'Fujii Kaze',
    aliases: ['fujii kaze', '藤井風'],
    region: 'jp',
    genre: 'rnb',
    subGenres: ['pop', 'indie'],
    related: ['Kenshi Yonezu', 'Vaundy', 'imase', 'Official HIGE DANdism'],
  },
  {
    canonical: 'Ado',
    aliases: ['ado'],
    region: 'jp',
    genre: 'pop',
    related: ['YOASOBI', 'Eve', 'LiSA', 'Aimer'],
  },
  {
    canonical: 'RADWIMPS',
    aliases: ['radwimps'],
    region: 'jp',
    genre: 'indie',
    subGenres: ['pop', 'ballad'],
    related: ['Official HIGE DANdism', 'Kenshi Yonezu', 'YOASOBI', 'Aimer'],
  },
  {
    canonical: 'Official HIGE DANdism',
    aliases: ['official hige dandism', 'hige dandism'],
    region: 'jp',
    genre: 'pop',
    related: ['Mrs. GREEN APPLE', 'YOASOBI', 'Kenshi Yonezu', 'back number'],
  },
  {
    canonical: 'Vaundy',
    aliases: ['vaundy'],
    region: 'jp',
    genre: 'indie',
    subGenres: ['pop', 'rnb'],
    related: ['Fujii Kaze', 'Kenshi Yonezu', 'imase', 'YOASOBI'],
  },
  {
    canonical: 'Eve',
    aliases: ['eve'],
    region: 'jp',
    genre: 'pop',
    subGenres: ['indie'],
    related: ['YOASOBI', 'Ado', 'Kenshi Yonezu', 'Yorushika'],
  },
  {
    canonical: 'Aimer',
    aliases: ['aimer'],
    region: 'jp',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['LiSA', 'YOASOBI', 'RADWIMPS', 'Utada Hikaru'],
  },
  {
    canonical: 'LiSA',
    aliases: ['lisa jp'],
    region: 'jp',
    genre: 'pop',
    related: ['Aimer', 'YOASOBI', 'Ado'],
  },
  {
    canonical: 'imase',
    aliases: ['imase'],
    region: 'jp',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['Fujii Kaze', 'Vaundy', 'YOASOBI'],
  },

  // ======================== C-POP ========================
  {
    canonical: 'Jay Chou',
    aliases: ['jay chou', 'chau kiet luan', '周杰倫', '周杰伦'],
    region: 'cn',
    genre: 'pop',
    subGenres: ['ballad', 'rnb'],
    related: ['JJ Lin', 'Eric Chou', 'G.E.M.', 'Eason Chan'],
  },
  {
    canonical: 'G.E.M.',
    aliases: ['g e m', 'gem', 'dang tu ky', '鄧紫棋', '邓紫棋'],
    region: 'cn',
    genre: 'pop',
    subGenres: ['ballad'],
    related: ['Jay Chou', 'Eric Chou', 'Joker Xue', 'JJ Lin'],
  },
  {
    canonical: 'Eric Chou',
    aliases: ['eric chou', 'chau hung triet', '周興哲', '周兴哲'],
    region: 'cn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Jay Chou', 'Joker Xue', 'JJ Lin', 'G.E.M.'],
  },
  {
    canonical: 'Joker Xue',
    aliases: ['joker xue', 'tiet chi khiem', '薛之謙', '薛之谦'],
    region: 'cn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Eric Chou', 'Ronghao Li', 'Mao Buyi', 'Jay Chou'],
  },
  {
    canonical: 'JJ Lin',
    aliases: ['jj lin', 'lam tuan kiet', '林俊傑', '林俊杰'],
    region: 'cn',
    genre: 'ballad',
    subGenres: ['pop'],
    related: ['Jay Chou', 'Eric Chou', 'G.E.M.'],
  },

  // ======================== US-UK ========================
  {
    canonical: 'The Weeknd',
    aliases: ['the weeknd', 'weeknd'],
    region: 'us',
    genre: 'rnb',
    subGenres: ['pop'],
    related: ['SZA', 'Ariana Grande', 'Post Malone', 'Drake', 'Bruno Mars'],
  },
  {
    canonical: 'Taylor Swift',
    aliases: ['taylor swift'],
    region: 'us',
    genre: 'pop',
    subGenres: ['indie', 'ballad'],
    related: ['Olivia Rodrigo', 'Sabrina Carpenter', 'Ariana Grande', 'Billie Eilish', 'Lana Del Rey'],
  },
  {
    canonical: 'Ariana Grande',
    aliases: ['ariana grande'],
    region: 'us',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['The Weeknd', 'Sabrina Carpenter', 'Dua Lipa', 'Justin Bieber', 'SZA'],
  },
  {
    canonical: 'Justin Bieber',
    aliases: ['justin bieber'],
    region: 'us',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['Shawn Mendes', 'Charlie Puth', 'The Weeknd', 'Bruno Mars', 'Ariana Grande'],
  },
  {
    canonical: 'Bruno Mars',
    aliases: ['bruno mars', 'silk sonic'],
    region: 'us',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['The Weeknd', 'Ed Sheeran', 'Maroon 5', 'Justin Bieber'],
  },
  {
    canonical: 'Ed Sheeran',
    aliases: ['ed sheeran'],
    region: 'us',
    genre: 'pop',
    subGenres: ['ballad', 'indie'],
    related: ['Shawn Mendes', 'Charlie Puth', 'Coldplay', 'Maroon 5', 'Bruno Mars'],
  },
  {
    canonical: 'Billie Eilish',
    aliases: ['billie eilish'],
    region: 'us',
    genre: 'indie',
    subGenres: ['pop', 'ballad'],
    related: ['Lana Del Rey', 'Olivia Rodrigo', 'Lorde', 'The Neighbourhood'],
  },
  {
    canonical: 'Lana Del Rey',
    aliases: ['lana del rey'],
    region: 'us',
    genre: 'indie',
    subGenres: ['ballad'],
    related: ['Billie Eilish', 'Cigarettes After Sex', 'The Neighbourhood', 'Taylor Swift'],
  },
  {
    canonical: 'Dua Lipa',
    aliases: ['dua lipa'],
    region: 'us',
    genre: 'pop',
    related: ['Ariana Grande', 'Sabrina Carpenter', 'Calvin Harris', 'Lady Gaga', 'Katy Perry'],
  },
  {
    canonical: 'Sabrina Carpenter',
    aliases: ['sabrina carpenter'],
    region: 'us',
    genre: 'pop',
    related: ['Taylor Swift', 'Olivia Rodrigo', 'Ariana Grande', 'Dua Lipa'],
  },
  {
    canonical: 'Olivia Rodrigo',
    aliases: ['olivia rodrigo'],
    region: 'us',
    genre: 'pop',
    subGenres: ['indie', 'ballad'],
    related: ['Taylor Swift', 'Sabrina Carpenter', 'Billie Eilish', 'Conan Gray'],
  },
  {
    canonical: 'Coldplay',
    aliases: ['coldplay'],
    region: 'us',
    genre: 'indie',
    subGenres: ['pop'],
    related: ['Imagine Dragons', 'OneRepublic', 'Maroon 5', 'Ed Sheeran'],
  },
  {
    canonical: 'Maroon 5',
    aliases: ['maroon 5'],
    region: 'us',
    genre: 'pop',
    related: ['Charlie Puth', 'OneRepublic', 'Bruno Mars', 'Coldplay'],
  },
  {
    canonical: 'Charlie Puth',
    aliases: ['charlie puth'],
    region: 'us',
    genre: 'pop',
    subGenres: ['rnb'],
    related: ['Shawn Mendes', 'Justin Bieber', 'Maroon 5', 'Lauv'],
  },
  {
    canonical: 'SZA',
    aliases: ['sza'],
    region: 'us',
    genre: 'rnb',
    subGenres: ['pop'],
    related: ['The Weeknd', 'Kendrick Lamar', 'Frank Ocean', 'Daniel Caesar', 'Ariana Grande'],
  },
  {
    canonical: 'Keshi',
    aliases: ['keshi'],
    region: 'us',
    genre: 'rnb',
    subGenres: ['indie'],
    related: ['Joji', 'Lauv', 'Jeremy Zucker', 'LANY', 'Daniel Caesar'],
  },
  {
    canonical: 'Joji',
    aliases: ['joji'],
    region: 'us',
    genre: 'rnb',
    subGenres: ['indie', 'ballad'],
    related: ['Keshi', 'Cigarettes After Sex', 'Billie Eilish', 'The Weeknd'],
  },
  {
    canonical: 'Drake',
    aliases: ['drake'],
    region: 'us',
    genre: 'rap',
    subGenres: ['rnb'],
    related: ['Travis Scott', '21 Savage', 'Future', 'Post Malone', 'Kendrick Lamar'],
  },
  {
    canonical: 'Post Malone',
    aliases: ['post malone'],
    region: 'us',
    genre: 'rap',
    subGenres: ['pop', 'rnb'],
    related: ['The Weeknd', 'Drake', 'Travis Scott', 'Juice WRLD'],
  },
  {
    canonical: 'Travis Scott',
    aliases: ['travis scott'],
    region: 'us',
    genre: 'rap',
    related: ['Drake', 'Metro Boomin', 'Future', 'Kanye West', 'Don Toliver'],
  },
  {
    canonical: 'Kendrick Lamar',
    aliases: ['kendrick lamar'],
    region: 'us',
    genre: 'rap',
    related: ['J. Cole', 'Drake', 'Travis Scott', 'SZA', 'Kanye West'],
  },
  {
    canonical: 'Eminem',
    aliases: ['eminem'],
    region: 'us',
    genre: 'rap',
    related: ['50 Cent', 'Dr. Dre', 'Kanye West', 'Kendrick Lamar'],
  },
  {
    canonical: 'Kanye West',
    aliases: ['kanye west', 'ye'],
    region: 'us',
    genre: 'rap',
    related: ['Travis Scott', 'Kendrick Lamar', 'Drake', 'Jay-Z'],
  },
  {
    canonical: 'Alan Walker',
    aliases: ['alan walker'],
    region: 'us',
    genre: 'remix',
    subGenres: ['pop'],
    related: ['Marshmello', 'Avicii', 'Martin Garrix', 'Kygo'],
  },
]

const GENRE_COMPATIBILITY_MATRIX: Record<TrackGenre, Record<TrackGenre, number>> = {
  ballad: {
    ballad: 1.0,
    indie: 0.82,
    pop: 0.55,
    rnb: 0.5,
    rap: 0.0,
    remix: 0.0,
  },
  indie: {
    indie: 1.0,
    ballad: 0.82,
    rnb: 0.75,
    pop: 0.55,
    rap: 0.0,
    remix: 0.0,
  },
  rnb: {
    rnb: 1.0,
    indie: 0.75,
    pop: 0.72,
    rap: 0.7,
    ballad: 0.52,
    remix: 0.0,
  },
  rap: {
    rap: 1.0,
    rnb: 0.8,
    pop: 0.5,
    ballad: 0.0,
    indie: 0.0,
    remix: 0.0,
  },
  pop: {
    pop: 1.0,
    rnb: 0.75,
    ballad: 0.6,
    indie: 0.6,
    rap: 0.48,
    remix: 0.0,
  },
  remix: {
    remix: 1.0,
    pop: 0.0,
    rap: 0.0,
    rnb: 0.0,
    ballad: 0.0,
    indie: 0.0,
  },
}

const REGION_QUERY_LABELS: Record<TrackRegion, string> = {
  vn: 'Vpop Nhạc Việt Hay Nhất',
  kr: 'Kpop Top Hits Trending',
  jp: 'Jpop Anime Top Hits',
  cn: 'Cpop Nhạc Hoa Douyin Hot',
  us: 'USUK Top Billboard Hits',
  global: 'Global Top Trending Hits',
}

const GENRE_QUERY_LABELS: Record<TrackGenre, string> = {
  ballad: 'Ballad Nhạc Trẻ Tâm Trạng Buồn',
  indie: 'Indie Chill Acoustic Lofi',
  rnb: 'RnB Chill Melodic',
  rap: 'Rap Hiphop Chill',
  pop: 'Pop Hits',
  remix: 'Remix House Vinahouse EDM',
}

function findMatchingArtistProfile(artistRaw: string, titleRaw: string): ArtistProfileSeed | null {
  const combinedSource = `${artistRaw || ''} ${titleRaw || ''}`
  const normArtist = normalizeLookupToken(artistRaw || '')
  const normCombined = normalizeLookupToken(combinedSource)

  // Split multi-artist delimiters: ',', '&', 'ft', 'feat', 'x', '-'
  const segments = (artistRaw || '')
    .split(/(?:,|&|\bft\.?\b|\bfeat\.?\b|\bx\b|\/|-)/i)
    .map((s) => normalizeLookupToken(s))
    .filter(Boolean)

  // 1. Exact segment match on artist field
  for (const seg of segments) {
    for (const seed of ARTIST_KNOWLEDGE_SEEDS) {
      if (seed.aliases.some((alias) => normalizeLookupToken(alias) === seg)) {
        return seed
      }
    }
  }

  // 2. Whole word boundary match in artist field, then combined text
  for (const seed of ARTIST_KNOWLEDGE_SEEDS) {
    for (const alias of seed.aliases) {
      const normAlias = normalizeLookupToken(alias)
      if (!normAlias || normAlias.length < 2) continue
      const escaped = normAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i')
      if (regex.test(normArtist)) {
        return seed
      }
    }
  }

  for (const seed of ARTIST_KNOWLEDGE_SEEDS) {
    for (const alias of seed.aliases) {
      const normAlias = normalizeLookupToken(alias)
      if (!normAlias || normAlias.length < 3) continue
      const escaped = normAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'i')
      if (regex.test(normCombined)) {
        return seed
      }
    }
  }

  return null
}

const VIETNAMESE_DIACRITIC_REGEX =
  /[áàảãạâấầẩẫậăắằẳẵặéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]/i
const KOREAN_SCRIPT_REGEX = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/
const JAPANESE_KANA_REGEX = /[\u3040-\u309f\u30a0-\u30ff]/
const CJK_HANZI_REGEX = /[\u4e00-\u9faf]/

const UNACCENTED_VN_TOKENS = new Set([
  'anh', 'em', 'yeu', 'buon', 'nho', 'thuong', 'mua', 'nang', 'tinh', 'chuyen',
  'nguoi', 'khong', 'mot', 'nhung', 'ngay', 'dem', 'tim', 've', 'xa', 'doi',
  'long', 'dau', 'mat', 'moi', 'ta', 'minh', 'cho', 'mai', 'cuoi', 'nhac',
  'viet', 'cua', 'chung', 'hay', 'nhat', 'loi', 'chia', 'tay', 'khoc', 'sau',
  'co', 'sao', 'con', 'giac', 'mo', 'hanh', 'phuc', 'co', 'don', 'ca', 'si',
])

function countVietnameseUnaccentedTokens(textNorm: string): number {
  const words = textNorm.split(/[^a-z0-9]+/).filter(Boolean)
  let hits = 0
  for (const w of words) {
    if (UNACCENTED_VN_TOKENS.has(w)) {
      hits += 1
    }
  }
  return hits
}

/**
 * Detect explicit genre overrides from title, album, or genre tag
 */
function detectExplicitGenreFromText(textNorm: string): TrackGenre | null {
  if (/\b(remix|vinahouse|house|edm|dj|club|bounce|dubstep|sped up|speed up|nonstop|mixtape)\b/i.test(textNorm)) {
    return 'remix'
  }
  if (/\b(indie|acoustic|lofi|lo-fi|chill|unplugged|folk|bedroom pop)\b/i.test(textNorm)) {
    return 'indie'
  }
  if (/\b(ballad|piano|sad|buon|tam trang|chia tay|khoc|co don)\b/i.test(textNorm)) {
    return 'ballad'
  }
  if (/\b(rap|hiphop|hip-hop|trap|drill|cypher|freestyle)\b/i.test(textNorm)) {
    return 'rap'
  }
  if (/\b(r&b|rnb|soul|melodic)\b/i.test(textNorm)) {
    return 'rnb'
  }
  return null
}

function isTrackStyleProfile(
  val: TrackStyleProfile | ClassifiableTrackInput
): val is TrackStyleProfile {
  return (
    typeof val === 'object' &&
    val !== null &&
    'regionConfidence' in val &&
    'subGenres' in val &&
    Array.isArray((val as TrackStyleProfile).subGenres)
  )
}

/**
 * Multi-Signal Track Classifier for Region & Genre
 */
export function classifyTrack(input: ClassifiableTrackInput): TrackStyleProfile {
  const title = (input.title || '').trim()
  const artist = (input.artist || '').trim()
  const album = (input.album || '').trim()
  const genreTag = (input.genre || '').trim()
  const rawText = `${title} ${artist} ${album} ${genreTag}`.toLowerCase()
  const textNorm = removeDiacritics(rawText)

  const artistSeed = findMatchingArtistProfile(artist, title)

  let region: TrackRegion = 'global'
  let regionConfidence: 'high' | 'medium' | 'low' = 'low'

  // 1. Check explicit Chinese/Douyin/Kpop/Jpop topic keywords first (for compilation/cover titles)
  if (/\b(douyin|cpop|c-pop|nhac hoa|trung quoc|hoa ngu|nhac trung)\b/i.test(textNorm)) {
    region = 'cn'
    regionConfidence = 'high'
  } else if (/\b(kpop|k-pop|nhac han)\b/i.test(textNorm) || KOREAN_SCRIPT_REGEX.test(rawText)) {
    region = 'kr'
    regionConfidence = 'high'
  } else if (/\b(jpop|j-pop|anime|nhac nhat)\b/i.test(textNorm) || JAPANESE_KANA_REGEX.test(rawText)) {
    region = 'jp'
    regionConfidence = 'high'
  } else if (artistSeed) {
    // 2. Curated Artist Knowledge Graph
    region = artistSeed.region
    regionConfidence = 'high'
  } else if (CJK_HANZI_REGEX.test(rawText)) {
    // 3. CJK Hanzi without Japanese Kana
    region = 'cn'
    regionConfidence = 'high'
  } else if (VIETNAMESE_DIACRITIC_REGEX.test(`${title} ${artist} ${album}`)) {
    // 4. Vietnamese diacritics in title/artist/album (ignoring default 'Nghệ sĩ chưa xác định' placeholder)
    const cleanArtistCheck = artist.replace(/Nghệ sĩ chưa xác định|Chưa rõ nghệ sĩ/gi, '')
    if (VIETNAMESE_DIACRITIC_REGEX.test(`${title} ${cleanArtistCheck} ${album}`)) {
      region = 'vn'
      regionConfidence = 'high'
    }
  }

  if (region === 'global') {
    const vnTokenHits = countVietnameseUnaccentedTokens(
      removeDiacritics(`${title} ${artist.replace(/Nghệ sĩ chưa xác định|Chưa rõ nghệ sĩ/gi, '')}`)
    )
    if (vnTokenHits >= 2) {
      region = 'vn'
      regionConfidence = 'high'
    } else if (
      input.source === 'nhaccuatui' ||
      (typeof input.id === 'string' && input.id.startsWith('nct-'))
    ) {
      region = 'vn'
      regionConfidence = 'medium'
    } else if (/^[a-z0-9\s.,'?!()\-&_/]+$/i.test(`${title} ${artist}`) && (title || artist)) {
      region = 'us'
      regionConfidence = 'low'
    }
  }

  // Genre classification
  const explicitGenre = detectExplicitGenreFromText(textNorm)
  let genre: TrackGenre = 'pop'
  const subGenres = new Set<TrackGenre>()

  if (explicitGenre === 'remix') {
    genre = 'remix'
    if (artistSeed) {
      subGenres.add(artistSeed.genre)
      for (const sg of artistSeed.subGenres || []) subGenres.add(sg)
    }
  } else if (explicitGenre) {
    genre = explicitGenre
    if (artistSeed) {
      if (artistSeed.genre !== genre) subGenres.add(artistSeed.genre)
      for (const sg of artistSeed.subGenres || []) {
        if (sg !== genre) subGenres.add(sg)
      }
    }
  } else if (artistSeed) {
    genre = artistSeed.genre
    for (const sg of artistSeed.subGenres || []) {
      if (sg !== genre) subGenres.add(sg)
    }
  }

  const cleanArtist =
    artistSeed?.canonical ||
    artist.replace(/[\(\[\{].*?[\)\]\}]/g, '').trim()

  const relatedArtists = artistSeed ? [...artistSeed.related] : []

  // Build search query terms for recommendations
  const queryTerms: string[] = []
  if (
    cleanArtist &&
    cleanArtist !== 'Nghệ sĩ chưa xác định' &&
    cleanArtist !== 'Chưa rõ nghệ sĩ' &&
    cleanArtist !== 'YouTube Artist' &&
    cleanArtist !== 'Unknown Artist'
  ) {
    queryTerms.push(`${cleanArtist} ${genre === 'remix' ? 'remix' : 'hits'}`)
  }

  for (const rel of relatedArtists.slice(0, 2)) {
    queryTerms.push(rel)
  }

  queryTerms.push(`${REGION_QUERY_LABELS[region]} ${GENRE_QUERY_LABELS[genre]}`)
  queryTerms.push(REGION_QUERY_LABELS[region])

  return {
    region,
    regionConfidence,
    genre,
    subGenres: Array.from(subGenres),
    artistCanonical: cleanArtist,
    relatedArtists,
    queryTerms,
  }
}

/**
 * Compute compatibility between two genres in [0.0, 1.0].
 * Returns 0.0 for hard-blocked incompatible combinations (e.g. Ballad vs Remix/Rap).
 */
export function getGenreCompatibility(
  seedGenre: TrackGenre,
  candidateGenre: TrackGenre,
  seedSubGenres: TrackGenre[] = [],
  candidateSubGenres: TrackGenre[] = []
): number {
  // Hard block between remix and non-remix unless seed itself is remix
  if (seedGenre !== 'remix' && candidateGenre === 'remix') {
    return 0.0
  }
  if (seedGenre === 'remix' && candidateGenre !== 'remix') {
    return 0.0
  }

  const direct = GENRE_COMPATIBILITY_MATRIX[seedGenre]?.[candidateGenre] ?? 0.0
  if (direct === 0.0) {
    // Check if candidate's primary genre is explicitly blocked by seed's primary genre
    // (e.g., ballad seed strictly blocks rap primary candidate)
    if (
      (seedGenre === 'ballad' && candidateGenre === 'rap') ||
      (seedGenre === 'indie' && candidateGenre === 'rap') ||
      (seedGenre === 'rap' && (candidateGenre === 'ballad' || candidateGenre === 'indie'))
    ) {
      return 0.0
    }
  }

  let best = direct
  for (const sSub of seedSubGenres) {
    const subCompat = (GENRE_COMPATIBILITY_MATRIX[sSub]?.[candidateGenre] ?? 0) * 0.85
    if (subCompat > best) best = subCompat
  }
  for (const cSub of candidateSubGenres) {
    const subCompat = (GENRE_COMPATIBILITY_MATRIX[seedGenre]?.[cSub] ?? 0) * 0.85
    if (subCompat > best) best = subCompat
  }

  return Number(best.toFixed(3))
}

/**
 * Compute combined Region + Genre compatibility score in [0.0, 1.0].
 * Returns 0.0 if Region or Genre is incompatible.
 */
export function getStyleCompatibilityScore(
  seedInput: TrackStyleProfile | ClassifiableTrackInput,
  candidateInput: TrackStyleProfile | ClassifiableTrackInput,
  options?: { allowLowConfidenceRegion?: boolean }
): number {
  const seed = isTrackStyleProfile(seedInput) ? seedInput : classifyTrack(seedInput)
  const cand = isTrackStyleProfile(candidateInput) ? candidateInput : classifyTrack(candidateInput)

  // 1. Check Region Compatibility
  if (seed.region !== 'global' && cand.region !== 'global' && seed.region !== cand.region) {
    const canRelaxLowConfidence =
      Boolean(options?.allowLowConfidenceRegion) &&
      cand.regionConfidence === 'low' &&
      cand.region === 'us'
    // Also allow when seed itself is low-confidence generic fixture and candidate is medium-confidence default
    const isSeedGenericFixture =
      seed.regionConfidence === 'low' && cand.regionConfidence !== 'high'
    if (!canRelaxLowConfidence && !isSeedGenericFixture) {
      return 0.0
    }
  }

  // 2. Check Genre Compatibility
  const genreScore = getGenreCompatibility(
    seed.genre,
    cand.genre,
    seed.subGenres,
    cand.subGenres
  )
  if (genreScore < 0.45) {
    return 0.0
  }

  // Slight bonus if artist is in seed's relatedArtists
  const normCandArtist = normalizeLookupToken(cand.artistCanonical)
  const isRelatedArtist =
    normCandArtist.length > 1 &&
    seed.relatedArtists.some((rel) => normalizeLookupToken(rel) === normCandArtist)

  const total = Math.min(1.0, genreScore + (isRelatedArtist ? 0.1 : 0))
  return Number(total.toFixed(3))
}

/**
 * Boolean check whether candidate track is compatible with seed track's region and genre
 */
export function isTrackStyleCompatible(
  seedInput: TrackStyleProfile | ClassifiableTrackInput,
  candidateInput: TrackStyleProfile | ClassifiableTrackInput,
  options?: { allowLowConfidenceRegion?: boolean }
): boolean {
  return getStyleCompatibilityScore(seedInput, candidateInput, options) >= 0.45
}

/**
 * Filter and rank a mixed track pool into a style-coherent queue anchored on seedTrack.
 * Places seedTrack at index 0 so upcoming tracks match its region & genre.
 */
export function buildStyleCoherentQueue(seedTrack: Track, pool: Track[]): Track[] {
  if (!seedTrack) return pool
  if (!pool || pool.length === 0) return [seedTrack]

  const seedProfile = classifyTrack(seedTrack)
  const normSeedArtist = normalizeLookupToken(seedTrack.artist || '')

  const scoredItems: { track: Track; score: number; originalIndex: number }[] = []

  pool.forEach((item, idx) => {
    if (!item || item.id === seedTrack.id) return
    const candProfile = classifyTrack(item)
    const compat = getStyleCompatibilityScore(seedProfile, candProfile)
    if (compat < 0.45) return

    let rankScore = compat
    const normItemArtist = normalizeLookupToken(item.artist || '')
    if (normSeedArtist && normItemArtist === normSeedArtist) {
      rankScore += 0.15
    }
    scoredItems.push({ track: item, score: rankScore, originalIndex: idx })
  })

  scoredItems.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.05) {
      return b.score - a.score
    }
    return a.originalIndex - b.originalIndex
  })

  const ordered = [seedTrack, ...scoredItems.map((s) => s.track)]
  return deduplicateQueueTracks(ordered)
}

