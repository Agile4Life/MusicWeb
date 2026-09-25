# Stream Resolution Priority Race & Anti-Race-Condition Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement parallel 3-way stream resolution (NCT, SoundCloud, YouTube concurrently at t=0) with a 1-second priority grace window for NhacCuaTui. If NCT hits within 1s, NCT wins; if NCT exceeds 1s or returns null, immediately return SoundCloud (if available) or YouTube, while promoting late NCT results to background cache. Include hover pre-resolution on TrackRow and queue batch prewarming.

**Architecture:**
1. **Parallel Priority Race Engine** (`lib/catalogResolutionRace.ts`):
   - Starts `tryNct()`, `trySoundCloud()`, `tryYoutube()` concurrently at $t = 0$.
   - Gives NCT a 1000ms preference window.
   - If NCT resolves to a valid track $\le 1000ms \to$ NCT wins immediately.
   - If NCT returns `null` or times out past 1000ms $\to$ locks resolution, selects SoundCloud if already settled/valid, otherwise YouTube.
   - Attaches background promotion callback so late NCT results (> 1000ms) populate L2 database cache for subsequent plays.
2. **Server Integration** (`app/api/resolve-stream/route.ts`):
   - Connects `resolveCatalogCandidates` with `tryNct`, `[trySoundCloud, tryYoutube]`, and writes late NCT hits to database cache.
3. **Client-Side Hover Pre-resolution** (`components/track/TrackRow.tsx`):
   - Rê chuột vào bài hát catalog (Spotify/iTunes/Deezer) kích hoạt gọi `resolveStreamCached` ngầm (150ms debounce).
4. **Queue Prewarming** (`components/player/PlayerContext.tsx`):
   - Kích hoạt `prewarmTrackBatch` cho 2-3 bài tiếp theo khi nạp queue mới hoặc bắt đầu phát.

---

### Task 1: Update `lib/catalogResolutionRace.ts` with Parallel Priority Race & Anti-Race Guards

**Files:**
- Modify: `lib/catalogResolutionRace.ts`
- Test: `lib/__tests__/catalogResolutionRace.test.ts`

- [ ] **Step 1: Update `lib/catalogResolutionRace.ts`**
  Implement parallel execution from t=0, 1000ms NCT window, prioritized fallback selection (SoundCloud then YouTube), and late-result callback.
- [ ] **Step 2: Add comprehensive unit tests in `lib/__tests__/catalogResolutionRace.test.ts`**
- [ ] **Step 3: Run unit tests to verify 100% pass**
  Run: `npx vitest run lib/__tests__/catalogResolutionRace.test.ts`
- [ ] **Step 4: Commit Task 1**

---

### Task 2: Wire Priority Race & Background Cache into `app/api/resolve-stream/route.ts`

**Files:**
- Modify: `app/api/resolve-stream/route.ts`

- [ ] **Step 1: Update route handler to pass `[trySoundCloud, tryYoutube]` and `onLatePreferredResult` callback**
- [ ] **Step 2: Run resolve stream unit/integration tests**
- [ ] **Step 3: Commit Task 2**

---

### Task 3: Client Hover Pre-resolution & Queue Prewarming

**Files:**
- Modify: `components/track/TrackRow.tsx`
- Modify: `components/player/PlayerContext.tsx`

- [ ] **Step 1: Add catalog hover pre-resolve in `TrackRow.tsx`**
- [ ] **Step 2: Hook `prewarmTrackBatch` in `PlayerContext.tsx`**
- [ ] **Step 3: Run full vitest suite**
- [ ] **Step 4: Commit Task 3**
