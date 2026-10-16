# IoC P07 Integration Verification Report

Date: 2026-10-15 (Asia/Bangkok)
Branch: `refactor/ioc-p04-p07` (worktree `d:/MusicWeb/.worktrees/ioc-p04-p07`)
Base commit: `212d3af` (`docs(ioc): capture P00 baseline and staged refactor plans`)

---

## 1. Observable Summary & Scope Status

- **Public behavior preserved**:
  - Public React hooks (`usePlayer`, `usePlayerControls`, `usePlayerTrack`, `usePlayerQueue`, `usePlaybackProgress`), `PlayerContext.tsx` re-exports (`isBackgroundPlayableTrack`, `isFullYouTubeQueue`, `inferTrackSource`, `MAX_CONSECUTIVE_SKIPS`, `AUDIO_STALL_WATCHDOG_TIMEOUT_MS`), `/api/resolve-stream` HTTP contract, `lib/resolveStreamClient.ts` facade functions, localStorage keys (`musicweb_player_state`, `musicweb_repeat_mode`, `stream_resolution_v1:*`, `yt_id_cache_v1:*`), and Search/Playlist context shapes remain backward-compatible.
- **Direct behavioral testing**:
  - All former AST/VM extraction suites (`playbackOwnership.test.ts`, `backgroundCompletion.test.ts`) and local simulation/regex suites (`playbackInvariants.test.ts`, `controlsContextStability.test.ts`, `searchQueueIsolation.test.ts`, `mediaSession.test.ts`, `nctPlaybackRaceGuards.test.ts`, `playerSafetyGuards.test.ts`, `playerPrewarmThrottling.test.ts`) now run directly against the real IoC production modules (`createPlaybackController`, `createPlaybackSourceService`, `createPlayerViewStore`, `bindBrowserLifecycle`, `bindMediaSession`, `bindYouTubeIframe`, `createBrowserTransport`, `PlaybackPersistenceScheduler`, `createWebAudioGainManager`).
  - `components/player/__tests__/helpers/productionCallbacks.cjs` has been deleted.
- **Explicit dependencies & lifecycle**:
  - Server stream resolution (`createServerResolutionService`, `createCatalogResolver`, `createSupabaseSharedCachePort`) is wired once per process in `lib/stream-resolution/server/composition.ts`.
  - Client stream resolution (`createClientResolutionService`) is wired via `lib/stream-resolution/client/composition.ts` behind the `lib/resolveStreamClient.ts` facade.
  - Playback core (`lib/playback/**`) has zero React, Next.js, Supabase, or DOM globals; browser lifecycle, Media Session, YouTube IFrame, Web Audio gain, and React `useSyncExternalStore` bindings live in `components/player/runtime/**` and `components/player/usePlayerRuntime.ts`.

### Completed Parts
- **P00**: Baseline and test coverage map (`212d3af`).
- **P01**: Server stream resolution IoC (`lib/stream-resolution/server/**`, `app/api/resolve-stream/route.ts`).
- **P02**: Client stream resolution IoC (`lib/stream-resolution/client/**`, `lib/resolveStreamClient.ts`).
- **P03**: Browser playback ports & adapters (`lib/playback/ports.ts`, `components/player/adapters/**`, `components/player/engines/**`).
- **P04**: Pure playback core (`lib/playback/**`, `components/player/adapters/browserSourceDependencies.ts`).
- **P05**: React/browser integration & behavioral test migration (`components/player/PlayerContext.tsx`, `usePlayerRuntime.ts`, `playerViewStore.ts`, `components/player/runtime/**`, `components/player/__tests__/**`).
- **P06**: Search & Playlist IoC (`lib/search/**`, `lib/playlist/**`, `components/search/**`, `components/playlist/**`).
- **P07**: Integration verification (`docs/reviews/2026-10-15-ioc-verification.md`, updated `docs/reviews/2026-10-15-ioc-test-map.md` and `docs/superpowers/plans/2026-10-15-ioc-refactor.md`).

---

## 2. Architecture & Dependency Boundary Audit (Task 1)

### Boundary Check 1: Pure Core Modules (`lib/playback`, `lib/stream-resolution`)
Command:
```powershell
git grep -n -E "next/server|@supabase|useEffect|useState|window\.|document\.|navigator\.|localStorage|globalThis.fetch" -- lib/playback lib/stream-resolution
```
Actual hits (all accounted for in composition/adapter/type/comment files; zero hits in `lib/playback/**`):
- `lib/stream-resolution/client/__tests__/clientResolutionService.test.ts:7`: `vi.fn<typeof globalThis.fetch>` (type annotation in test).
- `lib/stream-resolution/client/clientResolutionService.ts:91,158`: comments referencing `localStorage` (actual access uses injected `storage: StoragePort`).
- `lib/stream-resolution/client/composition.ts:12`: composition root binding `globalThis.fetch`.
- `lib/stream-resolution/client/contracts.ts:21`: type annotation `fetch: typeof globalThis.fetch`.
- `lib/stream-resolution/server/composition.ts:1`: server composition root importing `createClient` from `@supabase/supabase-js`.
- `lib/stream-resolution/server/providers/drive.ts:1` & `lib/stream-resolution/server/sharedCacheAdapter.ts:1`: `import type { SupabaseClient } from '@supabase/supabase-js'` (type-only imports in server adapter/provider).

### Boundary Check 2: Thin `PlayerContext.tsx`
Command:
```powershell
git grep -n -E "new Html5AudioEngine|new YouTubeIframeEngine|createClient|fetch\(" -- components/player/PlayerContext.tsx
```
Actual result: **0 matches** (`PlayerContext.tsx` is a 134-line React context wiring component).

### Boundary Check 3: AST/VM Helper Removal
Command:
```powershell
git grep -n -E "productionCallbacks|readFileSync|createSourceFile|runInContext" -- components/player/__tests__ lib/playback
```
Actual result:
- **0 matches** for `productionCallbacks`.
- **0 matches** in `lib/playback` or any P04/P05 playback controller/ownership/invariants/completion test.
- Remaining `readFileSync` hits are only in untouched UI/worker tests outside P04/P05 controller scope: `backgroundCompletionWorker.test.ts` (loads `public/backgroundCompletionWorker.js` into `runInNewContext`), `mobileLyricsOwnership.test.ts` (`MobileFullviewPlayer.tsx`), and `playerBarInteraction.test.ts` (`PlayerBar.tsx`).

### Git Whitespace & Diff Hygiene
Command:
```powershell
git diff --check 212d3af..HEAD
```
Actual result: **Exit 0 (0 whitespace/conflict issues)**.

### Spec Invariant Mapping (10 Invariants)
1. **Request/track ownership token (`generation`, `requestId`, `trackId`)**: Tested in `components/player/__tests__/playbackOwnership.test.ts` (26 tests) and `lib/playback/__tests__/playbackController.test.ts`.
2. **Synchronous quick-play in background/iOS**: Tested in `playbackOwnership.test.ts` (`synchronously quick-plays pre-resolved tracks in background/iOS...`) and `lib/playback/__tests__/playbackController.test.ts`.
3. **Desired play state / pause intent preservation across async resolution & OS events**: Tested in `playbackOwnership.test.ts`, `mediaSession.test.ts`, and `playerSafetyGuards.test.ts`.
4. **NCT 4000ms retry & single-fallback mutex (`inFlightFallbackRequestId`)**: Tested in `nctPlaybackRaceGuards.test.ts` and `playbackOwnership.test.ts`.
5. **Consecutive error circuit breaker (`MAX_CONSECUTIVE_SKIPS = 4`) & 6500ms stall watchdog**: Tested in `playerSafetyGuards.test.ts` and `lib/playback/__tests__/recoveryPolicy.test.ts`.
6. **Duplicate EOF completion suppression & hidden-tab worker completion**: Tested in `backgroundCompletion.test.ts` (13 tests) and `lib/playback/__tests__/completionCoordinator.test.ts`.
7. **Queue single source of truth, >150 item windowing, search queue isolation, and AbortSignal smart-fill supersession**: Tested in `playbackInvariants.test.ts`, `searchQueueIsolation.test.ts`, `playerSafetyGuards.test.ts`, and `lib/playback/__tests__/queueController.test.ts`.
8. **Stable `usePlayerControls` reference & progress decoupling (`useSyncExternalStore`)**: Tested in `controlsContextStability.test.ts` (14 tests), `playerProgressDecoupling.test.ts`, and `components/player/runtime/__tests__/playerViewStore.test.ts`.
9. **Client & server stream resolution generation ownership, SoundCloud L2 revalidation, and 3/4-part YouTube alias invalidation**: Tested in `lib/__tests__/resolveStreamCacheOwnership.test.ts`, `app/api/resolve-stream/__tests__/cacheOwnership.test.ts`, `app/api/resolve-stream/__tests__/distributedCache.test.ts`, `lib/stream-resolution/client/__tests__/clientResolutionService.test.ts`, and `lib/stream-resolution/server/__tests__/serverResolutionService.test.ts`.
10. **Symmetric browser listener/timer/worker/MediaSession/YouTube cleanup on unmount**: Tested in `components/player/runtime/__tests__/runtimeLifecycle.test.ts` and `components/player/runtime/__tests__/mediaSessionBinding.test.ts`.

---

## 3. Deterministic Test, Database Protocol, TypeScript & Lint Ledger (Task 2)

| Check | Command | Exit Code | Result |
|---|---|---|---|
| Targeted IoC + Legacy Player/Resolver/Search/Playlist Suite | `npx vitest run lib/playback lib/stream-resolution components/player/__tests__ components/player/adapters components/player/runtime app/api/resolve-stream/__tests__ lib/search lib/playlist components/search/__tests__ lib/__tests__/resolveStreamCacheOwnership.test.ts lib/__tests__/catalogStreamResolution.test.ts lib/__tests__/catalogResolutionRace.test.ts lib/__tests__/playbackPersistence.test.ts lib/__tests__/audioUrlCache.test.ts lib/__tests__/playbackMatchingReliability.test.ts lib/__tests__/queueSync.test.ts lib/__tests__/prewarmPlan.test.ts` | `0` | **54/54 files passed (335/335 tests)** |
| Embedded PGlite SQL Shared Cache Protocol | `npm run test:playback-db` | `0` | **1/1 file passed (48/48 tests)** |
| Full Offline Deterministic Repository Suite (excluding 3 live-network files per P00: `lyrics.test.ts`, `supershy_check.test.ts`, `soundcloud.test.ts`) | `npx vitest run --exclude lib/__tests__/lyrics.test.ts --exclude lib/__tests__/supershy_check.test.ts --exclude lib/__tests__/soundcloud.test.ts` | `0` | **112/112 files passed (744/744 tests)** |
| ESLint on all IoC added/modified files (P01–P06) | `npx eslint app/api/resolve-stream lib/stream-resolution lib/resolveStreamClient.ts lib/playback lib/search lib/playlist components/player/PlayerContext.tsx components/player/usePlayerRuntime.ts components/player/playerViewStore.ts components/player/playerContextTypes.ts components/player/PlaybackProgressStore.ts components/player/runtime components/player/adapters components/player/engines components/player/playbackPersistenceScheduler.ts components/search/SearchContext.tsx components/search/searchComposition.ts components/search/__tests__ components/playlist/PlaylistContext.tsx components/playlist/playlistComposition.ts` | `0` | **0 errors, 0 warnings** |
| TypeScript (`tsc --noEmit --incremental false`) | `npx tsc --noEmit --incremental false` | `1` (baseline only) | **0 errors in P01–P06 files**; P00 `app/api/resolve-stream/route.ts` TS2304 errors and `YouTubeIframeEngine.ts:68` TS2722 resolved; only pre-existing P00 baseline `worker/__tests__/nctStreamWorker.test.ts(2,1): error TS2578` remains untouched per P00 instructions |
| Browser Playwright E2E (`playback_reliability.config.ts`) | `npx playwright test --config playback_reliability.config.ts` | `0` | **14 passed, 4 skipped, 0 failed** (`chromium-desktop`: 5 passed / 1 skipped; `chromium-mobile`: 5 passed / 1 skipped; `webkit-mobile`: 4 passed / 2 skipped) |

### Post-Review Regression Fixes (2026-10-16)
1. **P1 (`lib/playback/playbackController.ts`)**: Restored ownership-aware transport transition before async resolution (`deps.transport.stop()` unless preserving a hidden-tab HTML5 audio session) and checked `activeTransportOwner` in `runFallbackToYouTube` so a previously playing track cannot block fallback when an unresolved track resolves `null`.
2. **P1 (`components/player/runtime/youtubeBinding.ts`, `components/player/engines/YouTubeIframeEngine.ts`)**: Tied cold-start `pendingCall` to active `PlaybackOwner` and invalidated it on `pause()` / `stop()` or owner/video mismatch before executing `onReady`.
3. **P1 (`components/player/engines/YouTubeIframeEngine.ts:68`)**: Guarded optional `this.player.unMute?.()` and `this.player.isMuted?.()` to eliminate `TS2722`.
4. **P2 (`lib/playback/playbackSourceService.ts`, `lib/playback/playbackController.ts`)**: Preserved searched YouTube fallback candidates when trying an alternate NCT candidate first, and continued to YouTube fallback if the alternate NCT stream rejects.
5. **P2 (`components/player/runtime/createPlayerRuntime.ts`)**: Stopped the mounted `<audio>` element (`transport.stop()`) before swapping `html5Engine` and `currentAudioElement` to `fallbackAudio` on detach/cleanup.
6. **P2 (`lib/playlist/playlistRepository.ts`)**: Threw `PlaylistRequestError` on non-ok HTTP responses in `list()` so `PlaylistContext` preserves previously loaded playlists during transient refresh failures (`500`/`429`).

---

## 4. Production Build, Browser & Device Limits (Task 3)

- **Next.js Production Build**:
  - Command: `$env:NEXT_DIST_DIR=".next-ioc-verify"; $env:NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"; $env:NEXT_PUBLIC_SUPABASE_ANON_KEY="test-anon-key"; $env:NEXTAUTH_SECRET="test-secret"; $env:NEXTAUTH_URL="http://127.0.0.1:3000"; npx next build --webpack`
  - Result: Webpack client/server bundle compiled cleanly (`✓ Compiled successfully in 29.3s`), confirming zero client/server module boundary violations across all IoC modules (`lib/playback/**`, `lib/stream-resolution/**`, `components/player/**`, `lib/search/**`, `lib/playlist/**`). Post-compile Next.js route validator exited with code `1` on an untouched route (`app/api/playlists/[id]/route.ts` `params: Promise<{ id: string }> | { id: string }` union signature outside IoC scope).
- **Browser Playwright (`playback_reliability.config.ts`) & Native Device Limits**:
  - `npx playwright test --config playback_reliability.config.ts` passed **14/14 active browser tests** across `chromium-desktop` (5 passed), `chromium-mobile` (5 passed), and `webkit-mobile` (4 passed), after deferring `ownedRuntime.dispose()` across React 19 Strict Mode synchronous unmount/remount cycles in `components/player/usePlayerRuntime.ts`, guarding `restoreFromPersistence()` in `components/player/runtime/createPlayerRuntime.ts`, using Turbopack in `playback_reliability.config.ts` to avoid webpack V8 heap exhaustion, and supporting touch viewports in `tests/e2e/helpers/playback_reliability.ts`.
  - Native iOS Safari background audio, hardware lock-screen Media Session, and Service Worker keepalive were **not run** on physical iOS hardware in this session; behavioral parity is verified through deterministic unit/integration harnesses and Playwright Chromium/WebKit browser fixtures.

---

## 5. Rollback & Handover Order (Task 4)

Commit order across `refactor/ioc-p00-p03` and `refactor/ioc-p04-p07`:
1. `212d3af` — **P00**: `docs(ioc): capture P00 baseline and staged refactor plans`
2. `2a40c91` — **P01**: `refactor(resolve-stream): extract server resolution service and catalog providers (P01)`
3. `7361b22` — **P02**: `refactor(resolve-stream): extract client resolution service with injectable ports (P02)`
4. `4b3b6b7` — **P03**: `refactor(player): add playback ports and browser persistence, user-effects, and transport adapters (P03)` (HEAD of `refactor/ioc-p00-p03`)
5. `f8641b1` — **P06**: `refactor(search,playlist): extract injectable search service and playlist repository (P06)`
6. `8f40fa9` — **P04**: `refactor(playback): extract pure playback core controller, source service, queue, completion, and recovery (P04)`
7. `c954778` — **P05**: `refactor(player): wire PlayerContext to IoC runtime and replace AST/VM tests with behavioral tests (P05)`
8. **P07**: Integration verification report, updated test coverage map, and master plan status (HEAD of `refactor/ioc-p04-p07`).

### Rollback Guidance
- **Client/React Player**: Revert P05 (`c954778`) before P04 (`8f40fa9`) and P03 (`4b3b6b7`) if returning `PlayerContext.tsx` to legacy in-component wiring.
- **Server/Client Stream Resolution**: P01 (`2a40c91`, `app/api/resolve-stream/route.ts`) and P02 (`7361b22`, `lib/resolveStreamClient.ts`) preserve their exact HTTP and function facades and can be rolled back independently of P06 (`f8641b1`, `SearchContext`/`PlaylistContext`).
