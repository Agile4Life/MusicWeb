# Genre & Region-Aware Queue Recommendation Algorithm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-signal Genre & Region classification engine, enforce strict region/genre compatibility and style-first scoring in Auto-Queue (`buildNextQueue` & `getSmartRecommendedTracks`), and make queue transitions in `queueController`, `TrackList`, `HomePage`, and `HistoryPage` style-coherent.

**Architecture:** Extract a dedicated `lib/trackClassifier.ts` module with a curated 200+ artist knowledge dictionary (`vn`, `kr`, `jp`, `cn`, `us`, `global`), Unicode/linguistic token detection, a 6-genre taxonomy (`ballad`, `indie`, `rnb`, `rap`, `pop`, `remix`), and a compatibility matrix (`getGenreCompatibility`, `isTrackStyleCompatible`, `buildStyleCoherentQueue`). Wire `lib/smartRecommend.ts`, `lib/queueRecommend.ts`, `lib/playback/queueController.ts`, and mixed-list UI entry points (`TrackList.tsx`, `app/(app)/page.tsx`, `app/(app)/history/page.tsx`) to filter and rank tracks by region and genre compatibility.

**Tech Stack:** TypeScript, Next.js App Router, Vitest

## Global Constraints

- Explicit Playlists (`/playlist/[id]`) and Albums (`/album/[id]`) must preserve their original track order.
- Incompatible genres (`compat < 0.45`, e.g. `ballad` vs `remix`/`rap`) and mismatched regions (e.g. `vn` vs `us`/`kr`/`jp`/`cn`) must be strictly filtered out when building style-coherent queues and auto-recommendations.
- Existing unit tests in `lib/__tests__/queueRecommend.test.ts`, `lib/playback/__tests__/queueController.test.ts`, and `components/player/__tests__/searchQueueIsolation.test.ts` must remain green.

---

### Task 1: Multi-Signal Track Classifier & Genre/Region Compatibility Matrix (`lib/trackClassifier.ts` & `lib/smartRecommend.ts`)

**Files:**
- Create: `lib/trackClassifier.ts`
- Modify: `lib/smartRecommend.ts`
- Test: `lib/__tests__/trackClassifier.test.ts`

**Interfaces:**
- Produces:
  - `TrackRegion = 'vn' | 'kr' | 'jp' | 'cn' | 'us' | 'global'`
  - `TrackGenre = 'ballad' | 'indie' | 'rnb' | 'rap' | 'pop' | 'remix'`
  - `TrackStyleProfile`
  - `classifyTrack(track: Partial<Track> & { title?: string; artist?: string | null; source?: string }): TrackStyleProfile`
  - `getGenreCompatibility(seedGenre: TrackGenre, candidateGenre: TrackGenre, seedSubGenres?: TrackGenre[], candidateSubGenres?: TrackGenre[]): number`
  - `getStyleCompatibilityScore(seed: TrackStyleProfile | Partial<Track>, candidate: TrackStyleProfile | Partial<Track>): number`
  - `isTrackStyleCompatible(seed: TrackStyleProfile | Partial<Track>, candidate: TrackStyleProfile | Partial<Track>, options?: { allowLowConfidenceRegion?: boolean }): boolean`
  - `buildStyleCoherentQueue(seedTrack: Track, pool: Track[]): Track[]`

- [ ] **Step 1: Write the failing test in `lib/__tests__/trackClassifier.test.ts`**
- [ ] **Step 2: Run test to verify it fails (`npx vitest run lib/__tests__/trackClassifier.test.ts`)**
- [ ] **Step 3: Implement `lib/trackClassifier.ts` and update `lib/smartRecommend.ts`**
- [ ] **Step 4: Run test to verify it passes (`npx vitest run lib/__tests__/trackClassifier.test.ts`)**

---

### Task 2: Auto-Queue Engine Upgrade with Region/Genre Gate & Style-First Scoring (`lib/queueRecommend.ts`)

**Files:**
- Modify: `lib/queueRecommend.ts`
- Modify: `lib/youtube.ts` (update `GENRE_ALLOWED_KEYWORDS` to include `'rnb'`)
- Test: `lib/__tests__/queueRecommend.test.ts`

**Interfaces:**
- Consumes: `classifyTrack`, `getStyleCompatibilityScore`, `isTrackStyleCompatible` from `lib/trackClassifier.ts`
- Produces: Updated `buildNextQueue` and `getInternalCollaborativeCandidates` in `lib/queueRecommend.ts`

- [ ] **Step 1: Add failing tests for region/genre filtering and style-first scoring in `lib/__tests__/queueRecommend.test.ts`**
- [ ] **Step 2: Run test to verify it fails (`npx vitest run lib/__tests__/queueRecommend.test.ts`)**
- [ ] **Step 3: Update `lib/queueRecommend.ts` and `lib/youtube.ts`**
- [ ] **Step 4: Run test to verify it passes (`npx vitest run lib/__tests__/queueRecommend.test.ts`)**

---

### Task 3: Context-Aware Queue Controller & UI Mixed Lists (`lib/playback/queueController.ts`, `components/track/TrackList.tsx`, `app/(app)/page.tsx`, `app/(app)/history/page.tsx`)

**Files:**
- Modify: `lib/playback/queueController.ts`
- Modify: `components/track/TrackList.tsx`
- Modify: `app/(app)/page.tsx`
- Modify: `app/(app)/history/page.tsx`
- Test: `lib/playback/__tests__/queueController.test.ts`

**Interfaces:**
- Consumes: `isTrackStyleCompatible`, `buildStyleCoherentQueue` from `lib/trackClassifier.ts`
- Produces: Style-pruned `prepareSearchTrack`, style-aware shuffle in `selectNext`, and style-coherent queue initialization on mixed lists.

- [ ] **Step 1: Add failing tests in `lib/playback/__tests__/queueController.test.ts` for search queue pruning on style change and style-aware shuffle**
- [ ] **Step 2: Run test to verify it fails (`npx vitest run lib/playback/__tests__/queueController.test.ts`)**
- [ ] **Step 3: Update `lib/playback/queueController.ts`, `components/track/TrackList.tsx`, `app/(app)/page.tsx`, and `app/(app)/history/page.tsx`**
- [ ] **Step 4: Run full test suite and update `graphify update .`**

