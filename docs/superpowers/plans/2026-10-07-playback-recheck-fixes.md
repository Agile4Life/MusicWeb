# Playback reliability fixes after pull

Baseline: `825184a`. Rechecked against the earlier audit at `ca59264`.
Queue synchronization, URL TTL reads and batch prewarming are already fixed.
Preserve those changes and existing user files. Commit independent groups after
focused regression tests and review; do not deploy services or change secrets.

## 1. Stream resolution and cache ownership

- Files: `lib/catalogResolutionRace.ts`, `lib/resolveStreamClient.ts`,
  `app/api/resolve-stream/route.ts`, `app/api/nhaccuatui/stream/route.ts`, tests.
- Add failing deferred-promise tests for ready YouTube behind pending SoundCloud,
  late NCT selection/promotion, and invalidation while old requests are running.
- Race unresolved valid candidates after the preference window. Prefer already
  available SoundCloud; promote NCT only after a fallback actually wins.
- Fence asynchronous cache writes and pending-request cleanup by generation.
  Await Supabase builders correctly. Surface upstream stream errors to readers.
- Verify focused tests; commit `fix: guard stream resolution and cache races`.

## 2. Mobile lyrics and retryable lyrics caching

- Files: `components/player/MobileFullviewPlayer.tsx`, `lib/lyricsFlow.ts`, tests.
- Add regression tests for pending A -> cached B -> A completion and transient
  provider misses followed by retry. Invalidate requests before cache branches
  and on cleanup, including romaji. Include lookup metadata in cache identity.
- Remove confirmed unused mobile state without changing gesture behavior.
- Verify focused tests; commit `fix: prevent stale mobile lyrics and retry misses`.

## 3. Matching, source identity and persistence

- Files: NCT/YouTube matching, SoundCloud catalog matching, player source-switch
  helper, `lib/playbackPersistence.ts`, relevant tests.
- Add regressions for artist mismatch, Heartbeat title, different URL origins,
  and oversized playback storage. Use artist evidence for ambiguous matches,
  tokenize negative markers, compare URL origins, trim the payload being saved.
- Verify focused tests; commit `fix: validate playback sources and storage limits`.

## 4. Playback ownership and user intent

- Files: `components/player/PlayerContext.tsx`, playback helpers and tests.
- Exercise production callbacks for stale play completion/fallback, pause during
  resolution/recovery, pending resume after OS pause, seek crossing tracks,
  repeated single-track completion, paused foreground near EOF, gain attenuation.
- Guard every asynchronous mutation by request/track ownership. Honor Pause in
  retries and pending resumes. Clear per-track seek and per-loop completion state.
  Apply volume through one effective attenuation stage when Web Audio is active.
- Remove confirmed unused player imports and unreachable fallback bookkeeping.
- Verify focused tests; commit `fix: preserve playback ownership and pause intent`.

## 5. Integration verification

- Review all changes, run full deterministic tests, lint and TypeScript checks.
- Separate pre-existing failures and external-network limitations from regressions.
- Update the audit with current status and exact verification evidence. Commit
  final documentation separately. Preserve user e2e/artifact changes.

## Execution result

Completed all five groups on `fix/playback-reliability-recheck`.
Code commits: `cf18bfe`, `5dd9fb2`, `7ab01a8`, `aca4194`.
Final deterministic verification: 87 files / 521 tests pass; source TypeScript
check passes. Repository lint and generated Next dev types have pre-existing
errors; network-dependent suites cannot access external providers in the sandbox.
Independent review completed and additional regression findings were addressed.

Server cache ordering remains process-local. Distributed L2 coordination needs a
database version/conditional write in a separate change. Physical mobile/browser
audio session validation was not performed. See
`docs/reviews/2026-10-07-playback-flow-audit.md` for current findings and evidence.
