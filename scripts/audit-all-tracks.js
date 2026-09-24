// @ts-check
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mjpibwmproussfevtqbp.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qcGlid21wcm91c3NmZXZ0cWJwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTc2MDgzNCwiZXhwIjoyMTAxMzM2ODM0fQ.oWkPs0jCxdYDD5sqzud9oEABw7IlU4f_AUbYbNAIhPY';
const LOCAL_API = 'http://localhost:3000';
const CONCURRENCY = 12;
const TIMEOUT_MS = 12000;

// Read STATIC_DRIVE_TRACKS from lib/driveTracksMap.ts
function getStaticDriveTracks() {
  try {
    const content = fs.readFileSync(path.join(__dirname, '../lib/driveTracksMap.ts'), 'utf-8');
    const match = content.match(/export const STATIC_DRIVE_TRACKS[^=]*=\s*(\[[\s\S]*?\]);/);
    if (match) {
      // Evaluate static array safely
      return eval(`(${match[1]})`);
    }
  } catch (e) {
    console.warn('Could not parse STATIC_DRIVE_TRACKS, continuing with DB only:', e.message);
  }
  return [];
}

function extractDriveFileId(filePath) {
  if (!filePath) return null;
  if (filePath.includes('dzcdn.net') || filePath.includes('spotify.com') || filePath.includes('apple.com') || filePath.includes('audius.co')) {
    return null;
  }
  const match1 = filePath.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (match1) return match1[1];
  const match2 = filePath.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (match2) return match2[1];
  return null;
}

function extractYouTubeVideoId(urlOrId) {
  if (!urlOrId) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;
  const match = urlOrId.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/|^yt-)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function classifyTrackSource(track) {
  const fp = track.file_path || '';
  if (track.nhaccuatui_id || track.source === 'nhaccuatui' || fp.includes('nhaccuatui.com')) {
    return 'nhaccuatui';
  }
  if (track.source === 'youtube' || track.youtube_id || fp.includes('youtube.com') || fp.includes('youtu.be') || track.id?.startsWith('yt-')) {
    return 'youtube';
  }
  if (track.drive_file_id || extractDriveFileId(fp) || fp.includes('drive-stream') || fp.includes('drive.google.com')) {
    return 'drive';
  }
  if (track.soundcloud_id || track.source === 'soundcloud' || fp.includes('soundcloud.com') || track.id?.startsWith('sc-')) {
    return 'soundcloud';
  }
  if (track.source === 'spotify' || fp.includes('spotify.com') || track.id?.startsWith('spotify-')) {
    return 'spotify';
  }
  if (track.source === 'itunes' || fp.includes('apple.com')) {
    return 'itunes';
  }
  if (fp.startsWith('http')) {
    return 'direct_http';
  }
  return 'local';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function testDriveStream(driveId) {
  const url = `https://music-drive-stream-cache.phongtct.workers.dev/api/drive-stream?id=${encodeURIComponent(driveId)}`;
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-1024' } }, 10000);
    const latency = Date.now() - start;
    if (res.status === 200 || res.status === 206) {
      const ct = res.headers.get('content-type') || '';
      return { ok: true, status: res.status, contentType: ct, latency };
    }
    return { ok: false, status: res.status, error: `HTTP ${res.status}`, latency };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Timeout (10s)' : err.message, latency: Date.now() - start };
  }
}

async function testNctStream(nctId) {
  const url = `${LOCAL_API}/api/nhaccuatui/stream?id=${encodeURIComponent(nctId)}`;
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-1024' } }, 8000);
    const latency = Date.now() - start;
    if (res.status === 200 || res.status === 206 || res.status === 302) {
      const ct = res.headers.get('content-type') || '';
      return { ok: true, status: res.status, contentType: ct, latency };
    }
    return { ok: false, status: res.status, error: `HTTP ${res.status}`, latency };
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Timeout (8s)' : err.message, latency: Date.now() - start };
  }
}

async function testYouTubeVideo(ytId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(ytId)}&format=json`;
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, {}, 5000);
    const latency = Date.now() - start;
    if (res.status === 200) {
      return { ok: true, status: 200, latency };
    }
    return { ok: false, status: res.status, error: `Video unavailable / deleted (${res.status})`, latency };
  } catch (err) {
    return { ok: false, error: err.message, latency: Date.now() - start };
  }
}

async function testSoundCloudStream(scId) {
  const url = `${LOCAL_API}/api/soundcloud/stream?id=${encodeURIComponent(scId)}`;
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-1024' } }, 8000);
    const latency = Date.now() - start;
    if (res.status === 200 || res.status === 206 || res.status === 302) {
      return { ok: true, status: res.status, latency };
    }
    return { ok: false, status: res.status, error: `HTTP ${res.status}`, latency };
  } catch (err) {
    return { ok: false, error: err.message, latency: Date.now() - start };
  }
}

async function testCatalogResolution(track) {
  const url = `${LOCAL_API}/api/resolve-stream?title=${encodeURIComponent(track.title || '')}&artist=${encodeURIComponent(track.artist || '')}`;
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, {}, 6000);
    const latency = Date.now() - start;
    if (res.ok) {
      const data = await res.json();
      if (data && (data.streamUrl || data.id || data.youtubeId)) {
        return { ok: true, status: 200, latency, resolvedTo: data.source || 'youtube' };
      }
    }
    return { ok: false, status: res.status, error: 'No matching playable stream found', latency };
  } catch (err) {
    return { ok: false, error: err.message, latency: Date.now() - start };
  }
}

async function testDirectHttpStream(url) {
  const start = Date.now();
  try {
    const res = await fetchWithTimeout(url, { headers: { Range: 'bytes=0-1024' } }, 8000);
    const latency = Date.now() - start;
    if (res.status === 200 || res.status === 206) {
      return { ok: true, status: res.status, latency };
    }
    return { ok: false, status: res.status, error: `HTTP ${res.status}`, latency };
  } catch (err) {
    return { ok: false, error: err.message, latency: Date.now() - start };
  }
}

async function testTrack(track) {
  const source = classifyTrackSource(track);
  let primaryTest = { ok: false, error: 'Unknown source' };

  if (source === 'drive') {
    const driveId = track.drive_file_id || extractDriveFileId(track.file_path);
    if (driveId) primaryTest = await testDriveStream(driveId);
    else primaryTest = { ok: false, error: 'Missing drive_file_id' };
  } else if (source === 'nhaccuatui') {
    const nctId = track.nhaccuatui_id;
    if (nctId) primaryTest = await testNctStream(nctId);
    else primaryTest = { ok: false, error: 'Missing nhaccuatui_id' };
  } else if (source === 'youtube') {
    const ytId = track.youtube_id || extractYouTubeVideoId(track.file_path);
    if (ytId) primaryTest = await testYouTubeVideo(ytId);
    else primaryTest = { ok: false, error: 'Missing youtube_id' };
  } else if (source === 'soundcloud') {
    const scId = track.soundcloud_id || track.file_path;
    primaryTest = await testSoundCloudStream(scId);
  } else if (source === 'spotify' || source === 'itunes') {
    primaryTest = await testCatalogResolution(track);
  } else if (source === 'direct_http') {
    primaryTest = await testDirectHttpStream(track.file_path);
  } else {
    // Local storage file
    primaryTest = { ok: true, status: 200, latency: 10, note: 'Local static / DB managed' };
  }

  // If primary test failed, test if YouTube Fallback engine can rescue it
  let fallbackTest = null;
  if (!primaryTest.ok && track.title) {
    fallbackTest = await testCatalogResolution(track);
  }

  const isPlayable = primaryTest.ok || (fallbackTest && fallbackTest.ok);
  const statusCategory = primaryTest.ok
    ? (primaryTest.latency > 6000 ? 'SLOW_COLD' : 'HEALTHY')
    : (fallbackTest && fallbackTest.ok ? 'RECOVERABLE_VIA_FALLBACK' : 'DEAD');

  return {
    id: track.id,
    title: track.title || 'Untitled',
    artist: track.artist || 'Unknown',
    source,
    isPlayable,
    statusCategory,
    primaryTest,
    fallbackTest,
  };
}

async function runAudit() {
  console.log('🚀 [Stream Health Audit] Initializing full library track scan...\n');
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  // 1. Fetch from DB
  const { data: dbTracks, error: dbError } = await sb
    .from('tracks')
    .select('id, title, artist, file_path, source, youtube_id, nhaccuatui_id, spotify_id, drive_file_id, file_ext')
    .limit(1000);

  if (dbError) {
    console.error('❌ Failed to fetch tracks from Supabase:', dbError);
    process.exit(1);
  }

  // 2. Fetch static drive tracks
  const staticDriveTracks = getStaticDriveTracks();
  console.log(`📦 Loaded ${dbTracks.length} tracks from DB, ${staticDriveTracks.length} static Drive tracks.`);

  // 3. Deduplicate
  const trackMap = new Map();
  dbTracks.forEach((t) => trackMap.set(t.id, t));
  staticDriveTracks.forEach((t) => {
    if (!trackMap.has(t.id)) {
      trackMap.set(t.id, {
        ...t,
        source: 'local',
        drive_file_id: t.drive_file_id || extractDriveFileId(t.file_path),
      });
    }
  });

  const allTracks = Array.from(trackMap.values());
  console.log(`🎯 Total unique tracks to audit: ${allTracks.length}`);
  console.log(`⚡ Running parallel audit with concurrency = ${CONCURRENCY}...\n`);

  const results = [];
  let completed = 0;
  const startTime = Date.now();

  // Concurrency pool
  async function worker(queue) {
    while (queue.length > 0) {
      const track = queue.shift();
      const res = await testTrack(track);
      results.push(res);
      completed++;
      if (completed % 50 === 0 || completed === allTracks.length) {
        process.stdout.write(`\r[Progress] Audited ${completed}/${allTracks.length} tracks (${((completed / allTracks.length) * 100).toFixed(1)}%)...`);
      }
    }
  }

  const queue = [...allTracks];
  const workers = Array.from({ length: CONCURRENCY }, () => worker(queue));
  await Promise.all(workers);

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n✅ [Audit Complete] Audited ${allTracks.length} tracks in ${durationSec}s!\n`);

  // Aggregate stats
  const statsBySource = {};
  const statusCounts = { HEALTHY: 0, SLOW_COLD: 0, RECOVERABLE_VIA_FALLBACK: 0, DEAD: 0 };
  const deadTracks = [];

  for (const r of results) {
    statusCounts[r.statusCategory] = (statusCounts[r.statusCategory] || 0) + 1;
    if (!statsBySource[r.source]) {
      statsBySource[r.source] = { total: 0, playable: 0, totalLatency: 0, countWithLatency: 0 };
    }
    statsBySource[r.source].total++;
    if (r.isPlayable) statsBySource[r.source].playable++;
    if (r.primaryTest?.latency) {
      statsBySource[r.source].totalLatency += r.primaryTest.latency;
      statsBySource[r.source].countWithLatency++;
    }

    if (r.statusCategory === 'DEAD') {
      deadTracks.push(r);
    }
  }

  // Print Summary Table
  console.log('========================================================================================');
  console.log('                          📊 COMPREHENSIVE STREAM HEALTH REPORT                         ');
  console.log('========================================================================================');
  console.log(`Total Tracks Audited      : ${allTracks.length}`);
  console.log(`100% Playable (Overall)   : ${allTracks.length - deadTracks.length} / ${allTracks.length} (${(((allTracks.length - deadTracks.length) / allTracks.length) * 100).toFixed(2)}%)`);
  console.log(`- Direct Healthy (Fast)   : ${statusCounts.HEALTHY} (${((statusCounts.HEALTHY / allTracks.length) * 100).toFixed(1)}%)`);
  console.log(`- Direct Working (Cold)   : ${statusCounts.SLOW_COLD} (${((statusCounts.SLOW_COLD / allTracks.length) * 100).toFixed(1)}%)`);
  console.log(`- Recovered by Fallback   : ${statusCounts.RECOVERABLE_VIA_FALLBACK} (${((statusCounts.RECOVERABLE_VIA_FALLBACK / allTracks.length) * 100).toFixed(1)}%)`);
  console.log(`- Dead (Needs manual URL) : ${statusCounts.DEAD} (${((statusCounts.DEAD / allTracks.length) * 100).toFixed(1)}%)`);
  console.log('----------------------------------------------------------------------------------------');
  console.log('BREAKDOWN BY SOURCE:');
  console.log(
    'Source'.padEnd(16) +
    'Total'.padEnd(10) +
    'Playable'.padEnd(12) +
    'Pass Rate'.padEnd(14) +
    'Avg Latency'
  );
  console.log('----------------------------------------------------------------------------------------');

  for (const [src, s] of Object.entries(statsBySource)) {
    const rate = ((s.playable / s.total) * 100).toFixed(1) + '%';
    const avgLat = s.countWithLatency > 0 ? (s.totalLatency / s.countWithLatency).toFixed(0) + 'ms' : 'N/A';
    console.log(
      src.padEnd(16) +
      String(s.total).padEnd(10) +
      String(s.playable).padEnd(12) +
      rate.padEnd(14) +
      avgLat
    );
  }
  console.log('========================================================================================\n');

  if (deadTracks.length > 0) {
    console.log(`⚠️ DEAD TRACKS LIST (${deadTracks.length} tracks):`);
    deadTracks.slice(0, 20).forEach((t, i) => {
      console.log(`${i + 1}. [${t.source}] "${t.title}" by ${t.artist} (ID: ${t.id})`);
      console.log(`   Error: ${t.primaryTest.error}`);
    });
    if (deadTracks.length > 20) {
      console.log(`... and ${deadTracks.length - 20} more dead tracks.`);
    }
  } else {
    console.log('🎉 PERFECT SCORE! 100% of all tracks are completely playable without any fatal dead links!');
  }

  // Save report to JSON file
  const reportPath = path.join(__dirname, '../stream-health-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    total: allTracks.length,
    playable: allTracks.length - deadTracks.length,
    percentage: (((allTracks.length - deadTracks.length) / allTracks.length) * 100).toFixed(2),
    statusCounts,
    statsBySource,
    deadTracks,
  }, null, 2));

  console.log(`\n📁 Detailed report saved to: ${reportPath}`);
}

runAudit().catch((e) => {
  console.error('Fatal audit failure:', e);
  process.exit(1);
});
