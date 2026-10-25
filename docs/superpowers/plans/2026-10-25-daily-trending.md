# Daily Trending and Hot Songs

**Goal:** Refresh the homepage's combined Trending & Hot Songs daily using current charts, without returning to repeated multi-artist API fan-out.

**Daily boundary:** 00:00 in Vietnam (UTC+07:00). An open page refreshes at the boundary; a resumed tab checks the date. Server data refreshes on the first request of the new day, with shared successful results and concurrent-request deduplication. No new scheduled service or database migration.

## Tasks

- [x] Shared day helpers: calendar key, next midnight and remaining cache lifetime. Test UTC/Vietnam boundary, month/year rollover and exact midnight.
- [x] Chart source: use the existing Spotify playlist transport against official regional Top 50 playlists (Global, Vietnam, USA, South Korea, Taiwan, Japan). Verify IDs against official Spotify pages. Allow fresh requests for this daily path without changing normal playlist import caching. Keep NCT chart for Vietnam/global and Deezer charts as a bounded fallback, removing fixed-artist trending generation.
- [x] Daily backend: introduce a tested service with injected chart ports/clock, daily success cache and in-flight dedup. No permanently cached empty/error response; retain last usable snapshot with truthful stale metadata on temporary failure. Reuse in `/api/search?trending=true` and legacy `/api/trending`; cache headers cannot extend beyond the current day.
- [x] Client/UI: include the Vietnam date in trending request/cache keys and metadata; make one refresh at day rollover and on focus/visibility return after a date change. Expire category results by date. Show the snapshot update date, with fallback/stale state accurately represented. Keep regular search contracts and request budgets unchanged.
- [x] Verify focused regressions, offline suite, TypeScript/lint and independent review. Preserve other workspace changes and avoid restoring retired Audius/iTunes integrations.

## Shared interfaces

Root supplies `lib/trendingDay.ts` with `getTrendingDay(now?: number): string`, `getNextTrendingRefreshAt(now?: number): number`, and `getTrendingCacheSeconds(now?: number): number`.

The backend result is the existing supported search groups plus optional `trending` metadata: `{ date: string; updatedAt: string; nextRefreshAt: string; stale: boolean }`. Clients use the snapshot date rather than labeling a failed refresh as newly updated.

Root supplies `lib/trendingSources.ts` exporting `fetchDailySpotifyChartTracks(category: string): Promise<Track[]>`; it uses the existing playlist adapter with a fresh-fetch option. Backend/UI implementers own separate files and keep these interfaces compatible.

## Verification

- Final daily-focused checks: 8 files / 66 tests passed.
- Offline suite: 136 files / 993 tests passed; excluded three existing network-dependent suites (lyrics, supershy_check, soundcloud) because outbound requests are restricted.
- ESLint: no increased diagnostics by rule/severity against HEAD for changed existing files; new files clean.
- TypeScript: no diagnostics in Trending changes; full workspace remains blocked by five toast-method errors in concurrently edited components/player/AdminLyricsEditorModal.tsx.
- Independent review: update-date label finding fixed and re-reviewed; no remaining important findings.
- Runtime limitation: snapshots are per server process, with HTTP caching bounded by midnight. Refresh occurs on first request each day, and open tabs refresh at the daily boundary. Live upstream/browser verification was not performed in this restricted environment.
