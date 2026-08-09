# iOS Background Audio Playback Design

## Goal

Make uploaded, Google Drive, Supabase, and other direct HTML5 audio sources play reliably in Safari iOS background/lock-screen mode. YouTube playback remains supported through its existing IFrame engine, without promising background playback.

## Root Cause

The YouTube proxy uses a deprecated InnerTube client and an outdated `@distube/ytdl-core` decipher path. It returns HTTP 502, which adds a failed network attempt before the IFrame fallback. Separately, the HTML5 playback path calls `audio.play()` without awaiting its Promise and marks the track as playing before Safari confirms playback.

## Design

1. Route YouTube tracks directly to the IFrame engine instead of attempting the deprecated audio proxy.
2. Keep direct sources on the single persistent `<audio>` element. Set `isPlaying` only after `audio.play()` resolves; preserve the existing buffering and error UI when it rejects.
3. Apply the same Promise handling to Media Session `play` actions so lock-screen controls cannot report a false playing state.
4. Add a small pure playback helper and regression tests covering resolved and rejected `play()` Promises.
5. Do not change authentication, database schema, service-worker caching, or upload/stream route contracts.

## Acceptance Criteria

- Direct HTML5 sources call `audio.play()` and wait for completion before setting `isPlaying`.
- A rejected `audio.play()` Promise leaves playback stopped and exposes the existing playback error path.
- YouTube tracks skip the known-broken `/api/youtube/stream` attempt and use the IFrame engine immediately.
- Media Session play actions handle the same success/failure behavior.
- New regression tests pass without requiring a browser or external network.
