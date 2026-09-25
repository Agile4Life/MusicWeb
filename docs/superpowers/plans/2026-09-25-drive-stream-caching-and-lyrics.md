# Google Drive Stream R2 Caching & Lyrics Race Condition Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve Google Drive streaming latency and cache miss issues by fixing the Cloudflare Worker R2 caching bug (which previously bypassed R2 whenever HTML5 `<audio>` sent `Range: bytes=0-`), add automated worker unit tests, optimize client prewarming, and commit the verified lyrics race condition and memory cache suite in isolated, well-tested commits.

**Architecture:**
1. **Lyrics Suite**: In-memory caching + promise deduplication in `lyricsFlow.ts` and `romajiTransliteration.ts` with local song identity guards in `LyricsView.tsx` and `MobileFullviewPlayer.tsx`.
2. **Drive Stream Worker**: 3-tier cache (Edge Cache API -> R2 Object Storage -> Origin Resolver). Full-file detection even on `206 Partial Content` (for `Range: bytes=0-`) with `originRes.body.tee()` to stream immediately to the client while writing to R2 asynchronously in `ctx.waitUntil`. Background full-file caching on partial seeks.
3. **Prewarm Integration**: Background `HEAD` prewarming from client/resolver to populate R2 before playback begins.

**Tech Stack:** Next.js 16 (React 19), Cloudflare Workers, Cloudflare R2, Vitest, Playwright.

---

### Task 1: Verify & Commit Lyrics Race Condition & In-Memory Cache Suite

**Files:**
- Modify: `components/player/LyricsView.tsx`
- Modify: `components/player/MobileFullviewPlayer.tsx`
- Modify: `lib/lyricsFlow.ts`
- Modify: `lib/romajiTransliteration.ts`
- Modify: `lib/__tests__/lyricsFlow.test.ts`
- Test: `tests/e2e/lyrics_race_condition.spec.ts`

**Interfaces:**
- Consumes: `getPrimaryLyrics(track)` with in-memory caching and in-flight promise deduplication.
- Produces: Reliable, flicker-free lyric display during rapid track switching.

- [ ] **Step 1: Run unit tests for lyrics flow**
  Run: `npx vitest run lib/__tests__/lyricsFlow.test.ts`
  Expected: PASS (5/5 tests passing)

- [ ] **Step 2: Run Playwright E2E test for lyrics race conditions**
  Run: `npx playwright test tests/e2e/lyrics_race_condition.spec.ts`
  Expected: PASS (2/2 tests passing)

- [ ] **Step 3: Commit Task 1**
  ```bash
  git add components/player/LyricsView.tsx components/player/MobileFullviewPlayer.tsx lib/lyricsFlow.ts lib/romajiTransliteration.ts lib/__tests__/lyricsFlow.test.ts tests/e2e/lyrics_race_condition.spec.ts
  git commit -m "fix(lyrics): eliminate rapid song switch race conditions and add deduplication cache"
  ```

---

### Task 2: Drive Stream Cloudflare Worker — Unit Tests & Streaming R2 Cache

**Files:**
- Modify: `workers/music-drive-stream-cache/src/index.js`
- Test: `workers/music-drive-stream-cache/__tests__/driveStreamWorker.test.ts`

**Interfaces:**
- Consumes: `GET /api/drive-stream?id=<fileId>&filename=<hint>` with optional `Range` header.
- Produces:
  - 200/206 streaming audio response to browser.
  - Asynchronous teeing to R2 bucket `drive-songs/<fileId>`.
  - Native R2 Range slicing on subsequent requests.

- [ ] **Step 1: Write unit tests for the Worker**
  Create `workers/music-drive-stream-cache/__tests__/driveStreamWorker.test.ts` covering:
  - `Range: bytes=0-` causes `isFullFile = true` and calls `env.AUDIO_BUCKET.put()`.
  - Subsequent requests hit `env.AUDIO_BUCKET.head()` and return R2 range slices without origin fetch.
  - Partial seek `Range: bytes=1000-2000` returns the partial slice and calls background caching.
  - `HEAD /api/drive-stream?id=...` returns Content-Length and ETag from R2.
  - Corrupt 0-byte entries in R2 trigger cleanup.

- [ ] **Step 2: Run test to verify it runs against worker logic**
  Run: `npx vitest run workers/music-drive-stream-cache/__tests__/driveStreamWorker.test.ts`
  Expected: PASS

- [ ] **Step 3: Run dry-run deployment check on the worker**
  Run: `cd workers/music-drive-stream-cache && npx wrangler deploy --dry-run`
  Expected: Success without syntax or configuration errors.

- [ ] **Step 4: Commit Task 2**
  ```bash
  git add workers/music-drive-stream-cache/src/index.js workers/music-drive-stream-cache/__tests__/driveStreamWorker.test.ts
  git commit -m "feat(worker): fix 206 Range bypass bug to enable R2 streaming cache for Drive audio"
  ```

---

### Task 3: Client Prewarm & Fallback Optimization

**Files:**
- Modify: `lib/googleDriveUpload.ts`
- Modify: `app/api/drive-stream/prewarm/route.ts`
- Test: `lib/__tests__/playbackFallback.test.ts`
- Test: `lib/__tests__/driveFileId.test.ts`

**Interfaces:**
- Consumes: `triggerDrivePrewarm(tracks)`
- Produces: Asynchronous prewarming that not only resolves Google Drive CDN URLs but also pings the Cloudflare Worker to pre-fill R2 before playback starts.

- [ ] **Step 1: Add prewarming worker ping to `lib/googleDriveUpload.ts`**
  Ensure `triggerDrivePrewarm` sends HEAD pings to `DRIVE_STREAM_WORKER_BASE` if available.

- [ ] **Step 2: Run existing playback fallback and drive tests**
  Run: `npx vitest run lib/__tests__/playbackFallback.test.ts lib/__tests__/driveFileId.test.ts`
  Expected: PASS

- [ ] **Step 3: Commit Task 3**
  ```bash
  git add lib/googleDriveUpload.ts app/api/drive-stream/prewarm/route.ts lib/__tests__/playbackFallback.test.ts lib/__tests__/driveFileId.test.ts
  git commit -m "perf(drive): integrate worker prewarming and optimize drive streaming fallback"
  ```

---

### Task 4: Full Regression Verification & Knowledge Graph Update

- [ ] **Step 1: Run comprehensive test suite**
  Run: `npx vitest run`
  Expected: All test suites pass.

- [ ] **Step 2: Run graphify update**
  Run: `graphify update .`
  Expected: Knowledge graph up to date.
