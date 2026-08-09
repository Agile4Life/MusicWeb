# NCT-First Playlist Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Spotify and YouTube Music playlist imports persist an NCT match per item while silently retaining the original provider as fallback.

**Architecture:** Add one pure-orchestration helper around the existing `resolveNhacCuaTuiTrack` client. Call it from both import modals immediately before database persistence, then persist NCT identity/metadata without signed stream URLs. Existing playlist order, selection, and fallback behavior remain unchanged.

**Tech Stack:** Next.js client components, TypeScript, Supabase, Vitest.

## Global Constraints

- NCT is the primary catalog for imported playlist items.
- Spotify/YouTube remain silent fallbacks when NCT cannot resolve a match.
- Signed NCT URLs must never be persisted.
- Playlist item order must not change.

### Task 1: Shared playlist NCT resolver

**Files:**
- Create: `lib/playlistNct.ts`
- Test: `lib/__tests__/playlistNct.test.ts`

**Interfaces:**
- Consumes: `Track`, `resolveNhacCuaTuiTrack`.
- Produces: `resolvePlaylistTrackWithNct(track: Track): Promise<Track>`.

- [ ] **Step 1: Write the failing tests**

Test that a matching NCT response replaces the candidate with `source: 'nhaccuatui'`, `nhaccuatui_id`, NCT metadata, an empty `file_path`, and no `audio_url`; test that a null result or thrown error returns the original fallback track.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `npx.cmd vitest run lib/__tests__/playlistNct.test.ts`

Expected: FAIL because `lib/playlistNct.ts` and `resolvePlaylistTrackWithNct` do not exist.

- [ ] **Step 3: Implement the minimal resolver**

Call `resolveNhacCuaTuiTrack` with title, artist, album, duration, source, and `nhaccuatui_id`. On success, map the returned song to a persisted `Track` without its signed URL. On failure, return the original candidate unchanged.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `npx.cmd vitest run lib/__tests__/playlistNct.test.ts`

Expected: PASS.

### Task 2: Integrate Spotify and YouTube playlist imports

**Files:**
- Modify: `components/playlist/ImportSpotifyModal.tsx`
- Modify: `components/playlist/ImportYouTubePlaylistModal.tsx`

**Interfaces:**
- Consumes: `resolvePlaylistTrackWithNct` from Task 1.
- Produces: both import flows pass an NCT-first track into existing DB lookup/insertion while preserving the loop index for `position`.

- [ ] **Step 1: Add the resolver calls before persistence**

In each import loop, resolve the selected external candidate once, then use the resolved track for existing-record lookup, insert payload, and fallback identity fields. Keep the original Spotify metadata as the artist/album fallback only when the resolver returns the original candidate.

- [ ] **Step 2: Persist NCT identity fields**

Include `source: 'nhaccuatui'` and `nhaccuatui_id` for NCT records, omit signed `audio_url`/`file_path`, and retain the existing YouTube/Spotify fields for fallback records. Do not change playlist position or success counting.

- [ ] **Step 3: Run focused tests and TypeScript**

Run: `npx.cmd vitest run lib/__tests__/playlistNct.test.ts lib/__tests__/nhaccuatui.test.ts lib/__tests__/nhaccuatuiClient.test.ts lib/__tests__/audioPlayback.test.ts lib/__tests__/searchFlow.test.ts lib/__tests__/lyricsFlow.test.ts app/api/nhaccuatui/__tests__/route.test.ts`

Run: `npx.cmd tsc --noEmit`

Expected: focused tests pass; TypeScript reports only the existing NextAuth generated-route `authOptions` error if it remains present.

### Task 3: Final verification

**Files:**
- Verify: all changed files and `git diff --check`.

- [ ] **Step 1: Run diff validation**

Run: `git diff --check`

- [ ] **Step 2: Run the full test suite**

Run: `npx.cmd vitest run`

Report any pre-existing network-dependent lyrics failures separately from the new playlist-import tests.
