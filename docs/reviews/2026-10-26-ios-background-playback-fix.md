# iOS playback fix verification

Implements the authorized fixes from the 2026-10-25 playback audit on top of
`df35989`, alongside the separately committed SoundCloud optimization `4647ac9`.

## Behavior changes

- Cold iOS YouTube selection reaches native `audio.play()` synchronously using
  the existing stream endpoint. Catalog alternatives prepare concurrently.
- Direct YouTube next-track prewarm now resolves a native catalog alternative.
  Late results update caches without restarting the current track.
- MediaSession Play/Pause/Stop use explicit controller commands. The first OS
  Play after a blocked start retries native playback. Pause clears pending
  resume even if the UI was already paused.
- Playback intent and ownership guard late recovery callbacks. Pause remains
  authoritative across foreground, heartbeat, pause-event and activation recovery.
- The browser runtime disables iframe playback on iOS. Controller start and
  persisted restore enforce the capability; other platforms retain iframe support.
- Proxy failure preserves ready or pending catalog alternatives instead of
  invalidating a source that has not failed.
- `NotAllowedError`/current-owner `AbortError` leave a resumable paused state
  instead of trying another engine or leaving buffering active indefinitely.
- Catalog recovery waits at most 1800 ms before continuing the existing fallback
  search. An eventual catalog result can still warm the cache.
- Service-worker comments now describe caching/liveness acknowledgements without
  claiming they guarantee iOS background execution. The worker protocol is unchanged.

## Checks

- Baseline before changes: 7 relevant suites, 78 tests passed.
- New integration regressions were observed failing before the corresponding
  implementation fixes. They import the real source service, controller,
  transport, engines and MediaSession binding; media permissions/hardware,
  provider responses and OS events are simulated.
- Final relevant test set: **43 suites, 275 tests passed**, including **20 iOS
  integration regressions**, ownership, source/controller, runtime, transport,
  MediaSession, audio/cache helpers, classification, prewarm and PWA checks.
- Scoped ESLint and `node --check public/sw.js`: passed.
- TypeScript `tsc --noEmit --incremental false`: passed.
- Independent read-only review: no remaining blocking findings in the iOS fix
  scope after the prepared-alternative invalidation issue was addressed.
- Production build attempted with the installed Next.js 16.2.12 CLI. It failed
  to download the five existing Google Fonts families because network requests
  to fonts.googleapis.com could not connect. This does not establish a passing
  production build; no font configuration was changed to conceal the failure.

The earlier ownership regression now uses explicit `controller.pause()` to
express a Pause after a blocked start. The UI toggle regression separately
verifies that the paused UI's Play control retries playback.

## Scope and remaining device validation

The user requested a local commit after verification. No deployment was made.
Concurrent SoundCloud changes appeared in the shared checkout and were committed
separately; their independent hunks were preserved. The test results describe
the workspace observed during those checks.

Windows unit/integration checks do not reproduce iPhone audio-session behavior.
On an actual iPhone, validate Safari and installed PWA with a fresh first play,
immediate screen lock, cache-hit/miss Next, OS Play/Pause, and interruption
recovery. Record the iOS version and source used. Browser/OS restrictions and
provider availability still govern whether a particular stream can play.
