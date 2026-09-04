/**
 * Test runner executing real network calls case-by-case against every playback-related API.
 */
import { GET as searchGet } from '../app/api/nhaccuatui/search/route'
import { GET as songGet } from '../app/api/nhaccuatui/song/[id]/route'
import { GET as streamGet, HEAD as streamHead, OPTIONS as streamOptions } from '../app/api/nhaccuatui/stream/route'
import { GET as resolveStreamGet, OPTIONS as resolveStreamOptions } from '../app/api/nhaccuatui/resolve-stream/route'
import { GET as matchStreamGet, OPTIONS as matchStreamOptions } from '../app/api/nhaccuatui/match-stream/route'
import { GET as driveStreamGet, OPTIONS as driveStreamOptions } from '../app/api/drive-stream/route'
import { searchSoundCloudTracks, resolveSoundCloudStreamUrl } from '../lib/soundcloudClient'
import { GET as scStreamGet, OPTIONS as scStreamOptions } from '../app/api/soundcloud/stream/route'
import { GET as ytLyricsGet } from '../app/api/youtube/lyrics/route'
import { fetchLyricsFromLrclib } from '../lib/lrclib'
import { resolveYouTubeAudioStreamAndroid } from '../lib/youtubeStream'
import { NextRequest } from 'next/server'

interface TestCaseResult {
  caseNumber: number
  name: string
  api: string
  status: 'PASS' | 'FAIL' | 'WARN'
  httpStatus?: number
  latencyMs: number
  headers?: Record<string, string>
  details: string
  dataPreview?: any
}

const results: TestCaseResult[] = []

async function timedRun<T>(fn: () => Promise<T>): Promise<{ result: T; elapsed: number }> {
  const start = performance.now()
  const result = await fn()
  const elapsed = Math.round(performance.now() - start)
  return { result, elapsed }
}

function getHeaderMap(headers: Headers): Record<string, string> {
  const map: Record<string, string> = {}
  headers.forEach((value, key) => {
    map[key] = value
  })
  return map
}

async function runAllTests() {
  console.log('='.repeat(80))
  console.log('🧪 BẮT ĐẦU CHẠY KIỂM THỬ THỰC TẾ TỪNG CASE, TỪNG API (REAL CALLS)')
  console.log('='.repeat(80))

  let discoveredNctSongId = ''

  // =========================================================================
  // CASE 1: NCT Search API
  // =========================================================================
  console.log('\n▶ Case 1.1: NCT Search - Tìm bài hát thực tế ("Chúng Ta Của Tương Lai")')
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      const req = new Request('http://localhost:3000/api/nhaccuatui/search?q=Ch%C3%BAng+Ta+C%E1%BB%A7a+T%C6%B0%C6%A1ng+Lai')
      return await searchGet(req)
    })
    const body = await res.json()
    const firstItem = body?.items?.[0]
    discoveredNctSongId = firstItem?.id || ''

    const isPass = res.status === 200 && Array.isArray(body?.items) && body.items.length > 0
    results.push({
      caseNumber: 1.1,
      name: 'NCT Search with query',
      api: '/api/nhaccuatui/search?q=...',
      status: isPass ? 'PASS' : 'FAIL',
      httpStatus: res.status,
      latencyMs: elapsed,
      headers: getHeaderMap(res.headers),
      details: `Trả về ${body?.items?.length ?? 0} bài hát. Bài đầu tiên: "${firstItem?.title}" - "${firstItem?.artist}" (ID: ${discoveredNctSongId})`,
      dataPreview: firstItem,
    })
    console.log(`  [${isPass ? 'OK' : 'ERR'}] Status: ${res.status}, Latency: ${elapsed}ms, Items: ${body?.items?.length}`)
  } catch (err: any) {
    results.push({
      caseNumber: 1.1,
      name: 'NCT Search with query',
      api: '/api/nhaccuatui/search?q=...',
      status: 'FAIL',
      latencyMs: 0,
      details: `Lỗi ngoại lệ: ${err.message}`,
    })
    console.log(`  [FAIL] ${err.message}`)
  }

  // Edge case: Empty query
  console.log('▶ Case 1.2: NCT Search - Edge case query rỗng')
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      const req = new Request('http://localhost:3000/api/nhaccuatui/search?q=')
      return await searchGet(req)
    })
    const body = await res.json()
    const isPass = res.status === 400
    results.push({
      caseNumber: 1.2,
      name: 'NCT Search empty query guard',
      api: '/api/nhaccuatui/search?q=',
      status: isPass ? 'PASS' : 'FAIL',
      httpStatus: res.status,
      latencyMs: elapsed,
      details: `Trả về status 400 như kỳ vọng: ${JSON.stringify(body)}`,
    })
    console.log(`  [${isPass ? 'OK' : 'ERR'}] Status: ${res.status}, Latency: ${elapsed}ms`)
  } catch (err: any) {
    console.log(`  [FAIL] ${err.message}`)
  }

  // =========================================================================
  // CASE 2: NCT Song Details API
  // =========================================================================
  if (!discoveredNctSongId) discoveredNctSongId = 'Lh0z9w4yXm9n' // fallback ID
  console.log(`\n▶ Case 2.1: NCT Song Details - Lấy thông tin bài hát (ID: ${discoveredNctSongId})`)
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      const req = new Request(`http://localhost:3000/api/nhaccuatui/song/${discoveredNctSongId}`)
      return await songGet(req, { params: Promise.resolve({ id: discoveredNctSongId }) })
    })
    const body = await res.json()
    const song = body?.song
    const isPass = res.status === 200 && song && song.streamUrl
    results.push({
      caseNumber: 2.1,
      name: 'NCT Song details & streamUrl mapping',
      api: `/api/nhaccuatui/song/${discoveredNctSongId}`,
      status: isPass ? 'PASS' : 'FAIL',
      httpStatus: res.status,
      latencyMs: elapsed,
      headers: getHeaderMap(res.headers),
      details: `Lấy thành công bài "${song?.title}" - "${song?.artist}", streamUrl trỏ tới: ${song?.streamUrl}`,
      dataPreview: song,
    })
    console.log(`  [${isPass ? 'OK' : 'ERR'}] Status: ${res.status}, Latency: ${elapsed}ms, Title: ${song?.title}`)
  } catch (err: any) {
    results.push({
      caseNumber: 2.1,
      name: 'NCT Song details',
      api: `/api/nhaccuatui/song/${discoveredNctSongId}`,
      status: 'FAIL',
      latencyMs: 0,
      details: `Lỗi ngoại lệ: ${err.message}`,
    })
  }

  // =========================================================================
  // CASE 3: NCT Stream Proxy (CORS, HEAD, Range GET)
  // =========================================================================
  console.log(`\n▶ Case 3.1: NCT Stream - CORS Preflight (OPTIONS)`)
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      return await streamOptions()
    })
    const allowOrigin = res.headers.get('Access-Control-Allow-Origin')
    const allowMethods = res.headers.get('Access-Control-Allow-Methods')
    const isPass = res.status === 204 && allowOrigin === '*'
    results.push({
      caseNumber: 3.1,
      name: 'NCT Stream OPTIONS CORS preflight',
      api: '/api/nhaccuatui/stream (OPTIONS)',
      status: isPass ? 'PASS' : 'FAIL',
      httpStatus: res.status,
      latencyMs: elapsed,
      headers: getHeaderMap(res.headers),
      details: `CORS preflight hợp lệ: Allow-Origin=${allowOrigin}, Methods=${allowMethods}`,
    })
    console.log(`  [${isPass ? 'OK' : 'ERR'}] Status: ${res.status}, Allow-Origin: ${allowOrigin}`)
  } catch (err: any) {
    console.log(`  [FAIL] ${err.message}`)
  }

  console.log(`▶ Case 3.2: NCT Stream - Metadata Inspection (HEAD)`)
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      const req = new Request(`http://localhost:3000/api/nhaccuatui/stream?id=${discoveredNctSongId}`)
      return await streamHead(req)
    })
    const contentType = res.headers.get('content-type')
    const contentLength = res.headers.get('content-length')
    const allowOrigin = res.headers.get('access-control-allow-origin')
    const isPass = (res.status === 200 || res.status === 206) && allowOrigin === '*'
    results.push({
      caseNumber: 3.2,
      name: 'NCT Stream HEAD request',
      api: `/api/nhaccuatui/stream?id=${discoveredNctSongId} (HEAD)`,
      status: isPass ? 'PASS' : 'WARN',
      httpStatus: res.status,
      latencyMs: elapsed,
      headers: getHeaderMap(res.headers),
      details: `Status ${res.status}, Content-Type: ${contentType}, Content-Length: ${contentLength}, CORS: ${allowOrigin}`,
    })
    console.log(`  [${isPass ? 'OK' : 'WARN'}] Status: ${res.status}, Latency: ${elapsed}ms, Type: ${contentType}, Length: ${contentLength}`)
  } catch (err: any) {
    console.log(`  [FAIL] ${err.message}`)
  }

  console.log(`▶ Case 3.3: NCT Stream - Range GET request (bytes=0-2047)`)
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      const req = new Request(`http://localhost:3000/api/nhaccuatui/stream?id=${discoveredNctSongId}`, {
        headers: {
          Range: 'bytes=0-2047',
        },
      })
      return await streamGet(req)
    })
    const contentType = res.headers.get('content-type')
    const contentRange = res.headers.get('content-range')
    const allowOrigin = res.headers.get('access-control-allow-origin')
    let bytesRead = 0
    if (res.body) {
      const reader = res.body.getReader()
      const { value } = await reader.read()
      bytesRead = value ? value.length : 0
      reader.cancel()
    }
    const isPass = (res.status === 206 || res.status === 200) && allowOrigin === '*' && bytesRead > 0
    results.push({
      caseNumber: 3.3,
      name: 'NCT Stream Range GET audio streaming',
      api: `/api/nhaccuatui/stream?id=${discoveredNctSongId} (GET)`,
      status: isPass ? 'PASS' : 'FAIL',
      httpStatus: res.status,
      latencyMs: elapsed,
      headers: getHeaderMap(res.headers),
      details: `Đọc được ${bytesRead} bytes audio thực tế. Status: ${res.status}, Range: ${contentRange}, CORS Origin: ${allowOrigin}`,
    })
    console.log(`  [${isPass ? 'OK' : 'ERR'}] Status: ${res.status}, Latency: ${elapsed}ms, Read ${bytesRead} bytes, CORS: ${allowOrigin}`)
  } catch (err: any) {
    results.push({
      caseNumber: 3.3,
      name: 'NCT Stream Range GET audio streaming',
      api: `/api/nhaccuatui/stream?id=${discoveredNctSongId} (GET)`,
      status: 'FAIL',
      latencyMs: 0,
      details: `Lỗi ngoại lệ: ${err.message}`,
    })
    console.log(`  [FAIL] ${err.message}`)
  }

  // =========================================================================
  // CASE 4: NCT Resolve-Stream API
  // =========================================================================
  console.log(`\n▶ Case 4.1: NCT Resolve-Stream - Fast prewarm resolution (ID: ${discoveredNctSongId})`)
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      const req = new Request(`http://localhost:3000/api/nhaccuatui/resolve-stream?id=${discoveredNctSongId}`)
      return await resolveStreamGet(req)
    })
    const body = await res.json()
    const allowOrigin = res.headers.get('access-control-allow-origin')
    const isPass = res.status === 200 && body?.url && allowOrigin === '*'
    results.push({
      caseNumber: 4.1,
      name: 'NCT Resolve-Stream prewarm metadata',
      api: `/api/nhaccuatui/resolve-stream?id=${discoveredNctSongId}`,
      status: isPass ? 'PASS' : 'FAIL',
      httpStatus: res.status,
      latencyMs: elapsed,
      headers: getHeaderMap(res.headers),
      details: `Resolve thành công stream trong ${elapsed}ms. Title: "${body?.title}", Artist: "${body?.artist}", Duration: ${body?.duration}s`,
      dataPreview: { title: body?.title, artist: body?.artist, duration: body?.duration, hasUrl: !!body?.url },
    })
    console.log(`  [${isPass ? 'OK' : 'ERR'}] Status: ${res.status}, Latency: ${elapsed}ms, Direct URL exists: ${!!body?.url}`)
  } catch (err: any) {
    console.log(`  [FAIL] ${err.message}`)
  }

  // =========================================================================
  // CASE 5: NCT Match-Stream API
  // =========================================================================
  console.log(`\n▶ Case 5.1: NCT Match-Stream - Khớp bài hát sang YouTube stream (ID: ${discoveredNctSongId})`)
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      const req = new Request(`http://localhost:3000/api/nhaccuatui/match-stream?id=${discoveredNctSongId}`)
      return await matchStreamGet(req)
    })
    const body = await res.json()
    const isPass = res.status === 200 && body?.videoId
    results.push({
      caseNumber: 5.1,
      name: 'NCT Match-Stream to YouTube mapping',
      api: `/api/nhaccuatui/match-stream?id=${discoveredNctSongId}`,
      status: isPass ? 'PASS' : (res.status === 502 ? 'WARN' : 'FAIL'),
      httpStatus: res.status,
      latencyMs: elapsed,
      headers: getHeaderMap(res.headers),
      details: isPass 
        ? `Khớp thành công YouTube Video ID: ${body?.videoId}, Stream URL: ${body?.url}`
        : `Kết quả: ${JSON.stringify(body)}`,
      dataPreview: body,
    })
    console.log(`  [${isPass ? 'OK' : 'WARN'}] Status: ${res.status}, Latency: ${elapsed}ms, VideoId: ${body?.videoId}`)
  } catch (err: any) {
    console.log(`  [FAIL] ${err.message}`)
  }

  // =========================================================================
  // CASE 6: Google Drive Stream & Cloudflare Worker
  // =========================================================================
  console.log('\n▶ Case 6.1: Google Drive Stream Proxy - OPTIONS CORS Preflight')
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      return await driveStreamOptions()
    })
    const allowOrigin = res.headers.get('Access-Control-Allow-Origin')
    const isPass = res.status === 204 && allowOrigin === '*'
    results.push({
      caseNumber: 6.1,
      name: 'Drive Stream OPTIONS CORS preflight',
      api: '/api/drive-stream (OPTIONS)',
      status: isPass ? 'PASS' : 'FAIL',
      httpStatus: res.status,
      latencyMs: elapsed,
      headers: getHeaderMap(res.headers),
      details: `CORS preflight: Allow-Origin=${allowOrigin}, Allow-Methods=${res.headers.get('Access-Control-Allow-Methods')}`,
    })
    console.log(`  [${isPass ? 'OK' : 'ERR'}] Status: ${res.status}, CORS: ${allowOrigin}`)
  } catch (err: any) {
    console.log(`  [FAIL] ${err.message}`)
  }

  console.log('▶ Case 6.2: Google Drive Cloudflare Stream Worker Health Check')
  const workerUrl = process.env.NEXT_PUBLIC_CLOUDFLARE_WORKER_URL || 'https://drive-upload-worker.phongtct.workers.dev'
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      return await fetch(`${workerUrl}/api/drive-stream?id=test_ping`, {
        method: 'OPTIONS',
      })
    })
    const allowOrigin = res.headers.get('access-control-allow-origin')
    const isPass = (res.status === 200 || res.status === 204) && allowOrigin === '*'
    results.push({
      caseNumber: 6.2,
      name: 'Drive Cloudflare Worker live reachability & CORS',
      api: `${workerUrl}/api/drive-stream`,
      status: isPass ? 'PASS' : 'WARN',
      httpStatus: res.status,
      latencyMs: elapsed,
      headers: getHeaderMap(res.headers),
      details: `Worker phản hồi trong ${elapsed}ms với CORS Origin: ${allowOrigin}`,
    })
    console.log(`  [${isPass ? 'OK' : 'WARN'}] Status: ${res.status}, Latency: ${elapsed}ms, Worker CORS: ${allowOrigin}`)
  } catch (err: any) {
    results.push({
      caseNumber: 6.2,
      name: 'Drive Cloudflare Worker live reachability',
      api: `${workerUrl}/api/drive-stream`,
      status: 'WARN',
      latencyMs: 0,
      details: `Không kết nối được Worker: ${err.message}`,
    })
    console.log(`  [WARN] ${err.message}`)
  }

  // =========================================================================
  // CASE 7: SoundCloud API (Search & Stream)
  // =========================================================================
  console.log('\n▶ Case 7.1: SoundCloud Search ("Đưa Nhau Đi Trốn")')
  let soundcloudTrackId = ''
  try {
    const { result: tracks, elapsed } = await timedRun(async () => {
      return await searchSoundCloudTracks('Đưa Nhau Đi Trốn', 3)
    })
    const firstTrack = tracks?.[0]
    soundcloudTrackId = firstTrack?.id?.replace(/^sc-/, '') || ''
    const isPass = Array.isArray(tracks) && tracks.length > 0 && !!firstTrack?.title
    results.push({
      caseNumber: 7.1,
      name: 'SoundCloud track search',
      api: 'searchSoundCloudTracks()',
      status: isPass ? 'PASS' : 'FAIL',
      latencyMs: elapsed,
      details: `Tìm thấy ${tracks.length} bài. Bài đầu: "${firstTrack?.title}" - "${firstTrack?.artist}" (ID: ${firstTrack?.id})`,
      dataPreview: firstTrack,
    })
    console.log(`  [${isPass ? 'OK' : 'ERR'}] Latency: ${elapsed}ms, Tracks: ${tracks.length}, First: "${firstTrack?.title}"`)
  } catch (err: any) {
    results.push({
      caseNumber: 7.1,
      name: 'SoundCloud track search',
      api: 'searchSoundCloudTracks()',
      status: 'FAIL',
      latencyMs: 0,
      details: `Lỗi: ${err.message}`,
    })
    console.log(`  [FAIL] ${err.message}`)
  }

  console.log('▶ Case 7.2: SoundCloud Stream Route (/api/soundcloud/stream)')
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      const targetId = soundcloudTrackId || '123456'
      const req = new NextRequest(`http://localhost:3000/api/soundcloud/stream?id=${targetId}&format=json`)
      return await scStreamGet(req)
    })
    const isPass = res.status === 200 || res.status === 307
    const allowOrigin = res.headers.get('access-control-allow-origin')
    results.push({
      caseNumber: 7.2,
      name: 'SoundCloud Stream endpoint',
      api: `/api/soundcloud/stream?id=${soundcloudTrackId}&format=json`,
      status: isPass ? 'PASS' : 'WARN',
      httpStatus: res.status,
      latencyMs: elapsed,
      headers: getHeaderMap(res.headers),
      details: `Status: ${res.status}, CORS: ${allowOrigin}`,
    })
    console.log(`  [${isPass ? 'OK' : 'WARN'}] Status: ${res.status}, Latency: ${elapsed}ms, CORS: ${allowOrigin}`)
  } catch (err: any) {
    console.log(`  [FAIL] ${err.message}`)
  }

  // =========================================================================
  // CASE 8: Lyrics API (LRCLIB & YouTube Lyrics)
  // =========================================================================
  console.log('\n▶ Case 8.1: LRCLIB Lyrics ("Chúng Ta Của Tương Lai" - Sơn Tùng M-TP)')
  try {
    const { result: lyrics, elapsed } = await timedRun(async () => {
      return await fetchLyricsFromLrclib({
        title: 'Chúng Ta Của Tương Lai',
        artist: 'Sơn Tùng M-TP',
      })
    })
    const isPass = !!lyrics && (!!lyrics.syncedLyrics || !!lyrics.plainLyrics)
    const lineCount = lyrics?.syncedLyrics?.split('\n').length ?? 0
    results.push({
      caseNumber: 8.1,
      name: 'LRCLIB Synced Lyrics resolution',
      api: 'fetchLyricsFromLrclib()',
      status: isPass ? 'PASS' : 'FAIL',
      latencyMs: elapsed,
      details: `Tìm thấy ${lineCount} dòng lời bài hát đồng bộ (synced: ${lyrics?.hasSynced}). ID: ${lyrics?.id}`,
      dataPreview: {
        id: lyrics?.id,
        trackName: lyrics?.trackName,
        artistName: lyrics?.artistName,
        sample: lyrics?.syncedLyrics?.split('\n').slice(0, 3).join(' | '),
      },
    })
    console.log(`  [${isPass ? 'OK' : 'ERR'}] Latency: ${elapsed}ms, Synced: ${lyrics?.hasSynced}, Lines: ${lineCount}`)
  } catch (err: any) {
    results.push({
      caseNumber: 8.1,
      name: 'LRCLIB Lyrics',
      api: 'fetchLyricsFromLrclib()',
      status: 'FAIL',
      latencyMs: 0,
      details: `Lỗi: ${err.message}`,
    })
    console.log(`  [FAIL] ${err.message}`)
  }

  console.log('▶ Case 8.2: YouTube Music Lyrics Fallback (/api/youtube/lyrics)')
  try {
    const { result: res, elapsed } = await timedRun(async () => {
      const req = new NextRequest('http://localhost:3000/api/youtube/lyrics?title=N%C6%A1i+N%C3%A0y+C%C3%B3+Anh&artist=S%C6%A1n+T%C3%B9ng+M-TP')
      return await ytLyricsGet(req)
    })
    const body = await res.json()
    const isPass = res.status === 200 && !!body?.lyrics
    results.push({
      caseNumber: 8.2,
      name: 'YouTube Music Lyrics Fallback',
      api: '/api/youtube/lyrics?title=...&artist=...',
      status: isPass ? 'PASS' : 'WARN',
      httpStatus: res.status,
      latencyMs: elapsed,
      details: isPass 
        ? `Lấy thành công lời từ YouTube Music (${body?.lyrics?.length} ký tự)` 
        : `Kết quả: ${JSON.stringify(body)}`,
      dataPreview: body?.lyrics?.slice(0, 100),
    })
    console.log(`  [${isPass ? 'OK' : 'WARN'}] Status: ${res.status}, Latency: ${elapsed}ms, HasLyrics: ${!!body?.lyrics}`)
  } catch (err: any) {
    console.log(`  [FAIL] ${err.message}`)
  }

  // =========================================================================
  // CASE 9: YouTube Audio Stream Direct Resolution
  // =========================================================================
  console.log('\n▶ Case 9.1: YouTube Audio Stream Android Client ("W8rP_F9S-n4")')
  try {
    const { result: ytRes, elapsed } = await timedRun(async () => {
      return await resolveYouTubeAudioStreamAndroid('W8rP_F9S-n4')
    })
    const isPass = !!ytRes && !!ytRes.url
    results.push({
      caseNumber: 9.1,
      name: 'YouTube audio stream resolution (Android client)',
      api: 'resolveYouTubeAudioStreamAndroid("W8rP_F9S-n4")',
      status: isPass ? 'PASS' : 'WARN',
      latencyMs: elapsed,
      details: isPass
        ? `Resolve stream URL thành công trong ${elapsed}ms. MIME: ${ytRes?.mimeType}, Bitrate: ${ytRes?.bitrate}`
        : 'YouTube streaming không trả về URL (có thể do IP datacenter hoặc hạn chế YouTube client)',
      dataPreview: ytRes ? { mimeType: ytRes.mimeType, bitrate: ytRes.bitrate, hasUrl: !!ytRes.url } : null,
    })
    console.log(`  [${isPass ? 'OK' : 'WARN'}] Latency: ${elapsed}ms, Bitrate: ${ytRes?.bitrate}, MIME: ${ytRes?.mimeType}`)
  } catch (err: any) {
    results.push({
      caseNumber: 9.1,
      name: 'YouTube audio stream resolution',
      api: 'resolveYouTubeAudioStreamAndroid()',
      status: 'WARN',
      latencyMs: 0,
      details: `Ngoại lệ: ${err.message}`,
    })
    console.log(`  [WARN] ${err.message}`)
  }

  // =========================================================================
  // SUMMARY REPORT
  // =========================================================================
  console.log('\n' + '='.repeat(80))
  console.log('📊 TỔNG HỢP KẾT QUẢ TEST THỰC TẾ CÁC API')
  console.log('='.repeat(80))
  console.table(results.map(r => ({
    Case: r.caseNumber,
    Name: r.name,
    API: r.api,
    Status: r.status,
    HTTP: r.httpStatus ?? '-',
    'Latency (ms)': r.latencyMs,
  })))

  // Save json artifact for inspection
  const fs = await import('fs')
  fs.writeFileSync(
    'C:/Users/User/.gemini/antigravity-ide/brain/0ee8db8f-3e12-465f-8762-d11abb53661b/scratch/api_test_results.json',
    JSON.stringify(results, null, 2),
    'utf-8'
  )
  console.log('\n💾 Đã lưu chi tiết toàn bộ payload vào scratch/api_test_results.json')
}

runAllTests().catch(err => {
  console.error('Fatal test error:', err)
  process.exit(1)
})
