# Playback remaining limitations implementation plan

Baseline: 7237692 on fix/playback-reliability-recheck. User authorized continuing
remaining work and local commits. Preserve user changes in test-results and
tests/e2e/search_flow.spec.ts. Never alter a live DB as part of local verification.

## Status updated 2026-10-11

- [x] Sections 1–2: shared SQL/helper/route protocol committed in `f857515`;
  PostgreSQL and two-instance production route regression tests included.
- [x] Clean production build: default Turbopack, TypeScript enabled, exit 0,
  58 static pages; isolated snapshot and fixture environment only.
- [x] Independent review of browser fixture/config/probe; fix guaranteed server
  cleanup for WebKit launch/close failures with failure reproduction.
- [x] Section 3: all three browser projects, 14 pass/4 capability or scope skips,
  exit 0; committed as `fbb5f13`.
- [x] Section 4: fresh 89-file/579-test deterministic run, 48-test SQL script,
  final evidence and rollout documentation prepared in this documentation change.

Supabase migration, hosting deployment/configuration, provider smoke tests and
physical-device checks remain rollout steps. No live mutation is authorized by
this verification plan. User explicitly defers iOS bug fixes; the separate
`2026-10-07-ios-background-playback-audit.md` remains open and is not a completed fix.

## 1. Shared cache version protocol

Files: supabase/migrations/202610070001_stream_resolution_coordination.sql,
lib/serverStreamResolutionCache.ts, lib/__tests__/serverStreamResolutionCache.test.ts.

- Add failing PostgreSQL tests for A token 0 -> B invalidation token 1 -> old A
  publish rejected, stale late NCT rejected, missed result cannot replace a hit,
  a same-generation fallback cannot downgrade a preferred source, TTL expiry,
  repeated invalidation, RPC privileges and rerunnable migration.
- Create a separate coordinated cache table, preserving legacy stream_resolutions.
  Read/invalidate RPC returns an opaque decimal generation string and optional
  unexpired resolution. Publication locks the same row and compares generation.
  Invalidation increments generation and clears payload in one transaction.
- Keep RPCs service_role-only. Keep generation rows after payload expiry to prevent
  version reuse. Do not backfill potentially stale legacy cache results.
- Execute migration/functions against embedded PostgreSQL with PGlite, not just
  a mocked representation of SQL. PGlite validates SQL semantics; separate route
  instances exercise shared storage integration.

## 2. Route integration and multiple-instance regression

Files: app/api/resolve-stream/route.ts and its tests.

- Add failing tests loading two isolated production route modules against shared
  RPC storage. Warm L1 on B, invalidate on A, require B to observe current version.
- Validate shared generation before L1/in-flight reuse. Write through conditional
  RPC; keep process-local guards and cleanup for fallback operation.
- Missing RPCs/credentials or database failure must bypass coordinated cache and
  disable legacy L2 writes, while allowing direct fresh source resolution.
- Preserve public response shape, no-store, NCT priority race, Drive fast source,
  and ordered initial-winner/late-preferred publication.
- Run focused unit/database integration tests, lint and source TypeScript checks,
  review, commit shared protocol and route together.

## 3. Actual browser playback verification

Files: next.config.ts (optional environment distDir), a dedicated Playwright
config and new tests/fixtures, outputs only under ignored scratch.

- Run own local server port 3002 and scratch distDir, preserving existing .next.
- Mount actual app in Chromium desktop/mobile emulation with intercepted local
  APIs and valid generated audio. Exercise rapid switching, pause while loading,
  repeats, gain volume and mobile lyrics. Capture actual MediaSession callbacks
  where supported. Report WebKit availability separately.
- Fix only reproduced playback defects with regression evidence. Review and
  commit browser regression work separately.
- Browser/mobile emulation does not verify actual iOS lock screen/audio sessions;
  produce a specific physical-device procedure and leave its result unclaimed.

## 4. Verification and rollout documentation

- Run deterministic full tests and actual browser suites. Classify existing lint,
  generated type and external-network failures.
- Document the exact additive migration, required service-role server credential,
  safe fallback before migration, and deployment order. Do not expose secrets.
- Record tested environments and outstanding physical device/deployment steps.
- Commit documentation separately. Keep the branch local unless asked to push.
