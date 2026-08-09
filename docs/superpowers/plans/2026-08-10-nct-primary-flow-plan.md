# NhacCuaTui Primary Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NhacCuaTui the primary search, playback, lyrics and catalog-recommendation source while silently falling back to the existing providers and hiding provider-specific UI.

**Architecture:** Keep Spotify, YouTube, iTunes, Drive and LRCLIB adapters available behind a unified orchestration layer. SearchContext will fetch NCT metadata first and merge fallback metadata behind it; PlayerContext will resolve a fresh NCT stream before direct/Drive/YouTube fallback; LyricsView will consume NCT lyrics before LRCLIB/YouTube. Source-specific UI controls and badges will be removed.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, existing Supabase/Spotify/YouTube/iTunes/NCT adapters, HTML5 Audio and Media Session.

## Global Constraints

- The UI must render one unified result list and must not show source tabs, source badges or fallback provider names.
- NCT is attempted first for external catalog search, playback, lyrics and recommendations.
- Fallback calls are silent and bounded; user-facing errors appear only after the full fallback chain fails.
- Signed NCT URLs must be HTTPS URLs on `stream.nct.vn`, must be fetched fresh for playback, and must never be persisted or logged with query parameters.
- Do not add YouTube audio extraction, geo-restriction bypasses or silent-audio keep-alive hacks.
- Preserve local uploads, favorites, playlists, history and existing explicit provider track compatibility.

---

### Task 1: Complete the NCT data contract and lyric normalization

**Files:**
- Modify: `types/index.ts`
- Modify: `lib/nhaccuatui.ts`
- Modify: `lib/nhaccuatuiClient.ts`
- Test: `lib/__tests__/nhaccuatui.test.ts`
- Test: `lib/__tests__/nhaccuatuiClient.test.ts`

**Interfaces:**
- `NhacCuaTuiSong` gains `lyric?: string | null`.
- `normalizeNhacCuaTuiLyrics(value: unknown): string | null` strips HTML wrappers, normalizes line breaks and returns `null` for empty/placeholder content.
- `nhacCuaTuiSearchItemToTrack(item: NhacCuaTuiSearchItem): Track` returns a Track with `id: nct-${item.id}`, `source: 'nhaccuatui'`, `nhaccuatui_id`, metadata, empty `file_path` and no signed URL.
- `resolveNhacCuaTuiAudio(target)` continues matching search metadata; `resolveNhacCuaTuiSong(id)` returns lyric data as well as the fresh signed URL.

- [ ] **Step 1: Write failing tests**

Add tests covering:

```ts
expect(normalizeNhacCuaTuiLyrics('<p>line one<br>line two</p>')).toBe('line one\nline two')
expect(normalizeNhacCuaTuiLyrics('')).toBeNull()

expect(nhacCuaTuiSearchItemToTrack({
  id: 'nct-1', title: 'Xương Rồng', artist: 'Dangrangto',
})).toMatchObject({
  id: 'nct-nct-1', source: 'nhaccuatui', nhaccuatui_id: 'nct-1', file_path: '',
})
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npx.cmd vitest run lib/__tests__/nhaccuatui.test.ts lib/__tests__/nhaccuatuiClient.test.ts`

Expected: FAIL because lyric normalization and the NCT-to-Track mapper do not exist yet.

- [ ] **Step 3: Implement the minimal contract**

Normalize NCT song lyric fields from `lyric`, `lyrics` or `lyricText`, reject known empty placeholders, add the Track mapper, and preserve the existing URL allowlist.

- [ ] **Step 4: Run the focused tests and verify they pass**

Run: `npx.cmd vitest run lib/__tests__/nhaccuatui.test.ts lib/__tests__/nhaccuatuiClient.test.ts`

Expected: PASS.

- [ ] **Step 5: Run TypeScript validation**

Run: `npx.cmd tsc --noEmit`

Expected: no new errors from the NCT contract.

---

### Task 2: Make search NCT-first and hide fallback providers

**Files:**
- Modify: `lib/searchApi.ts`
- Modify: `components/search/SearchContext.tsx`
- Modify: `components/navigation/TopBar.tsx`
- Modify: `app/(app)/page.tsx`
- Modify: `components/track/TrackRow.tsx`
- Create: `lib/searchFlow.ts`
- Test: `lib/__tests__/searchFlow.test.ts`

**Interfaces:**
- `GlobalSearchTracks` gains `nhaccuatui: Track[]`.
- `mergePrimarySearchResults(nctTracks: Track[], fallback: GlobalSearchTracks): GlobalSearchTracks` keeps NCT first while retaining fallback arrays internally.
- `flattenUnifiedSearchResults(results: GlobalSearchTracks): Track[]` returns deduplicated tracks in the order NCT, local, Spotify, iTunes, YouTube, Audius.

- [ ] **Step 1: Write failing ordering tests**

Test that NCT tracks precede fallback tracks, duplicate metadata keeps the NCT Track, and an NCT request failure still leaves fallback tracks available internally.

```ts
const merged = mergePrimarySearchResults([nctTrack], {
  local: [], youtube: [sameSongYoutube], audius: [], itunes: [], spotify: [sameSongSpotify], nhaccuatui: [],
})
expect(flattenUnifiedSearchResults(merged)[0].source).toBe('nhaccuatui')
```

- [ ] **Step 2: Run the test to confirm the new flow fails**

Run: `npx.cmd vitest run lib/__tests__/searchFlow.test.ts`

Expected: FAIL because the primary-flow helpers and `nhaccuatui` result field do not exist.

- [ ] **Step 3: Implement NCT-first SearchContext orchestration**

For each non-empty query, run `searchNhacCuaTui(query)` and the existing `fetchUnifiedSearch(query, 'all')` concurrently. Convert NCT items with `nhacCuaTuiSearchItemToTrack`, merge with NCT first, and keep fallback results only as unnamed unified tracks. For empty queries, return an empty `nhaccuatui` array. Keep trending behavior unchanged as a fallback catalog until an NCT trending endpoint exists.

- [ ] **Step 4: Implement unified UI presentation**

Use `flattenUnifiedSearchResults` in TopBar and the home page. Remove the source filter pills and source count labels from the home page. Remove Spotify/YouTube/Audius/iTunes badges from TrackRow. Replace provider names in the search placeholder with generic copy such as `Tìm bài hát, nghệ sĩ...`.

- [ ] **Step 5: Run focused search tests**

Run: `npx.cmd vitest run lib/__tests__/searchFlow.test.ts lib/__tests__/nhaccuatuiClient.test.ts`

Expected: PASS.

---

### Task 3: Make playback resolve NCT before every external fallback

**Files:**
- Modify: `components/player/PlayerContext.tsx`
- Modify: `lib/nhaccuatuiClient.ts`
- Modify: `lib/audioPlayback.ts`
- Test: `lib/__tests__/nhaccuatuiClient.test.ts`
- Test: `lib/__tests__/audioPlayback.test.ts`

**Interfaces:**
- Add `resolveNhacCuaTuiTrack(track: Track): Promise<NhacCuaTuiSong | null>` that uses `nhaccuatui_id` for exact NCT results and title/artist matching for Spotify/iTunes fallback metadata.
- `getAudioUrlCached` must bypass the cache for `source: 'nhaccuatui'`.
- `toPersistedTrack` must strip `audio_url` and signed `file_path` for NCT tracks.

- [ ] **Step 1: Write failing resolver tests**

Cover exact NCT ID resolution without a search request, Spotify metadata matching through NCT, and `null` on an invalid/failed NCT response.

- [ ] **Step 2: Run resolver tests and verify the new exact-ID path fails**

Run: `npx.cmd vitest run lib/__tests__/nhaccuatuiClient.test.ts`

Expected: FAIL for exact NCT Track resolution.

- [ ] **Step 3: Update PlayerContext orchestration**

For an external track without direct playable audio, run Drive, NCT and YouTube lookups concurrently, but choose results in this order: NCT, Drive/direct, YouTube. For a visible NCT result, resolve by `nhaccuatui_id` first. Set the active track to `source: 'nhaccuatui'` with an ephemeral fresh URL, then call `playAudioElement` on the native audio element. If NCT play fails, continue to Drive/YouTube without changing the user-facing track identity or showing a provider switch.

- [ ] **Step 4: Update fallback and restore behavior**

When restoring an NCT track from localStorage, resolve its ID again before setting `audio.src`. Keep the existing generic playback error only after all fallback engines fail. Preserve Media Session metadata and native HTML5 controls for NCT.

- [ ] **Step 5: Run playback-focused tests and type validation**

Run: `npx.cmd vitest run lib/__tests__/audioPlayback.test.ts lib/__tests__/nhaccuatuiClient.test.ts && npx.cmd tsc --noEmit`

Expected: focused tests pass; no new type errors.

---

### Task 4: Make NCT lyrics primary with silent LRCLIB/YouTube fallback

**Files:**
- Modify: `components/player/LyricsView.tsx`
- Modify: `lib/nhaccuatui.ts`
- Create: `lib/lyricsFlow.ts`
- Test: `lib/__tests__/lyricsFlow.test.ts`

**Interfaces:**
- `getPrimaryLyrics(track: Pick<Track, 'title' | 'artist' | 'album' | 'duration' | 'youtube_id' | 'nhaccuatui_id'>): Promise<LrclibResponse | null>` first resolves NCT song lyric and falls back to `fetchLyricsFromLrclib`.
- Existing LRCLIB behavior remains responsible for its own final YouTube Music fallback.

- [ ] **Step 1: Write failing lyrics precedence tests**

Mock an NCT song with usable lyrics and assert LRCLIB is not called. Mock an NCT song without lyrics and assert LRCLIB is called. Verify an NCT lyric with LRC timestamps is returned as synced lyrics and plain text is returned as plain lyrics.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx.cmd vitest run lib/__tests__/lyricsFlow.test.ts`

Expected: FAIL because the flow helper does not exist.

- [ ] **Step 3: Implement the primary lyrics flow**

Convert normalized NCT lyric text to the existing `LrclibResponse` shape. Detect timestamp lines with `parseLrc` compatibility; otherwise use `plainLyrics`. Only call LRCLIB when NCT has no usable lyric or the NCT request fails.

- [ ] **Step 4: Wire LyricsView to the helper**

Pass `currentTrack.nhaccuatui_id` and preserve the existing loading, parsing, scrolling and seek behavior. Do not display provider names in empty/error copy.

- [ ] **Step 5: Run lyrics tests**

Run: `npx.cmd vitest run lib/__tests__/lyricsFlow.test.ts lib/__tests__/nhaccuatuiClient.test.ts`

Expected: PASS.

---

### Task 5: Verify the integrated flow and update deployment notes

**Files:**
- Modify: `VERCEL_DEPLOY.md`
- Test: all focused tests from Tasks 1–4

- [ ] **Step 1: Run the full focused suite**

Run: `npx.cmd vitest run lib/__tests__/nhaccuatui.test.ts lib/__tests__/nhaccuatuiClient.test.ts lib/__tests__/audioPlayback.test.ts lib/__tests__/searchFlow.test.ts lib/__tests__/lyricsFlow.test.ts`

Expected: all new and changed-flow tests pass.

- [ ] **Step 2: Run repository checks**

Run: `git diff --check` and `npx.cmd tsc --noEmit`.

Expected: no whitespace errors and no new TypeScript errors. Existing unrelated NextAuth/build or network-dependent lyric failures must be reported separately if they recur.

- [ ] **Step 3: Smoke test local routes**

Run the dev server and check:

```text
GET /api/nhaccuatui/search?q=x%C6%B0%C6%A1ng%20r%E1%BB%93ng
GET /api/nhaccuatui/song/{returned-id}
```

Confirm metadata is returned, the song response contains an allowlisted `audioUrl`, and no full signed URL appears in server/browser logs or localStorage.

- [ ] **Step 4: Update Vercel handoff**

Document `NCT_API_BASE_URL` as optional with the default `https://music-api.vanhuy2004h.io.vn`, and state that custom endpoints must return the documented NCT response shape and authorized HTTPS stream URLs.

- [ ] **Step 5: Manual device acceptance test**

On iOS Safari: search a known NCT song, play it, lock the device, use the lock-screen play/pause/seek controls, then force an NCT failure and verify fallback still plays without a provider label or source-switch message.
