# Playback Race Guards Design

## Goal

Prevent stale HTML5/YouTube callbacks and retry timers from changing the active track after a rapid track switch.

## Design

`PlayerContext` already assigns a monotonically increasing `playRequestRef` to asynchronous `playTrack` operations. The fix extends the same ownership model to media callbacks:

- Add a small playback-guard helper that validates request generation and track identity.
- Invalidate pending retry and auto-next timers whenever a new playback request starts.
- Capture the active request/track when scheduling HTML5 retry and YouTube fallback work.
- Ignore stale `ended`, `error`, `loadedmetadata`, YouTube fallback, and watchdog work.
- Use ref-backed queue/index values in queue removal so rapid operations do not rely on stale React state.

## Scope

Only `components/player/PlayerContext.tsx` and focused playback regression tests are changed. No provider architecture rewrite or unrelated lyrics/network changes are included.

## Verification

Run the focused playback tests, then the full Vitest suite. The existing lyrics tests may remain environment-dependent because they call external services.
