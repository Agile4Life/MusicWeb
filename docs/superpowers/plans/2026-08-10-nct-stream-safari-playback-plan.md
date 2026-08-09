# NhacCuaTui Stream and Safari Playback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Spotify search unchanged, prefer a fresh NhacCuaTui stream for playback, fall back to the existing YouTube IFrame, and harden direct HTML5 audio for Safari iOS background playback.

**Architecture:** Add a server-only NhacCuaTui adapter and two internal Next.js routes for search and signed song resolution. Add pure matching/validation helpers, then update `PlayerContext` to resolve NhacCuaTui before YouTube for Spotify/iTunes tracks while retaining local/Drive/Audius behavior. Direct sources continue through the persistent HTML5 audio element and Media Session; YouTube remains IFrame-only.

**Tech Stack:** Next.js App Router 16, React 19, TypeScript, native `fetch`, HTML5 `audio`, Media Session API, Vitest.

## Global Constraints

- Spotify remains the only search source shown for the requested playback flow.
- NhacCuaTui requests use `https://music-api.vanhuy2004h.io.vn` and signed `audioUrl` values are fetched fresh and never persisted.
- Only HTTPS `stream.nct.vn` audio URLs are accepted by the adapter.
- YouTube audio extraction/proxying is out of scope; failed NhacCuaTui playback falls back to the existing YouTube IFrame.
- No silent-audio keep-alive loop or visibility-based forced playback will be added.
- Existing local, Drive, Audius, iTunes, Spotify, and YouTube paths must remain functional.
- Every production function added or changed has a focused test before implementation code.

---

### Task 1: Add typed NhacCuaTui normalization, URL validation, and matching

**Files:**
- Create: `lib/nhaccuatui.ts`
- Create: `lib/__tests__/nhaccuatui.test.ts`

**Interfaces:**
- `NhacCuaTuiSearchItem`: `{ id: string; title: string; artist: string; thumbnail?: string; duration?: number | null }`.
- `NhacCuaTuiSong`: `{ id: string; title: string; artist: string; coverUrl?: string | null; duration?: number | null; audioUrl?: string | null }`.
- `normalizeNhacCuaTuiSearchResponse(value: unknown): NhacCuaTuiSearchItem[]`.
- `normalizeNhacCuaTuiSongResponse(value: unknown): NhacCuaTuiSong | null`.
- `isValidNhacCuaTuiAudioUrl(value: unknown): value is string`.
- `findBestNhacCuaTuiMatch(candidates, target): NhacCuaTuiSearchItem | null`.

- [ ] **Step 1: Write failing normalization and validation tests**

```ts
it('normalizes the search array returned by the ChillMsic backend', () => {
  expect(normalizeNhacCuaTuiSearchResponse([
    { id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto', thumbnail: 'https://img.test/cover.jpg' },
  ])).toEqual([
    { id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto', thumbnail: 'https://img.test/cover.jpg' },
  ])
})

it('accepts only HTTPS NCT stream URLs', () => {
  expect(isValidNhacCuaTuiAudioUrl('https://stream.nct.vn/song.mp3?e=123')).toBe(true)
  expect(isValidNhacCuaTuiAudioUrl('http://stream.nct.vn/song.mp3')).toBe(false)
  expect(isValidNhacCuaTuiAudioUrl('https://example.com/song.mp3')).toBe(false)
})

it('rejects song details without a usable audio URL', () => {
  expect(normalizeNhacCuaTuiSongResponse({ id: 'nct-1', title: 'X', artist: 'A' })).toBeNull()
})
```

- [ ] **Step 2: Run the focused test and verify it fails for missing exports**

Run: `npx.cmd vitest run lib/__tests__/nhaccuatui.test.ts`

Expected: FAIL because `lib/nhaccuatui.ts` and the named functions do not exist yet.

- [ ] **Step 3: Implement minimal normalization and validation**

Use `new URL(value)`, require `protocol === 'https:'` and `hostname === 'stream.nct.vn'`, and reject missing string fields. Keep provider fields separate from the project `Track` type until the player integration task.

- [ ] **Step 4: Add matching tests before matching implementation**

```ts
it('selects the title and artist match over a title-only candidate', () => {
  const result = findBestNhacCuaTuiMatch([
    { id: 'wrong', title: 'Xương Rồng', artist: 'Khác' },
    { id: 'right', title: 'Xương Rồng', artist: 'Dangrangto' },
  ], { title: 'Xương Rồng', artist: 'Dangrangto', duration: 254 })
  expect(result?.id).toBe('right')
})

it('returns null when candidates are unrelated', () => {
  expect(findBestNhacCuaTuiMatch(
    [{ id: 'wrong', title: 'Một bài khác', artist: 'Khác' }],
    { title: 'Xương Rồng', artist: 'Dangrangto', duration: 254 },
  )).toBeNull()
})
```

- [ ] **Step 5: Run the matching tests and verify the expected failure**

Run: `npx.cmd vitest run lib/__tests__/nhaccuatui.test.ts`

Expected: FAIL because `findBestNhacCuaTuiMatch` is not implemented.

- [ ] **Step 6: Implement matching and run the focused suite**

Normalize NFC, lowercase, remove punctuation and bracketed labels, score title token overlap and artist token overlap, apply a duration penalty only when both durations exist, reject low-score candidates, and preserve the first candidate on exact score ties. Run the same command and expect PASS.

- [ ] **Step 7: Commit the isolated helper/test change**

```bash
git add lib/nhaccuatui.ts lib/__tests__/nhaccuatui.test.ts
git commit -m "feat: add NhacCuaTui matching helpers"
```

### Task 2: Add server-side NhacCuaTui search and signed-song routes

**Files:**
- Create: `app/api/nhaccuatui/search/route.ts`
- Create: `app/api/nhaccuatui/song/[id]/route.ts`
- Create: `lib/nhaccuatuiClient.ts`
- Create: `lib/__tests__/nhaccuatuiClient.test.ts`
- Modify: `VERCEL_DEPLOY.md`

**Interfaces:**
- `GET /api/nhaccuatui/search?q=<query>` returns `{ items: NhacCuaTuiSearchItem[] }`.
- `GET /api/nhaccuatui/song/<id>` returns `{ song: NhacCuaTuiSong }` only when `audioUrl` passes validation.
- `searchNhacCuaTui(query): Promise<NhacCuaTuiSearchItem[]>`.
- `resolveNhacCuaTuiSong(id): Promise<NhacCuaTuiSong | null>`.

- [ ] **Step 1: Write client tests for successful search and invalid detail**

```ts
it('maps the internal search response to candidate items', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ items: [{ id: 'nct-1', title: 'X', artist: 'A' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )))
  await expect(searchNhacCuaTui('X A')).resolves.toEqual([{ id: 'nct-1', title: 'X', artist: 'A' }])
})

it('returns null when the song route has no playable stream', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ song: null }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )))
  await expect(resolveNhacCuaTuiSong('nct-1')).resolves.toBeNull()
})
```

- [ ] **Step 2: Run the client tests and verify they fail**

Run: `npx.cmd vitest run lib/__tests__/nhaccuatuiClient.test.ts`

Expected: FAIL because the client module and routes do not exist.

- [ ] **Step 3: Implement the server search route**

Read `process.env.NCT_API_BASE_URL || 'https://music-api.vanhuy2004h.io.vn'`, reject missing/blank queries with `400`, fetch `/api/search?q=...`, normalize the JSON array, and return only metadata. Use `cache: 'no-store'` for search while retaining a short in-memory cache only if it is already required by the project.

- [ ] **Step 4: Implement the server song route**

Reject IDs containing path separators or empty IDs with `400`, fetch `/api/song/{id}` with `cache: 'no-store'`, normalize the response, validate `audioUrl`, and return `404` when no playable stream exists. Do not log or return signed URLs in error messages.

- [ ] **Step 5: Implement the browser client and run focused tests**

The client calls only the internal `/api/nhaccuatui/*` routes, checks `response.ok`, parses JSON, and returns empty/null on provider failures so `PlayerContext` can fall back. Expect the focused suite to PASS.

- [ ] **Step 6: Document deployment configuration**

Add `NCT_API_BASE_URL=https://music-api.vanhuy2004h.io.vn` to the Vercel deployment instructions as an optional environment variable. The fallback keeps local/prod functional if the variable is omitted.

- [ ] **Step 7: Commit the route/client change**

```bash
git add app/api/nhaccuatui lib/nhaccuatuiClient.ts lib/__tests__/nhaccuatuiClient.test.ts VERCEL_DEPLOY.md
git commit -m "feat: add NhacCuaTui stream routes"
```

### Task 3: Add the NhacCuaTui source to the track model and player resolution

**Files:**
- Modify: `types.ts`
- Modify: `lib/audioPlayback.ts`
- Modify: `components/player/PlayerContext.tsx`
- Modify: `lib/__tests__/audioPlayback.test.ts`

**Interfaces:**
- Extend `Track.source` with `'nhaccuatui'`.
- Add `nhaccuatui_id?: string` to `Track`.
- Add an internal resolver in `PlayerContext` that returns `{ track: Track; audioUrl: string } | null`.

- [ ] **Step 1: Write failing source-routing tests**

```ts
it('routes a resolved NhacCuaTui track through HTML5 audio', () => {
  expect(shouldUseHtml5Audio({ source: 'nhaccuatui', audio_url: 'https://stream.nct.vn/a.mp3' })).toBe(true)
})
```

- [ ] **Step 2: Run the focused audio tests and verify the new case fails**

Run: `npx.cmd vitest run lib/__tests__/audioPlayback.test.ts`

Expected: FAIL until the helper accepts the new source shape.

- [ ] **Step 3: Add the track fields and implement direct-source routing**

Treat `nhaccuatui` with `audio_url` as a direct HTML5 track. Do not assign `youtube_id` to the resolved track, because that would incorrectly select the IFrame engine.

- [ ] **Step 4: Add the NCT-first resolver to the Spotify/iTunes branch**

For tracks without direct local/Drive/Audius audio, call the NCT search client with `${artist} ${title}`, select the best match, resolve its song detail, and create:

```ts
{
  ...track,
  id: track.id,
  source: 'nhaccuatui',
  nhaccuatui_id: matched.id,
  audio_url: resolved.audioUrl,
  file_path: resolved.audioUrl,
  cover_url: track.cover_url || resolved.coverUrl || null,
}
```

Keep Drive/local priority unchanged. If NCT returns null or direct `playAudioElement(audio)` rejects, clear the failed direct state and continue into the existing YouTube matching/fallback branch.

- [ ] **Step 5: Update queue pre-resolution without persisting signed URLs**

When pre-resolving the next external track, cache only the candidate ID and metadata in the in-memory queue. Resolve a fresh NCT `audioUrl` again when playback begins.

- [ ] **Step 6: Run type checking and player-focused tests**

Run: `npx.cmd vitest run lib/__tests__/audioPlayback.test.ts lib/__tests__/nhaccuatui.test.ts lib/__tests__/nhaccuatuiClient.test.ts`

Expected: PASS, followed by `npx.cmd tsc --noEmit` with no new errors.

- [ ] **Step 7: Commit player integration**

```bash
git add types.ts lib/audioPlayback.ts lib/__tests__/audioPlayback.test.ts components/player/PlayerContext.tsx
git commit -m "feat: prefer NhacCuaTui streams before YouTube"
```

### Task 4: Harden direct HTML5 audio for Safari iOS

**Files:**
- Modify: `components/player/PlayerContext.tsx`
- Modify: `lib/audioPlayback.ts`
- Modify: `lib/__tests__/audioPlayback.test.ts`

**Interfaces:**
- `redactAudioSource(value: string): string` returns a URL without query credentials for diagnostics.
- `playAudioElement(audio)` remains the single awaited play helper.

- [ ] **Step 1: Write failing diagnostics and metadata tests**

```ts
it('redacts signed query parameters from audio diagnostics', () => {
  expect(redactAudioSource('https://stream.nct.vn/a.mp3?st=secret&e=123')).toBe('https://stream.nct.vn/a.mp3')
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx.cmd vitest run lib/__tests__/audioPlayback.test.ts`

Expected: FAIL because `redactAudioSource` is not implemented.

- [ ] **Step 3: Implement safe diagnostics and direct playback hardening**

Use a stable event-handler map for the persistent audio debug listeners so cleanup removes the same functions that were added. Log only the redacted URL. Keep `audio.play()` promise handling and only set `isPlaying` after resolution. Do not add `visibilitychange` pause/resume loops or a silent source.

- [ ] **Step 4: Verify Media Session behavior for NCT**

Use the existing metadata/action handlers for any non-YouTube direct source. Confirm Play calls `playAudioElement(audioRef.current)`, Pause calls `audio.pause()`, and position updates use the HTML5 audio current time. Never route NCT to YouTube handlers based only on `source`.

- [ ] **Step 5: Run focused tests and static checks**

Run:

```bash
npx.cmd vitest run lib/__tests__/audioPlayback.test.ts lib/__tests__/nhaccuatui.test.ts lib/__tests__/nhaccuatuiClient.test.ts
npx.cmd tsc --noEmit
git diff --check
```

Expected: focused tests pass, TypeScript has no new errors, and diff check is clean.

- [ ] **Step 6: Commit Safari hardening**

```bash
git add components/player/PlayerContext.tsx lib/audioPlayback.ts lib/__tests__/audioPlayback.test.ts
git commit -m "fix: harden direct audio background playback"
```

### Task 5: End-to-end verification and handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-08-10-nct-stream-safari-playback-plan.md` to mark completed steps only after verification.

- [ ] **Step 1: Run the complete test suite**

Run: `npm.cmd test`

Expected: all newly added tests pass; report any pre-existing lyrics/network failures separately rather than hiding them.

- [ ] **Step 2: Smoke-test the production-compatible provider routes**

Use a read-only request to `/api/nhaccuatui/search?q=xương%20rồng` and then `/api/nhaccuatui/song/<id>`. Verify the response contains metadata and a fresh `audioUrl` without logging its query string.

- [ ] **Step 3: Manually test playback behavior**

Test a Spotify result with an NCT match and a result with no NCT match. Verify NCT playback uses the `<audio>` element, failed NCT resolution reaches YouTube, and an explicit YouTube track still uses the IFrame.

- [ ] **Step 4: Test background playback on real devices**

On Chrome desktop, Chrome mobile, and Safari iOS: tap Play, switch away, lock the screen, use lock-screen Play/Pause, return to the page, seek, and advance to the next track. Record the exact provider and whether the audio element emitted `pause`, `stalled`, `error`, or `ended`.

- [ ] **Step 5: Run final verification before claiming completion**

Run `git status --short`, focused tests, `npx.cmd tsc --noEmit`, and `git diff --check`. Report the production deployment requirement: Vercel must redeploy the commit and have `NCT_API_BASE_URL` set if the default endpoint is not desired.

