# Remove Audius and iTunes

**Goal:** Remove both providers from the application, including albums, metadata/trending fallbacks, active source types and search payloads.

**Constraints:** Preserve earlier API-call reductions and existing user Spotify Lab changes. Follow installed Next.js route/fetch guides. Do not delete stored user data or change database schema. Spotify/Deezer remain album providers. Retain only explicit legacy guards that prevent retired URLs/IDs from being fetched or confused with supported providers.

## Tasks and ownership

- [x] Albums: remove iTunes imports, searches, chart, lookup and resolve fallbacks from all four album API routes. Filter retired DB/cache album IDs. Reject retired album IDs before provider/DB work. Remove retired ID aliases and update album UI copy. Add meaningful route tests for no retired upstream calls, supported fallback and retired ID isolation. Owner: album implementer.
- [x] Search: remove iTunes artist trending fallback and Audius/iTunes search result groups from API, client parser, search helpers/context and owned fixtures. Explicit retired source requests fail without provider work. Preserve all supported provider modes and prior playback mode. Add regression coverage. Owner: search implementer.
- [x] Legacy tracks/player: remove both providers from active Track/source types. Normalize saved retired tracks to metadata-based resolution through supported sources, clear retired transport URLs and obsolete provider IDs, preserve native resolved IDs and saved UUIDs. Update persistence, favorites/history, prewarm and battle conversion. Owner: root.
- [x] Adapters/fixtures: delete unused `lib/audius.ts` and `lib/itunes.ts`; update remaining tests and stale fixtures to supported providers; retain preview/legacy rejection guards where needed. Owner: root.
- [x] Review fixes: migrate raw DB rows before local source fallback; distinguish metadata-only cleanup from retired-track migration; detect saved Audius custom-host transport signatures; retain already resolved local/Drive transports; resolve only visible/selected retired Battle candidates through shared supported-source cache. All findings have red/green regressions and scoped approval.
- [x] Verification: 129 offline unit files / 947 tests, TypeScript and diff checks passed; 53-file lint comparison has zero new diagnostics. Independent task/final reviews approved. Browser initial navigation timed out before assertions; test sessions stopped. Actual network-dependent tests remain excluded. Full report: `docs/api-call-audit-2026-10-25.md`.

## Shared compatibility interfaces

Root provides `lib/retiredMusicSources.ts`:

- `isRetiredMusicId(value: unknown): boolean`: recognizes `itunes`, `audius` names and `-`/`:` prefixed identifiers, including iTunes RSS IDs.
- `isRetiredMusicUrl(value: unknown): boolean`: recognizes retired transport URLs and schemes.
- `isRetiredMusicTrack(track: Track): boolean`: detects actual retired track/source/transport metadata, distinct from an obsolete album/link association on a supported track.
- `normalizeRetiredMusicTrack(track: Track): Track`: migrates legacy metadata in memory without calling retired providers or mutating input.

Album code may import `isRetiredMusicId`. Search code removes legacy response groups entirely; root updates non-search consumers/fixtures to the narrower contract.
