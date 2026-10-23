# Spotify Lab song battle implementation plan

**Goal:** Redesign /spotify-lab in the existing minimal-flat theme with preview listening, elimination battles and external playlist import.

**Architecture:** Pure tournament and playlist URL/normalization modules; a scoped CSS module and small client components for setup, battle and a single preview player. Reuse /api/spotify/search, /api/spotify/playlist, /api/youtube/playlist and /api/soundcloud/playlists with their existing response contracts. No database changes or new dependencies.

**Constraints:** Preserve public access and existing user edits. Apply minimal-flat tokens locally; do not change the user's global theme preference. Keep source identities during import. Import adds to the current game, without silently saving to the personal library. Handle duplicates, errors, no-results, request cancellation and stale responses. Playback must stop on switching, voting, undo and navigation. Next.js use-client and CSS documentation has been read locally.

- [ ] Write and run failing tests for tournament completion, invalid size, undo and stale duplicate votes; playlist URL validation, endpoint selection and normalization/deduplication.
- [ ] Implement pure modules and rerun focused Vitest tests.
- [ ] Replace the standalone page with minimal-flat setup/search/import/pool, responsive head-to-head battle, progress, undo and champion/history; retain search previews outside the game.
- [ ] Extract one preview player with typed Spotify iframe API and fallback, native preview audio and source-specific YouTube/SoundCloud embeds. Clean up pending playback on unmount.
- [ ] Validate in Playwright with controlled API responses: search, import all supported sources, dedupe, disabled start, tournament/undo/replay, switching preview and mobile overflow. Inspect screenshots.
- [ ] Run focused tests, lint and TypeScript. Review changed components and report any external-service verification limits.

Execution: inline in the current workspace, as requested by the user. No commit or deployment requested.

## Community scope added by user

- [ ] Add validated shared-deck model, safe source snapshots and public DTOs with no owner ID.
- [ ] Generate idempotent SQL migration via Supabase CLI. Enable RLS, deny direct client access, grant service_role, and test with PGlite including repeat application, constraints and role privileges.
- [ ] Add public list/detail and authenticated create/update/delete APIs. Server derives owner from session. Updates/deletes include ownership filters; updates reject conflicting versions.
- [ ] Add community browse/search/pagination/mine, publish/edit/delete, share links and independent play snapshots. Guests can play; login required to publish.
- [ ] Test two independent browser contexts, owner vs nonowner actions, save errors and missing migration behavior. Rerun tournament/preview checks, lint, types and build. Deliver SQL for the user to run, as explicitly requested.
