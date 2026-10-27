# iOS background playback recovery

User approved implementing the findings in `2026-10-25-ios-background-playback-audit.md`.

## Behavior

Keep one native HTML audio element on iOS. A cold YouTube selection must reach
native `play()` synchronously using the deterministic stream endpoint. Resolve
an alternative catalog source concurrently, cache it, and use it for recovery
or upcoming playback without restarting a track that is already playing.

Use explicit, idempotent controller `play()` and `pause()` operations for
MediaSession Play/Pause/Stop. Retain `togglePlay()` for existing UI consumers.
A rejected start remains resumable, and one OS Play must retry playback instead
of toggling stale desired intent to Pause. Pause during a pending operation must
win over late completion and user-activation recovery.

Inject `canUseYouTubeIframe()` into the playback controller; the browser runtime
returns false on iOS. Enforce the capability before starting or restoring any
iframe target. Prefer HTML5 alternatives; if none can play, retain a truthful
paused/error state and use the existing bounded failure/skip policy. Desktop
and Android retain their existing iframe support.

Prewarming a direct iOS YouTube next track must resolve a catalog alternative,
not just store the proxy URL. Keep the immediate proxy as a fallback while that
lookup is pending. Cache writes retain invalidation-generation/disposal guards.

## Alternatives considered

1. Native play immediately with concurrent catalog preparation: fits the current
   transport and preserves the gesture without waiting for a client request.
2. Keep awaiting catalog and require a second Play: simpler but regresses the
   single-tap playback flow and does not address automatic background recovery.
3. Add a universal server streaming endpoint: can hide provider resolution behind
   the initial media request but expands routing, caching and provider scope.

Use option 1. Do not use silent-audio loops or service-worker keepalive as a
substitute for a native media session. Leave unrelated manifest/theme, API and
backend extraction behavior unchanged.

## Validation

Add integration regressions that run the real source service, controller,
browser transport, HTML5 engine and MediaSession binding with fake network and
media hardware. Cover cold first play, a blocked start followed by OS Play,
explicit Pause after a blocked start, Pause during pending playback, proxy
failure on iOS without iframe, and next-track catalog prewarm. Add source-level
coverage for iOS alternate-video recovery. Run existing player suites,
TypeScript, ESLint on affected files and the production build when available.

Tests on Windows do not certify hardware background audio on iPhone. After the
code fixes, validate Safari/PWA on an actual iPhone across lock-screen Next,
Play/Pause, network cache misses and interruptions.
