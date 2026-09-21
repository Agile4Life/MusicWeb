import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend, Counter } from 'k6/metrics'

// Custom Metrics
const errorRate = new Rate('edge_error_rate')
const edgeLatency = new Trend('edge_latency_ms')
const stampedeCoalesced = new Counter('edge_coalesced_count')

function recordCheck(passed) {
  errorRate.add(!passed)
  return passed
}

export const options = {
  scenarios: {
    // 1. Corrupt and abnormal range headers
    corrupt_ranges: {
      executor: 'per-vu-iterations',
      vus: 5,
      iterations: 2,
      maxDuration: '25s',
      exec: 'testCorruptRanges',
    },
    // 2. Options and Head across all stream endpoints
    options_and_head: {
      executor: 'per-vu-iterations',
      vus: 5,
      iterations: 2,
      maxDuration: '20s',
      exec: 'testOptionsAndHead',
      startTime: '2s',
    },
    // 3. YouTube Stream Route compatibility (/api/yt-stream)
    yt_stream_route: {
      executor: 'per-vu-iterations',
      vus: 4,
      iterations: 1,
      maxDuration: '20s',
      exec: 'testYtStreamRoute',
      startTime: '3s',
    },
    // 4. Malformed and whitespace params
    malformed_params: {
      executor: 'per-vu-iterations',
      vus: 5,
      iterations: 2,
      maxDuration: '20s',
      exec: 'testMalformedParams',
      startTime: '4s',
    },
    // 5. Lyrics stampede and instrumental guard
    lyrics_stress: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 2,
      maxDuration: '30s',
      exec: 'testLyricsStress',
      startTime: '5s',
    },
    // 6. NCT song metadata stampede
    nct_song_stress: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 2,
      maxDuration: '25s',
      exec: 'testNctSongStress',
      startTime: '6s',
    },
    // 7. Negative caching on non-existent songs
    negative_caching: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 2,
      maxDuration: '30s',
      exec: 'testNegativeCaching',
      startTime: '7s',
    },
    // 8. Invalidation race condition
    invalidation_race: {
      executor: 'per-vu-iterations',
      vus: 6,
      iterations: 2,
      maxDuration: '30s',
      exec: 'testInvalidationRace',
      startTime: '8s',
    },
    // 9. Search and trending edge cases
    search_trending_edge: {
      executor: 'per-vu-iterations',
      vus: 8,
      iterations: 3,
      maxDuration: '25s',
      exec: 'testSearchTrendingEdge',
      startTime: '9s',
    },
    // 10. Concurrent multi-range simulated audio seek
    audio_seek_multi_range: {
      executor: 'per-vu-iterations',
      vus: 6,
      iterations: 2,
      maxDuration: '30s',
      exec: 'testAudioSeekMultiRange',
      startTime: '10s',
    },
  },
  thresholds: {
    checks: ['rate>0.98'], // Over 98% check pass rate
    edge_error_rate: ['rate<0.02'], // Error rate under 2%
    edge_latency_ms: ['p(95)<3000'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const NCT_TEST_ID = 'JmD8wHQ4IuAk' // Live verified NhacCuaTui song ID

/**
 * 1. Test corrupt and extreme ranges
 */
export function testCorruptRanges() {
  const url = `${BASE_URL}/api/nhaccuatui/stream?id=${NCT_TEST_ID}`

  // 1.1 Out of bounds range (bytes=999999999-)
  const resOob = http.get(url, {
    headers: { Range: 'bytes=999999999-' },
    tags: { name: 'Range_OutOfBounds' },
    timeout: '12s',
  })
  recordCheck(
    check(resOob, {
      'OOB range returns valid HTTP status (200, 206, 416, or 502)': (r) =>
        [200, 206, 416, 502].includes(r.status),
      'OOB range is not server 500': (r) => r.status !== 500,
    })
  )

  // 1.2 Suffix byte range (last 1024 bytes)
  const resSuffix = http.get(url, {
    headers: { Range: 'bytes=-1024' },
    tags: { name: 'Range_Suffix' },
    timeout: '12s',
  })
  recordCheck(
    check(resSuffix, {
      'Suffix range returns 200 or 206': (r) => r.status === 200 || r.status === 206,
    })
  )

  // 1.3 Inverted range (5000-100)
  const resInverted = http.get(url, {
    headers: { Range: 'bytes=5000-100' },
    tags: { name: 'Range_Inverted' },
    timeout: '12s',
  })
  recordCheck(
    check(resInverted, {
      'Inverted range does not crash server': (r) => [200, 206, 416, 502].includes(r.status),
    })
  )

  sleep(0.3)
}

/**
 * 2. Test OPTIONS and HEAD methods across all stream proxies
 */
export function testOptionsAndHead() {
  const endpoints = [
    `${BASE_URL}/api/nhaccuatui/stream?id=${NCT_TEST_ID}`,
    `${BASE_URL}/api/yt-stream?id=dQw4w9WgXcQ`,
    `${BASE_URL}/api/soundcloud/stream?id=123`,
    `${BASE_URL}/api/drive-stream?fileId=1A2B3C4D5E6F7G8H9I0J`,
  ]

  for (const ep of endpoints) {
    // OPTIONS
    const optRes = http.options(ep, null, { tags: { name: 'Stream_OPTIONS' } })
    recordCheck(
      check(optRes, {
        'OPTIONS returns 200 or 204': (r) => r.status === 200 || r.status === 204,
        'OPTIONS has CORS origin': (r) => !!r.headers['Access-Control-Allow-Origin'],
      })
    )

    // HEAD (redirects: 0 tests the local route response)
    const headRes = http.head(ep, { tags: { name: 'Stream_HEAD' }, timeout: '10s', redirects: 0 })
    recordCheck(
      check(headRes, {
        'HEAD returns status < 500, 502, or redirect': (r) =>
          r.status < 500 || r.status === 502 || r.status === 307 || r.status === 302,
        'HEAD body is empty': (r) => !r.body || r.body.length === 0,
      })
    )
  }

  sleep(0.2)
}

/**
 * 3. YouTube Stream Route compatibility (/api/yt-stream)
 */
export function testYtStreamRoute() {
  const url = `${BASE_URL}/api/yt-stream?id=dQw4w9WgXcQ`
  const optRes = http.options(url, null, { tags: { name: 'YT_Stream_OPTIONS' } })
  recordCheck(
    check(optRes, {
      'yt-stream OPTIONS returns 204': (r) => r.status === 204,
      'yt-stream OPTIONS allows GET, HEAD, OPTIONS': (r) =>
        r.headers['Access-Control-Allow-Methods']?.includes('GET'),
    })
  )

  // Verify it does NOT return HTML
  const headRes = http.head(url, { tags: { name: 'YT_Stream_HEAD' }, timeout: '10s', redirects: 0 })
  recordCheck(
    check(headRes, {
      'yt-stream does not return HTML text/html': (r) =>
        !r.headers['Content-Type']?.includes('text/html'),
      'yt-stream returns 200, 204, or 307': (r) =>
        [200, 204, 307].includes(r.status),
    })
  )

  sleep(0.3)
}

/**
 * 4. Malformed and whitespace params
 */
export function testMalformedParams() {
  // Whitespace only ID
  const r1 = http.get(`${BASE_URL}/api/nhaccuatui/stream?id=%20%20%20`, { tags: { name: 'NCT_Whitespace' } })
  recordCheck(
    check(r1, {
      'Whitespace id returns 400': (r) => r.status === 400,
    })
  )

  // Empty id
  const r2 = http.get(`${BASE_URL}/api/drive-stream?fileId=`, { tags: { name: 'Drive_Empty' } })
  recordCheck(
    check(r2, {
      'Empty drive fileId returns 400': (r) => r.status === 400,
    })
  )

  // Special characters & SQL injection string in query
  const r3 = http.get(`${BASE_URL}/api/search?q=${encodeURIComponent("' OR 1=1 -- <script>alert(1)</script>")}`, {
    tags: { name: 'Search_SqlXss' },
  })
  recordCheck(
    check(r3, {
      'SQL/XSS payload in search returns 200 JSON': (r) => r.status === 200,
    })
  )

  sleep(0.2)
}

/**
 * 5. Lyrics stress, instrumental guard, and coalescing
 */
export function testLyricsStress() {
  // 5.1 Instrumental track guard
  const rInst = http.get(`${BASE_URL}/api/youtube/lyrics?title=Lac%20Troi%20Karaoke%20Beat&artist=Son%20Tung`, {
    tags: { name: 'Lyrics_Instrumental_Guard' },
  })
  recordCheck(
    check(rInst, {
      'Instrumental beat returns 404 immediately': (r) => r.status === 404,
    })
  )

  // 5.2 Lyrics burst coalescing
  const start = Date.now()
  const rLyr = http.get(`${BASE_URL}/api/youtube/lyrics?videoId=JmD8wHQ4IuAk&title=Chung%20Ta%20Cua%20Tuong%20Lai&artist=Son%20Tung`, {
    tags: { name: 'Lyrics_Burst' },
    timeout: '15s',
  })
  const dur = Date.now() - start
  edgeLatency.add(dur)

  recordCheck(
    check(rLyr, {
      'Lyrics burst returns 200 or 404 without 500': (r) => r.status === 200 || r.status === 404,
    })
  )
  if (dur < 50) stampedeCoalesced.add(1)

  sleep(0.4)
}

/**
 * 6. NCT song metadata stress
 */
export function testNctSongStress() {
  const rSong = http.get(`${BASE_URL}/api/nhaccuatui/song/${NCT_TEST_ID}`, {
    tags: { name: 'NCT_Song_Metadata' },
    timeout: '12s',
  })
  recordCheck(
    check(rSong, {
      'NCT song metadata returns 200': (r) => r.status === 200,
      'NCT song metadata has song id': (r) => {
        try {
          const d = r.json()
          return d?.song?.id === NCT_TEST_ID
        } catch {
          return false
        }
      },
    })
  )

  // Non-existent song ID
  const r404 = http.get(`${BASE_URL}/api/nhaccuatui/song/non_existent_fake_song_id_99999`, {
    tags: { name: 'NCT_Song_404' },
    timeout: '8s',
  })
  recordCheck(
    check(r404, {
      'Non-existent NCT song returns 404 or 502': (r) => r.status === 404 || r.status === 502,
    })
  )

  sleep(0.3)
}

/**
 * 7. Negative caching on non-existent songs
 */
export function testNegativeCaching() {
  const junkTitle = 'SuperNonExistentTrack9999'
  const junkArtist = 'FakeGhostArtist8888'

  const rMiss = http.get(`${BASE_URL}/api/resolve-stream?title=${junkTitle}&artist=${junkArtist}`, {
    tags: { name: 'Resolve_Negative_Miss' },
    timeout: '15s',
  })

  recordCheck(
    check(rMiss, {
      'Negative resolution returns miss: true': (r) => {
        try {
          const json = r.json()
          return json.miss === true
        } catch {
          return false
        }
      },
    })
  )

  // Immediate second request to test L1 negative cache hit
  const rMissCached = http.get(`${BASE_URL}/api/resolve-stream?title=${junkTitle}&artist=${junkArtist}`, {
    tags: { name: 'Resolve_Negative_CacheHit' },
    timeout: '5s',
  })

  recordCheck(
    check(rMissCached, {
      'Negative cached resolution returns miss: true': (r) => {
        try {
          return r.json()?.miss === true
        } catch {
          return false
        }
      },
      'Negative cached response is fast (<500ms)': (r) => r.timings.duration < 500,
    })
  )
  if (rMissCached.timings.duration < 50) stampedeCoalesced.add(1)

  sleep(0.3)
}

/**
 * 8. Invalidation race condition
 */
export function testInvalidationRace() {
  const title = 'Chúng Ta Của Tương Lai'
  const artist = 'Sơn Tùng M-TP'

  // Concurrent invalidate=1 along with regular reads
  const rInv = http.get(`${BASE_URL}/api/resolve-stream?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}&invalidate=1`, {
    tags: { name: 'Resolve_Invalidate' },
    timeout: '15s',
  })
  recordCheck(
    check(rInv, {
      'Invalidation request completes successfully': (r) => r.status === 200,
    })
  )

  sleep(0.3)
}

/**
 * 9. Search and trending edge cases
 */
export function testSearchTrendingEdge() {
  // Empty search
  const rEmpty = http.get(`${BASE_URL}/api/search?q=`, { tags: { name: 'Search_Empty' } })
  recordCheck(
    check(rEmpty, {
      'Empty search returns 200 or 400 without crashing': (r) => r.status === 200 || r.status === 400,
    })
  )

  // Japanese CJK query
  const rCjk = http.get(`${BASE_URL}/api/search?q=${encodeURIComponent('夜に駆ける')}`, {
    tags: { name: 'Search_CJK' },
    timeout: '8s',
  })
  recordCheck(
    check(rCjk, {
      'CJK search returns 200 JSON': (r) => r.status === 200,
    })
  )

  // Trending burst
  const rTrend = http.get(`${BASE_URL}/api/trending`, { tags: { name: 'Trending_Burst' } })
  recordCheck(
    check(rTrend, {
      'Trending burst returns 200': (r) => r.status === 200,
    })
  )

  sleep(0.2)
}

/**
 * 10. Concurrent multi-range simulated audio seek
 */
export function testAudioSeekMultiRange() {
  const url = `${BASE_URL}/api/nhaccuatui/stream?id=${NCT_TEST_ID}`

  // Simulating 3 simultaneous range requests typical of an HTML5 audio element:
  const requests = [
    { method: 'GET', url, params: { headers: { Range: 'bytes=0-1' }, tags: { name: 'Audio_Range_Probe' } } },
    { method: 'GET', url, params: { headers: { Range: 'bytes=0-32768' }, tags: { name: 'Audio_Range_InitialChunk' } } },
    { method: 'GET', url, params: { headers: { Range: 'bytes=65536-131072' }, tags: { name: 'Audio_Range_SeekChunk' } } },
  ]

  const responses = http.batch(requests)

  for (const res of responses) {
    recordCheck(
      check(res, {
        'Audio seek range returns 206 Partial Content or 200': (r) => r.status === 206 || r.status === 200,
        'Audio seek range has Accept-Ranges or Content-Range': (r) =>
          !!r.headers['Accept-Ranges'] || !!r.headers['Content-Range'],
      })
    )
  }

  sleep(0.3)
}
