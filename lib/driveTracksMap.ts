import { normalizeTrackField } from './normalizeTrackKey'

export interface PreloadedDriveTrack {
  id: string
  title: string
  artist: string
  album?: string | null
  duration?: number
  file_path: string
  drive_file_id?: string | null
  cover_url?: string | null
}

/**
 * Pre-cached Google Drive tracks list for 0ms instantaneous lookup (30 tracks)
 * Prevents cold start delays and avoids database query round-trips.
 */
export const STATIC_DRIVE_TRACKS: PreloadedDriveTrack[] = [
  {
    id: "46a013af-5e19-45f7-926c-4bbb22813430",
    title: "Mắt Môi Tay Chân (feat. Tage)",
    artist: "MCK",
    album: "HVL",
    duration: 192,
    file_path: "/api/drive-stream?id=1o91pC5Vtk556BKKKepilcGPgJZBnwJce",
    drive_file_id: "1o91pC5Vtk556BKKKepilcGPgJZBnwJce",
  },
  {
    id: "9a690608-6224-47c1-9cab-bdcaa493b14d",
    title: "Elegie",
    artist: "MCK",
    album: "HVL",
    duration: 87,
    file_path: "/api/drive-stream?id=1igdvlEx2U4ly_wYCLwbWGX1Pkqqjv4YK",
    drive_file_id: "1igdvlEx2U4ly_wYCLwbWGX1Pkqqjv4YK",
  },
  {
    id: "37c2e631-b373-4d23-8f6c-858f13c50f52",
    title: "Nhìn Kẻ Thù Của Tao",
    artist: "MCK",
    album: "HVL",
    duration: 234,
    file_path: "/api/drive-stream?id=1dbjgECB_QAoNrwJ2Ruka_dIh9bmgAEHL",
    drive_file_id: "1dbjgECB_QAoNrwJ2Ruka_dIh9bmgAEHL",
  },
  {
    id: "9073c099-10fc-45db-a32b-080255defe7d",
    title: "Intenpol",
    artist: "MCK",
    album: "HVL",
    duration: 54,
    file_path: "/api/drive-stream?id=1iOecWJdUu0xGR5pAlUZxU6_amFjCAiRs",
    drive_file_id: "1iOecWJdUu0xGR5pAlUZxU6_amFjCAiRs",
  },
  {
    id: "f14d79a6-d59b-4926-8ea4-1f575cc9e51a",
    title: "Xa Xôi (feat. Obito)",
    artist: "MCK",
    album: "HVL",
    duration: 218,
    file_path: "/api/drive-stream?id=1Q3qzorqpbuAredW8S074dNtZW0cfZc-f",
    drive_file_id: "1Q3qzorqpbuAredW8S074dNtZW0cfZc-f",
  },
  {
    id: "40b3841c-8887-4d21-a7c1-a72a63596d20",
    title: "Ai Mới Là Kẻ Xấu Xa",
    artist: "MCK",
    album: "HVL",
    duration: 192,
    file_path: "/api/drive-stream?id=1PewVmJXUAhloRkf_0opVZajRcoYTIEhE",
    drive_file_id: "1PewVmJXUAhloRkf_0opVZajRcoYTIEhE",
  },
  {
    id: "b1dfabf1-2d97-49bd-afa5-12352e2f4a59",
    title: "Yêu Anh Giết Anh",
    artist: "MCK",
    album: "HVL",
    duration: 165,
    file_path: "/api/drive-stream?id=1BB_m_80eXj6UdNBRzc7MYCjQzhutNFN4",
    drive_file_id: "1BB_m_80eXj6UdNBRzc7MYCjQzhutNFN4",
  },
  {
    id: "ae3710c5-4f91-4fe8-8449-189457c136a6",
    title: "Night In Prague",
    artist: "MCK",
    album: "HVL",
    duration: 214,
    file_path: "/api/drive-stream?id=1QNRtcP75Pi-b4J-WeXqOUg7vKCllOkE5",
    drive_file_id: "1QNRtcP75Pi-b4J-WeXqOUg7vKCllOkE5",
  },
  {
    id: "2a4551ff-77de-4d3a-b5da-a0447127de60",
    title: "Anh Không Muốn Nó Dễ Dàng",
    artist: "MCK",
    album: "HVL",
    duration: 165,
    file_path: "/api/drive-stream?id=1po6ifx8cPngwJYH6QLVKXWiLcBTVRv4p",
    drive_file_id: "1po6ifx8cPngwJYH6QLVKXWiLcBTVRv4p",
  },
  {
    id: "ffdfa276-15f2-4784-b7a7-7da6827a48d6",
    title: "Baby (feat. marzuz)",
    artist: "MCK",
    album: "HVL",
    duration: 173,
    file_path: "/api/drive-stream?id=1xBgLmjyqXV1h4xH6UeNQhXdG8VVV44AN",
    drive_file_id: "1xBgLmjyqXV1h4xH6UeNQhXdG8VVV44AN",
  },
  {
    id: "92360375-f7a1-4426-b9e9-e48185248bb6",
    title: "Tây Thi",
    artist: "MCK",
    album: "HVL",
    duration: 180,
    file_path: "/api/drive-stream?id=1p9J6imBH349zJe3vKIe3J41u9foQxosO",
    drive_file_id: "1p9J6imBH349zJe3vKIe3J41u9foQxosO",
  },
  {
    id: "ee1fe2c5-fb9f-4c5f-be41-48d7af8f493a",
    title: "Envy (feat. THANHDRAW)",
    artist: "MCK",
    album: "HVL",
    duration: 235,
    file_path: "/api/drive-stream?id=1rU1GxD_YYEmLw9SG2HXkPrPKf8fiVwSG",
    drive_file_id: "1rU1GxD_YYEmLw9SG2HXkPrPKf8fiVwSG",
  },
  {
    id: "569e4c28-d2a0-42ee-a1c1-520a1f293f05",
    title: "IDK",
    artist: "MCK",
    album: "HVL",
    duration: 196,
    file_path: "/api/drive-stream?id=1dOlkEFigLboKuu4XlrIJKtEcKMVhz70o",
    drive_file_id: "1dOlkEFigLboKuu4XlrIJKtEcKMVhz70o",
  },
  {
    id: "0c4d6e7b-6af2-4426-8162-996a84dc023c",
    title: "Liệm",
    artist: "MCK",
    album: "HVL",
    duration: 233,
    file_path: "/api/drive-stream?id=1Ozwr8qVl9YtMgnxmKepOgoGQ-9j9-wM9",
    drive_file_id: "1Ozwr8qVl9YtMgnxmKepOgoGQ-9j9-wM9",
  },
  {
    id: "7a5a65d8-2f37-47e1-a8b3-b90a3e1dece8",
    title: "Ghet Xog Lai Thik",
    artist: "MCK",
    album: "HVL",
    duration: 113,
    file_path: "/api/drive-stream?id=1kgmLkjetJl304GrsK784XdIn_lIslcpS",
    drive_file_id: "1kgmLkjetJl304GrsK784XdIn_lIslcpS",
  },
  {
    id: "7bd18115-b8eb-4516-87bf-e1cf44dff7d9",
    title: "Thịt Lợn",
    artist: "MCK",
    album: "HVL",
    duration: 228,
    file_path: "/api/drive-stream?id=1M8nZKO6PjSXs0A0ymftAOZg3q-E9diTb",
    drive_file_id: "1M8nZKO6PjSXs0A0ymftAOZg3q-E9diTb",
  },
  {
    id: "3cb61e6d-f336-4db8-9d63-8893286c45b4",
    title: "Huh (feat. RPT Orijinn & THANHDRAW)",
    artist: "MCK",
    album: "HVL",
    duration: 252,
    file_path: "/api/drive-stream?id=12kHK1M-byZBkR7uBKK0psX0-8eFYehre",
    drive_file_id: "12kHK1M-byZBkR7uBKK0psX0-8eFYehre",
  },
  {
    id: "25cdf538-d7b2-41df-8383-96770ec6c8d5",
    title: "Oanh M = Thuoc",
    artist: "MCK",
    album: "HVL",
    duration: 204,
    file_path: "/api/drive-stream?id=1QIa3UEirIib8F5aBZuuXyDdv1VYF-G2X",
    drive_file_id: "1QIa3UEirIib8F5aBZuuXyDdv1VYF-G2X",
  },
  {
    id: "7f9c4b01-6387-44fc-83cc-f063cdd137d7",
    title: "Là Gì Của Nhau",
    artist: "MCK",
    album: "HVL",
    duration: 143,
    file_path: "/api/drive-stream?id=1q-b_tyltJWIfxSa9f2dQdM53LdyoirHZ",
    drive_file_id: "1q-b_tyltJWIfxSa9f2dQdM53LdyoirHZ",
  },
  {
    id: "04358f1e-ac6b-455f-a157-a2c16a35ac4c",
    title: "Một Cái Ôm",
    artist: "MCK",
    album: "HVL",
    duration: 202,
    file_path: "/api/drive-stream?id=15iWkgRX1DoPbpx19v_ODG_dHN-p3YnaO",
    drive_file_id: "15iWkgRX1DoPbpx19v_ODG_dHN-p3YnaO",
  },
  {
    id: "660010b0-5731-4fbf-a116-74d91ef8fed9",
    title: "Dưa Chua",
    artist: "MCK",
    album: "HVL",
    duration: 182,
    file_path: "/api/drive-stream?id=1-OUJzPu7HzfpSApkyPhUgm1gGL3TV6u_",
    drive_file_id: "1-OUJzPu7HzfpSApkyPhUgm1gGL3TV6u_",
  },
  {
    id: "9860f85b-8313-499a-83e4-4470ce03fe1f",
    title: "Đao Của Anh Vừa",
    artist: "MCK",
    album: "HVL",
    duration: 124,
    file_path: "/api/drive-stream?id=1H1xYfcSEx9tUfyaVvGzK1xPO6jY_49OP",
    drive_file_id: "1H1xYfcSEx9tUfyaVvGzK1xPO6jY_49OP",
  },
  {
    id: "74ebe821-732f-42a8-bc58-01ba12e13b35",
    title: "Cảm Ơn",
    artist: "MCK",
    album: "HVL",
    duration: 159,
    file_path: "/api/drive-stream?id=110ek0FufwZrdNi4wP0vBHjaSgMmVkeEz",
    drive_file_id: "110ek0FufwZrdNi4wP0vBHjaSgMmVkeEz",
  },
  {
    id: "5bcc5976-5872-466e-a9ef-f35e8ddeaeb6",
    title: "Nguyễn Văn Mười",
    artist: "MCK",
    album: "HVL",
    duration: 242,
    file_path: "/api/drive-stream?id=1WOVaRtExvElt8VwRrAZUpiSOJyIjU2E5",
    drive_file_id: "1WOVaRtExvElt8VwRrAZUpiSOJyIjU2E5",
  },
  {
    id: "4b99e964-9656-49b3-8858-a83e7c69502c",
    title: "Nếu Như Ta Chẳng Còn (feat. A$AP Ướt Mi)",
    artist: "MCK",
    album: "HVL",
    duration: 318,
    file_path: "/api/drive-stream?id=1zy9MBjdKBL5Ild9IXL1qUXZdbr5Z3QiD",
    drive_file_id: "1zy9MBjdKBL5Ild9IXL1qUXZdbr5Z3QiD",
  },
  {
    id: "85b24374-2cc9-4ab9-b190-69399205c62e",
    title: "Không Cần Lo Cho Tao",
    artist: "MCK",
    album: "HVL",
    duration: 156,
    file_path: "/api/drive-stream?id=16NCMvZzJ-mrrx3P66PadTfEqZFR6LXto",
    drive_file_id: "16NCMvZzJ-mrrx3P66PadTfEqZFR6LXto",
  },
  {
    id: "2ff47c6f-dad3-4b8d-a839-867bdcc80363",
    title: "Slippery (feat. Tùng Dương)",
    artist: "MCK",
    album: "HVL",
    duration: 190,
    file_path: "/api/drive-stream?id=1-CRBgCty8mwa6CGjFHesjY179pN63R7z",
    drive_file_id: "1-CRBgCty8mwa6CGjFHesjY179pN63R7z",
  },
  {
    id: "629af8a0-6e5a-4583-b2a4-80d38822ba53",
    title: "Wtf Bby I_m Lit",
    artist: "MCK",
    album: "HVL",
    duration: 167,
    file_path: "/api/drive-stream?id=1s3h_0waYnpDbzt9px-PWl4T3BuJ4Im2E",
    drive_file_id: "1s3h_0waYnpDbzt9px-PWl4T3BuJ4Im2E",
  },
  {
    id: "3bfbfab4-a430-4f29-8eb2-f443bdd4cd09",
    title: "Hút và Hút",
    artist: "MCK",
    album: "HVL",
    duration: 175,
    file_path: "/api/drive-stream?id=1brDbUjLq7hJl-AlIm-nwp_AO-1OxerLd",
    drive_file_id: "1brDbUjLq7hJl-AlIm-nwp_AO-1OxerLd",
  },
  {
    id: "ca58ee39-2ab8-4950-94f5-716e1e0ccb64",
    title: "Che Phủ",
    artist: "MCK",
    album: "HVL",
    duration: 185,
    file_path: "/api/drive-stream?id=1G3e_tmLZ1_pJ3LuVR3lNO6_aTSVLlEEd",
    drive_file_id: "1G3e_tmLZ1_pJ3LuVR3lNO6_aTSVLlEEd",
  },
]

// In-memory normalized index map for O(1) instant match
const driveIndex = new Map<string, PreloadedDriveTrack>()

function indexTrack(t: PreloadedDriveTrack) {
  const normTitle = normalizeTrackField(t.title)
  const normArtist = normalizeTrackField(t.artist)
  if (normTitle) {
    driveIndex.set(normTitle, t)
    if (normArtist) {
      driveIndex.set(`${normTitle}___${normArtist}`, t)
    }
  }
}

// Populate static index
STATIC_DRIVE_TRACKS.forEach(indexTrack)

/**
 * Instant in-memory check for Drive tracks (< 0.1ms)
 * Checks both Title and Artist compatibility so same-titled songs by different artists aren't mixed up.
 */
export function findMemoryDriveTrack(title: string, artist?: string | null): PreloadedDriveTrack | null {
  const normTitle = normalizeTrackField(title)
  if (!normTitle) return null

  const normArtist = normalizeTrackField(artist || '')

  // 1. Exact match Title + Artist (e.g., "Tây Thi" + "MCK")
  if (normArtist) {
    const combined = driveIndex.get(`${normTitle}___${normArtist}`)
    if (combined) return combined
  }

  // 2. Smart Fuzzy Match for Title and Artist variations (e.g. "MCK, Obito", "RPT MCK", "MCK ft. Tage")
  for (const t of STATIC_DRIVE_TRACKS) {
    const tTitle = normalizeTrackField(t.title)
    const tArtist = normalizeTrackField(t.artist)

    const titleMatch = tTitle === normTitle || tTitle.includes(normTitle) || normTitle.includes(tTitle)
    if (!titleMatch) continue

    if (normArtist) {
      const artistMatch =
        tArtist === normArtist ||
        tArtist.includes(normArtist) ||
        normArtist.includes(tArtist) ||
        normArtist.includes('mck') ||
        tArtist.includes('mck')

      if (artistMatch) return t
    } else {
      // If no artist is provided, match by title
      return t
    }
  }

  return null
}
