# IoC P00 baseline

Date: 2026-10-15 (Asia/Bangkok). Branch: `refactor/ioc-p00-p03`.
Source baseline: `cc5b3d3` (SoundCloud/player fallback changes already committed).
Working tree at baseline: only the ten untracked IoC design/plan documents;
no uncommitted production changes. The earlier plan survey used `c1dfc92`;
implementation preserves the newer source, including null YouTube streamUrl.

## Executed checks

Commands run from `D:/MusicWeb`; use `npm.cmd`/`npx.cmd` because PowerShell's
execution policy blocks the installed npm.ps1 shim. No execution policy changed.

| Check | Actual result |
|---|---|
| Resolver priority/client ownership/server ownership/distributed tests, `npm.cmd test -- lib/__tests__/catalogResolutionRace.test.ts lib/__tests__/resolveStreamCacheOwnership.test.ts app/api/resolve-stream/__tests__/cacheOwnership.test.ts app/api/resolve-stream/__tests__/distributedCache.test.ts --maxWorkers=2` | Exit 0; 4 files, 33 tests pass; 1.05s |
| Player tests and race/decision/queue/prewarm helpers, `npm.cmd test -- components/player/__tests__ lib/__tests__/playbackRaceGuards.test.ts lib/__tests__/playbackDecisions.test.ts lib/__tests__/queueSync.test.ts lib/__tests__/prewarmPlan.test.ts --maxWorkers=2` | Exit 0; 29 files, 170 tests pass; 6.39s |
| `npm.cmd run test:playback-db` | Exit 0; 1 file, 48 tests pass; 3.56s; embedded PGlite only |
| `npx.cmd tsc --noEmit --incremental false` | Exit 1; baseline diagnostics below |
| `npx.cmd playwright test --config playback_reliability.config.ts` | Exit 1; interrupted after repeated baseline failures; see browser ledger below |

Vitest emits an existing Vite warning about CommonJS config and future native
config loading. Playwright server emits the existing FORCE_COLOR/NO_COLOR warning.
Neither warning is suppressed or attributed to this refactor.

## Failure ledger

1. `app/api/resolve-stream/route.ts`: two TS2304 diagnostics for
   `verifySoundCloudTrackPlayable`. `cc5b3d3` introduced an unbound identifier in
   shared-cache revalidation. `typeof` currently skips that intended validation.
   P01 must use an explicit injected validator and a regression test; record this
   necessary correction separately from mechanical extraction.
2. `worker/__tests__/nctStreamWorker.test.ts:2`: TS2578 unused `@ts-expect-error`.
   Outside P00–P03 scope. Do not remove it to hide the baseline; report it in final
   typecheck results if it remains.

## Contracts frozen for extraction

- Drive before external sources; NCT grace window 2200ms, SoundCloud then YouTube
  fallback order via existing catalogResolutionRace.
- Server L1 hit/miss TTL 600000/60000ms, maximum 2000 entries; decimal shared
  generation protocol and per-key publication ordering retained.
- Client hit/miss TTL 300000/60000ms, maximum 300 entries, persisted resolution
  hit TTL 1800000ms. Keep current key formats and alias invalidation helpers.
- YouTube network response has null streamUrl; URL-builder facade still supports
  `/api/yt-stream`. Preserve the distinction.
- Player persistence cadence 15000ms, maximum queue window 150, state key
  `musicweb_player_state`, repeat key `musicweb_repeat_mode`.
- Request/owner checks, native synchronous quick-play, pause intent, media session,
  prewarm throttling and completion behavior remain protected by the existing suite.

## Network and device limits

The full deterministic run excludes `lib/__tests__/lyrics.test.ts` and
`lib/__tests__/supershy_check.test.ts`, which invoke live lyrics/catalog providers.
`lib/__tests__/soundcloud.test.ts` contains deterministic helper tests plus three
ungated live track/playlist URL tests at the end, so exclude that whole file from
a broad offline run (or select only its helper tests explicitly).
P00 ran the explicit deterministic test paths above, not the entire repository.

Reliability config uses local fixtures, one worker and blocked service workers.
It requests Chromium desktop/mobile and conditionally WebKit mobile when installed.
These checks do not prove real iPhone background behavior, service-worker keepalive,
or live provider availability. No live DB, deployment or migration was performed.

## Browser failure ledger and P00 handoff

18 cases discovered across Chromium desktop/mobile and WebKit mobile. Desktop
finished with 4 pass, 1 failure, 1 scope skip. The first case failed before
playback: `input.search-input:visible` missing in setup (12000ms locator timeout).
The first two mobile cases each reached the 90000ms test timeout. The run was
interrupted rather than repeat the same setup problem for every project. Thus
8 cases completed (4 pass/3 fail/1 skip), 10 did not complete; WebKit did not
execute. This is **not** a passing browser baseline. Artifacts remain local at
`scratch/playback-browser/latest/results/`. No production code changed during
this run. P05/P07 must investigate this browser fixture limitation before claiming
browser verification; it does not prevent isolated P01?P03 factory tests.

P00 inventory is complete with failures/limits recorded. The fixture helper
passes targeted ESLint. The test map distinguishes production behavior, VM,
static checks, export checks and simulations, including generated cases. Source
files were clean at capture; P01/P02/P03 may proceed independently.
