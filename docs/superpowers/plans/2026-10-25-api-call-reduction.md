# External API Call Reduction Implementation Plan

**Goal:** Remove redundant upstream work in search, lyrics, home albums and auto-queue without removing a provider needed for playback.

**Architecture:** Keep the existing endpoint contracts. Deduplicate shared credential/artist requests and make enrichment conditional on missing usable results. Evaluate queue capacity after compatibility, history, skip and artist-diversity filtering.

**Tech stack:** Next.js 16.2.12 route handlers, TypeScript, Vitest.

**Constraints:** Follow installed Next.js route-handler/fetch guides. Preserve existing uncommitted Spotify Lab changes. Do not change Supabase queries, auth, database schema, streaming transport or provider priority.

- [x] Search: Add route tests for Spotify/Deezer single-source requests and explicit YouTube requests. Reproduce the unwanted YouTube call, then restrict YouTube search to `all`/`playback`/`youtube`. Check the response shape and all-source search remain intact.
- [x] Playback recovery: Add a `playback` search mode containing NCT, YouTube and SoundCloud only. Use it in the three player recovery paths that consume only these providers. Verify stream selection and fallback order remain intact and catalog/local providers are never called for recovery.
- [x] Lyrics: Change the synced-NCT regression assertion to require zero LRCLIB calls; retain plain/missing-NCT fallback cases. Resolve NCT first when an ID exists and call LRCLIB only if NCT has no synced lyrics.
- [x] Spotify: Add concurrent token success/failure and subsequent-retry tests using deferred HTTP responses. Share one in-flight token request and clear it on completion; preserve successful token expiry handling.
- [x] Deezer: Add concurrent radio/related lookup and failed-lookup recovery tests. Share in-flight artist searches by cleaned, case-insensitive query; retain strict artist identity matching and Next fetch caching.
- [x] Albums: Add a route regression using the real Deezer adapter with a full 50-album chart. Request 50 Deezer candidates for the mixed 60-album feed so four extra artist searches are unnecessary; retain supplement behavior when the chart is short.
- [x] Queue: Add orchestration tests for sufficient primary results, diversity shortfall, history exclusions and provider failures. Fetch native seed searches, Deezer radio and personalization first; request peer/related/topic candidates only when the filtered diverse queue is short. Keep Spotify fallback for a remaining shortfall.
- [x] Verify: Run focused regressions, existing recommendation/playback/lyrics tests, TypeScript and changed-file lint. Review the final diff independently, resolve findings, and write an audit with measured test scenarios and remaining tradeoffs. Results and network limits: `docs/api-call-audit-2026-10-25.md`.
