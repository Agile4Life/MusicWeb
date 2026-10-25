# Admin Custom Lyrics & Live LRC Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Admin users (`isAdmin(email)`) to write, edit, and live-sync (`[mm:ss.xx]` LRC or plain text) lyrics for any track—especially tracks where automatic lyrics cannot be found—persisted in Supabase `public.tracks.lyrics` and immediately reflected across desktop and mobile lyrics views.

**Architecture:** A pure LRC/custom-lyrics utility module (`lib/customLyrics.ts`), an Admin-authenticated API endpoint (`/api/lyrics/custom`) backed by `public.tracks.lyrics` + `resolveExternalTrackId` + in-memory cache, highest-priority resolution in `getPrimaryLyrics` (`lib/lyricsFlow.ts`), and an interactive `AdminLyricsEditorModal` wired into `LyricsView.tsx` and `MobileFullviewPlayer.tsx`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Supabase, NextAuth, Tailwind CSS, Lucide Icons, Vitest.

## Global Constraints
- Only authenticated users with `isAdmin(email) === true` can see the "Viết lời bài hát" / "Sửa lời" buttons and call `POST /api/lyrics/custom`.
- Non-admin callers to `POST /api/lyrics/custom` must receive `403 Forbidden`.
- Custom Admin lyrics take highest priority in `getPrimaryLyrics`, including for SoundCloud UGC/Remix tracks where automatic LRCLIB lookup is skipped.
- Preserve the existing `useEffect` signature in `MobileFullviewPlayer.tsx` so `components/player/__tests__/mobileLyricsOwnership.test.ts` continues to pass.

---

### Task 1: Create Custom Lyrics & Live LRC Sync Helpers (`lib/customLyrics.ts`)

**Files:**
- Create: `lib/customLyrics.ts`
- Test: `lib/__tests__/customLyrics.test.ts`

**Interfaces:**
- Produces:
  - `EditableLyricLine`: `{ time: number | null; text: string }`
  - `hasLrcTimestamps(lyrics: string): boolean`
  - `formatLrcTimestamp(seconds: number): string`
  - `customLyricsToLrclibResponse(track: { id?: string; title: string; artist?: string | null; album?: string | null; duration?: number | null }, rawLyrics: string): LrclibResponse | null`
  - `parseEditableLyricLines(rawText: string): EditableLyricLine[]`
  - `serializeEditableLyricLines(lines: EditableLyricLine[]): string`
  - `stampLineAtIndex(lines: EditableLyricLine[], index: number, seconds: number): EditableLyricLine[]`
  - `nudgeLineTimestamp(lines: EditableLyricLine[], index: number, deltaSeconds: number): EditableLyricLine[]`
  - `stripAllLrcTimestamps(rawText: string): string`
  - `makeCustomLyricsLookupKey(track: { id?: string | null; title?: string | null; artist?: string | null; youtube_id?: string | null; nhaccuatui_id?: string | null; soundcloud_id?: string | number | null; spotify_id?: string | null; file_path?: string | null }): string`

- [ ] **Step 1: Write the failing test (`lib/__tests__/customLyrics.test.ts`)**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Implement `lib/customLyrics.ts`**
- [ ] **Step 4: Run test to verify it passes**

---

### Task 2: Create `/api/lyrics/custom` Endpoint (`app/api/lyrics/custom/route.ts`)

**Files:**
- Create: `app/api/lyrics/custom/route.ts`

**Interfaces:**
- Consumes: `isAdmin`, `getValidUserId` from `lib/accessControl.ts`; `resolveExternalTrackId` from `lib/trackPersistence.ts`; `customLyricsToLrclibResponse`, `makeCustomLyricsLookupKey` from `lib/customLyrics.ts`.
- Produces: `GET /api/lyrics/custom` and `POST /api/lyrics/custom`.

- [ ] **Step 1: Implement `app/api/lyrics/custom/route.ts` with Admin verification, `public.tracks.lyrics` lookup/persistence, and in-memory cache**

---

### Task 3: Integrate Custom Lyrics Priority in `lib/lyricsFlow.ts`

**Files:**
- Modify: `lib/lyricsFlow.ts`
- Modify: `lib/__tests__/lyricsFlow.test.ts`

**Interfaces:**
- Consumes: `customLyricsToLrclibResponse`, ` hasLrcTimestamps` from `lib/customLyrics.ts`.
- Produces: `getPrimaryLyrics(track)` with custom lyrics priority, `setCustomLyricsInPrimaryCache(track, response)`, `LYRICS_UPDATED_EVENT`.

- [ ] **Step 1: Add unit tests in `lib/__tests__/lyricsFlow.test.ts` for custom lyrics priority (including SoundCloud remix/UGC tracks)**
- [ ] **Step 2: Update `lib/lyricsFlow.ts` to resolve custom lyrics first and export cache update helpers**
- [ ] **Step 3: Run `npx vitest run lib/__tests__/lyricsFlow.test.ts` and verify all tests pass**

---

### Task 4: Build `AdminLyricsEditorModal` Component (`components/player/AdminLyricsEditorModal.tsx`)

**Files:**
- Create: `components/player/AdminLyricsEditorModal.tsx`

**Interfaces:**
- Consumes: `usePlaybackProgress`, `usePlayerTrack`, `usePlayerControls` from `components/player/PlayerContext.tsx`; helpers from `lib/customLyrics.ts`; `setCustomLyricsInPrimaryCache`, `LYRICS_UPDATED_EVENT` from `lib/lyricsFlow.ts`; `toast` from `components/ui/ToastContext.tsx`.
- Produces: `AdminLyricsEditorModal` component with Text/LRC editor tab and Live LRC Sync tab.

- [ ] **Step 1: Implement `components/player/AdminLyricsEditorModal.tsx`**

---

### Task 5: Wire Admin Controls into `LyricsView.tsx` and `MobileFullviewPlayer.tsx`

**Files:**
- Modify: `components/player/LyricsView.tsx`
- Modify: `components/player/MobileFullviewPlayer.tsx`

**Interfaces:**
- Consumes: `AdminLyricsEditorModal`, `useCurrentUser`, `isAdmin`, `LYRICS_UPDATED_EVENT`.

- [ ] **Step 1: Add Admin "Viết lời bài hát" & "Sửa lời" buttons + modal + live update listener in `components/player/LyricsView.tsx`**
- [ ] **Step 2: Add Admin "Viết lời bài hát" & "Sửa lời" buttons + modal + live update listener in `components/player/MobileFullviewPlayer.tsx`**
- [ ] **Step 3: Run all lyrics & mobile ownership tests (`npx vitest run`) and `graphify update .`**

