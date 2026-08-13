# Listening History Accuracy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make listening history and “Recently Played” consistently use persisted `listening_history` data, including external tracks, without depending on Supabase embedded relationships.

**Architecture:** Add a small client-side history repository that loads history rows and tracks in two queries, then joins them by `track_id`. Use it from the history page, home page, and queue drawer. Keep the existing player-memory history only as an immediate fallback, and make history writes report failures instead of silently discarding them.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase JS, Vitest.

## Global Constraints

- Do not require a foreign-key relationship for reading history.
- Preserve the existing distinction: `/history` shows play entries; home/drawer show unique tracks ordered by latest play.
- Do not change the database schema in this fix.
- Add regression tests before production changes and run them through a red-green cycle.

---

### Task 1: Add a testable listening-history repository

**Files:**
- Create: `lib/listeningHistory.ts`
- Create: `lib/__tests__/listeningHistory.test.ts`

**Interfaces:**
- Produces `fetchListeningHistory(supabase, userId, limit): Promise<ListeningHistoryItem[]>`.
- Produces `getRecentUniqueTracks(items): Track[]`.
- The repository must query `listening_history` rows without embedding `tracks`, query `tracks` by the returned IDs, and join in application code.

- [ ] **Step 1: Write failing tests**

  Cover these behaviors: two history rows for the same track remain two entries; recent unique tracks retain latest-play order; missing track rows are skipped; query errors are returned to the caller rather than converted into an empty successful result.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npm.cmd test -- lib/__tests__/listeningHistory.test.ts --run`

  Expected: FAIL because `lib/listeningHistory.ts` does not exist.

- [ ] **Step 3: Implement the minimal repository**

  Query `listening_history` with `id, user_id, track_id, played_at`, order by `played_at` descending, and apply the limit. Query `tracks` with `.in('id', ids)`. Build a map by track ID and return only rows with a matching track. Preserve each history row’s `id` and `played_at`.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run: `npm.cmd test -- lib/__tests__/listeningHistory.test.ts --run`

- [ ] **Step 5: Commit**

  Run: `git add lib/listeningHistory.ts lib/__tests__/listeningHistory.test.ts; git commit -m "test: add persisted listening history repository"`

### Task 2: Use persisted history on the history page and home page

**Files:**
- Modify: `app/(app)/history/page.tsx`
- Modify: `app/(app)/page.tsx`

**Interfaces:**
- Consume `fetchListeningHistory` and `getRecentUniqueTracks` from `lib/listeningHistory.ts`.

- [ ] **Step 1: Update the history page read path**

  Replace the embedded `tracks:track_id(*)` query and local ad-hoc mapping with the repository result. Keep existing source inference and rendering behavior, but log the repository error and show the existing empty/error state instead of silently accepting an unknown response shape.

- [ ] **Step 2: Update the home recent read path**

  Replace the embedded relation query with the repository and use `getRecentUniqueTracks` so the home list remains unique by track ID while ordered by the latest history row.

- [ ] **Step 3: Run focused tests and typecheck**

  Run: `npm.cmd test -- lib/__tests__/listeningHistory.test.ts --run` and `npx.cmd tsc --noEmit`.

- [ ] **Step 4: Commit**

  Run: `git add "app/(app)/history/page.tsx" "app/(app)/page.tsx"; git commit -m "fix: read persisted listening history without embedded relations"`

### Task 3: Make QueueDrawer use the same persisted recent history

**Files:**
- Modify: `components/player/QueueDrawer.tsx`
- Create or modify: `components/player/__tests__/QueueDrawer.test.tsx` only if the existing test setup supports rendering this provider cleanly.

**Interfaces:**
- Consume `fetchListeningHistory` and `getRecentUniqueTracks`.
- Use the active Supabase/NextAuth-derived user ID already used by the application.

- [ ] **Step 1: Add the regression assertion**

  Assert that recently played tracks come from persisted history and are not derived from `queue.slice(0, currentIndex)`. If the component test environment cannot render the provider without broad mocks, keep this behavior covered through the repository test and a pure selector test.

- [ ] **Step 2: Implement loading and refresh behavior**

  Load persisted recent history when the drawer’s history tab is opened or the active user changes. Keep a small local fallback from the player history only while the persisted request is unavailable. Remove the direct `queue.slice(0, currentIndex)` rendering path.

- [ ] **Step 3: Run focused tests and typecheck**

  Run: `npm.cmd test -- lib/__tests__/listeningHistory.test.ts --run` and `npx.cmd tsc --noEmit`.

- [ ] **Step 4: Commit**

  Run: `git add components/player/QueueDrawer.tsx; git commit -m "fix: load queue drawer recently played from history"`

### Task 4: Harden history writes and verify the complete change

**Files:**
- Modify: `components/player/PlayerContext.tsx`
- Modify: `app/api/listen-events/route.ts` only if verification confirms its user identity behavior affects the feature.

- [ ] **Step 1: Add a failing test for write validation**

  Test the extracted history-write helper or the smallest testable unit: no insert occurs without a valid user/track ID, external tracks are resolved before insertion, and Supabase insert errors are surfaced to the caller/logging boundary.

- [ ] **Step 2: Implement the minimal write hardening**

  Preserve external-track resolution, but await the insert result, check `error`, and log the track/user context safely. Do not claim a history write succeeded when it failed. Avoid changing the existing playback engine timing unless a test demonstrates that the write must wait for confirmed playback.

- [ ] **Step 3: Run the full verification suite**

  Run: `npm.cmd test -- --run`, `npx.cmd tsc --noEmit`, and `npx.cmd eslint "app/(app)/history/page.tsx" "app/(app)/page.tsx" "components/player/QueueDrawer.tsx" "components/player/PlayerContext.tsx" "lib/listeningHistory.ts"`.

- [ ] **Step 4: Review the diff and report any unrelated failures**

  Run: `git diff --check` and `git status --short`. Separate failures caused by external network-dependent lyrics tests or pre-existing lint violations from failures introduced by this change.

