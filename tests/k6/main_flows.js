import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom Metrics
export const errorRate = new Rate('errors');
export const searchLatency = new Trend('search_latency');
export const resolveLatency = new Trend('resolve_stream_latency');
export const streamingLatency = new Trend('streaming_latency');
export const lyricsLatency = new Trend('lyrics_latency');
export const stampedeCoalesced = new Counter('stampede_coalesced_requests');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    // 1. Search & Discovery Flow: Tests parallel catalog search & trending deduplication
    search_flow: {
      executor: 'constant-vus',
      vus: 4,
      duration: '15s',
      exec: 'searchFlow',
    },
    // 2. Thundering Herd / Stampede Flow: 12 VUs simultaneously hammering the same track
    resolve_stampede_flow: {
      executor: 'ramping-vus',
      startVUs: 2,
      stages: [
        { duration: '3s', target: 12 },
        { duration: '12s', target: 12 },
        { duration: '3s', target: 0 },
      ],
      exec: 'resolveStampedeFlow',
    },
    // 3. Audio Streaming Flow: Range requests, HEAD requests, CORS preflight on stream proxies
    audio_streaming_flow: {
      executor: 'constant-vus',
      vus: 4,
      duration: '15s',
      exec: 'audioStreamingFlow',
    },
    // 4. Metadata & Lyrics Flow: Song detail, YouTube matching, lyrics fallback, announcements
    metadata_lyrics_flow: {
      executor: 'constant-vus',
      vus: 3,
      duration: '15s',
      exec: 'metadataLyricsFlow',
    },
  },
  thresholds: {
    errors: ['rate<0.05'], // Max 5% errors even under heavy concurrent stampede
    'search_latency': ['p(95)<4000'],
    'resolve_stream_latency': ['p(95)<3000'],
    'streaming_latency': ['p(95)<2500'],
  },
};

const VERIFIED_TRACKS = [
  { id: 'JmD8wHQ4IuAk', title: 'Chúng Ta Của Tương Lai', artist: 'Sơn Tùng M-TP', ytId: 'W8rP_F9S-n4' },
  { id: 'fF7U0Xv4B3N3', title: 'Nơi Này Có Anh', artist: 'Sơn Tùng M-TP', ytId: 'FN7ALfpGxiI' },
  { id: 'sc-123456', title: 'Đưa Nhau Đi Trốn', artist: 'Đen', ytId: '5e3r1K_nC3s' },
];

/**
 * Scenario 1: Search and Discovery Flow
 */
export function searchFlow() {
  const track = VERIFIED_TRACKS[Math.floor(Math.random() * VERIFIED_TRACKS.length)];
  const q = encodeURIComponent(track.title);

  // 1.1 All-source search
  const res1 = http.get(`${BASE_URL}/api/search?q=${q}&source=all`, {
    tags: { name: 'Search_All' },
    timeout: '15s',
  });
  searchLatency.add(res1.timings.duration);
  const p1 = check(res1, {
    'search all returns 200': (r) => r.status === 200,
    'search all has valid json': (r) => {
      try {
        const b = JSON.parse(r.body);
        return b && (Array.isArray(b.nhaccuatui) || Array.isArray(b.youtube) || Array.isArray(b.spotify));
      } catch {
        return false;
      }
    },
  });
  if (!p1) errorRate.add(1);

  // 1.2 Trending category search
  const categories = ['all', 'vietnamese', 'usuk'];
  const cat = categories[Math.floor(Math.random() * categories.length)];
  const res2 = http.get(`${BASE_URL}/api/search?trending=true&category=${cat}`, {
    tags: { name: 'Search_Trending' },
    timeout: '15s',
  });
  const p2 = check(res2, {
    'trending search returns 200': (r) => r.status === 200,
  });
  if (!p2) errorRate.add(1);

  sleep(0.8);
}

/**
 * Scenario 2: Thundering Herd Stampede Flow
 * Multiple concurrent VUs hit the exact same track simultaneously to test in-flight deduplication.
 */
export function resolveStampedeFlow() {
  const target = VERIFIED_TRACKS[0]; // All VUs hit the SAME song simultaneously
  const url = `${BASE_URL}/api/resolve-stream?title=${encodeURIComponent(target.title)}&artist=${encodeURIComponent(target.artist)}`;

  // 10% chance to trigger cache invalidation concurrently
  const isInvalidate = Math.random() < 0.1;
  const targetUrl = isInvalidate ? `${url}&invalidate=1` : url;

  const res = http.get(targetUrl, {
    tags: { name: isInvalidate ? 'ResolveStream_Invalidate' : 'ResolveStream_Stampede' },
    timeout: '15s',
  });

  resolveLatency.add(res.timings.duration);
  stampedeCoalesced.add(1);

  const pass = check(res, {
    'resolve-stream status is 200': (r) => r.status === 200,
    'resolve-stream returned valid streamUrl or miss': (r) => {
      try {
        const b = JSON.parse(r.body);
        return b.miss === true || (b.source && (b.streamUrl || b.id || b.resolvedId));
      } catch {
        return false;
      }
    },
  });
  if (!pass) errorRate.add(1);

  sleep(0.4);
}

/**
 * Scenario 3: Audio Streaming Proxy Flow
 * Tests range requests, HEAD metadata, and CORS preflight across stream endpoints.
 */
export function audioStreamingFlow() {
  const nctId = 'JmD8wHQ4IuAk';

  // 3.1 OPTIONS CORS preflight
  const optRes = http.options(`${BASE_URL}/api/nhaccuatui/stream?id=${nctId}`, null, {
    tags: { name: 'NCT_Stream_OPTIONS' },
  });
  const pOpt = check(optRes, {
    'NCT options returns 204': (r) => r.status === 204,
    'NCT options has CORS allow origin': (r) => r.headers['Access-Control-Allow-Origin'] === '*',
  });
  if (!pOpt) errorRate.add(1);

  // 3.2 HEAD request
  const headRes = http.head(`${BASE_URL}/api/nhaccuatui/stream?id=${nctId}`, {
    tags: { name: 'NCT_Stream_HEAD' },
    timeout: '12s',
  });
  const pHead = check(headRes, {
    'NCT head returns 200 or 206': (r) => r.status === 200 || r.status === 206,
  });
  if (!pHead) errorRate.add(1);

  // 3.3 Initial Range GET request (bytes=0-4096)
  const rangeRes1 = http.get(`${BASE_URL}/api/nhaccuatui/stream?id=${nctId}`, {
    headers: { Range: 'bytes=0-4096' },
    tags: { name: 'NCT_Stream_Range_Initial' },
    timeout: '15s',
  });
  streamingLatency.add(rangeRes1.timings.duration);
  const pRange1 = check(rangeRes1, {
    'NCT initial range returns 206 or 200': (r) => r.status === 206 || r.status === 200,
    'NCT initial range has audio data': (r) => r.body && r.body.length > 0,
  });
  if (!pRange1) errorRate.add(1);

  // 3.4 Middle Seek Range request (bytes=100000-200000)
  const rangeRes2 = http.get(`${BASE_URL}/api/nhaccuatui/stream?id=${nctId}`, {
    headers: { Range: 'bytes=100000-200000' },
    tags: { name: 'NCT_Stream_Range_Seek' },
    timeout: '15s',
  });
  const pRange2 = check(rangeRes2, {
    'NCT seek range returns 206 or 200': (r) => r.status === 206 || r.status === 200,
  });
  if (!pRange2) errorRate.add(1);

  // 3.5 Drive & YouTube Stream CORS check
  const ytOpt = http.options(`${BASE_URL}/api/youtube/stream`, null, {
    tags: { name: 'YouTube_Stream_OPTIONS' },
  });
  check(ytOpt, {
    'YouTube options returns 204': (r) => r.status === 204,
  });

  const driveOpt = http.options(`${BASE_URL}/api/drive-stream`, null, {
    tags: { name: 'Drive_Stream_OPTIONS' },
  });
  check(driveOpt, {
    'Drive options returns 204': (r) => r.status === 204,
  });

  sleep(0.8);
}

/**
 * Scenario 4: Metadata, Matching & Lyrics Flow
 */
export function metadataLyricsFlow() {
  const track = VERIFIED_TRACKS[0];

  // 4.1 Song detail API
  const songRes = http.get(`${BASE_URL}/api/nhaccuatui/song/${track.id}`, {
    tags: { name: 'NCT_Song_Detail' },
    timeout: '10s',
  });
  check(songRes, {
    'song detail returns 200': (r) => r.status === 200,
  });

  // 4.2 YouTube Match Stream API
  const matchRes = http.get(`${BASE_URL}/api/nhaccuatui/match-stream?id=${track.id}`, {
    tags: { name: 'NCT_Match_Stream' },
    timeout: '12s',
  });
  check(matchRes, {
    'match stream returns 200 or 502': (r) => r.status === 200 || r.status === 502,
  });

  // 4.3 YouTube Lyrics API
  const lyricsRes = http.get(
    `${BASE_URL}/api/youtube/lyrics?videoId=${track.ytId}&title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`,
    {
      tags: { name: 'YouTube_Lyrics' },
      timeout: '12s',
    }
  );
  lyricsLatency.add(lyricsRes.timings.duration);
  check(lyricsRes, {
    'lyrics returns 200 or 404': (r) => r.status === 200 || r.status === 404,
  });

  // 4.4 Global Announcements API
  const annRes = http.get(`${BASE_URL}/api/announcement`, {
    tags: { name: 'Announcement_Get' },
  });
  check(annRes, {
    'announcement returns 200': (r) => r.status === 200,
  });

  sleep(1);
}
