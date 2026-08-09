# NhacCuaTui Stream and Safari Background Playback Design

## Goal

Keep Spotify as the search and metadata source, prefer a freshly resolved NhacCuaTui audio stream for playback, fall back to the existing YouTube IFrame when NhacCuaTui cannot provide a usable track, and make direct HTML5 audio as reliable as possible in Safari iOS background mode.

## Scope

- Add a server-side NhacCuaTui adapter that uses the HTTPS backend already observed in the ChillMsic APK.
- Match Spotify tracks to NhacCuaTui results using normalized title, artist, album, and duration data when available.
- Resolve a new signed `audioUrl` for each playback attempt; never persist signed stream URLs.
- Prefer NhacCuaTui for external Spotify tracks without a direct local/Drive source.
- Fall back to YouTube when NhacCuaTui search, resolution, or HTML5 playback fails.
- Keep YouTube on the existing IFrame engine; do not extract or proxy YouTube audio.
- Improve the direct HTML5 audio path for Safari iOS with user-gesture-safe playback, media metadata/actions, stable audio element ownership, and stream diagnostics.

## Non-goals and constraints

- NhacCuaTui access is an unofficial integration and must be treated as an external dependency that may change or become unavailable.
- The implementation must use HTTPS and fetch fresh stream URLs because NhacCuaTui URLs are signed and expire.
- The implementation must not scrape browser pages, bypass geo restrictions, or expose long-lived provider credentials.
- Safari background playback cannot be guaranteed by JavaScript; the design only applies to direct HTML5 audio and must not claim background support for YouTube IFrame playback.
- Existing local/Drive/Audius playback remains supported.

## Architecture

### NhacCuaTui adapter

Create a small server-safe module with three responsibilities:

1. Search `https://music-api.vanhuy2004h.io.vn/api/search?q=...` and normalize results to MusicWeb tracks.
2. Fetch `https://music-api.vanhuy2004h.io.vn/api/song/{id}` to resolve a fresh `audioUrl`.
3. Validate the resolved URL as HTTPS and restrict accepted stream hosts to the known NhacCuaTui stream host before returning it to the player.

The adapter will expose typed functions for search, detail resolution, and matching. It will not store signed URLs in Supabase or local storage. Metadata/ID caching may be short-lived in memory only.

### Matching and playback flow

For a Spotify/iTunes track without a direct playable source:

1. Search NhacCuaTui with `artist + title`.
2. Score candidates using normalized title and artist tokens, album when present, and duration when available.
3. Resolve the best candidate's song detail and require a non-empty valid `audioUrl`.
4. Set the active track to `source: 'nhaccuatui'`, attach the fresh `audio_url`, and play through the existing HTML5 audio element.
5. If resolution or `audio.play()` fails, perform the existing YouTube search/match and use the IFrame engine.

Drive/local/Audius direct sources keep their existing priority and behavior. A YouTube track selected explicitly remains a YouTube IFrame track.

### Safari direct-audio behavior

- Keep one persistent `<audio>` element owned by `PlayerContext`.
- Start direct audio only from the existing user-initiated play flow and await the `play()` promise before setting `isPlaying`.
- Do not add visibility-based pause logic or a silent-audio keep-alive loop.
- Update `navigator.mediaSession` metadata and action handlers for direct audio when available, while treating Media Session as controls rather than a background guarantee.
- Preserve `src`, current time, and playback state across SPA navigation; only save position on page lifecycle events.
- Log direct-audio events and network state so Safari failures can be distinguished from provider failures.

## Error handling

- Empty search results, malformed provider responses, expired URLs, non-HTTPS URLs, unsupported hosts, non-audio content types, and failed `play()` calls all trigger the YouTube fallback.
- A failed NhacCuaTui request must not leave `isPlaying` true or permanently mutate the Spotify track into a broken source.
- If both providers fail, show the existing playback error and keep the queue usable.
- Provider failures are logged without logging full signed URLs.

## Testing and verification

- Unit-test normalization and matching with exact match, artist variation, remix/cover rejection, and no-match cases.
- Unit-test NhacCuaTui response parsing and signed URL validation without embedding live signed URLs.
- Test the player fallback when NhacCuaTui resolution rejects and when HTML5 `play()` rejects.
- Run focused Vitest tests, TypeScript compilation, and `git diff --check`.
- Perform a read-only production/API smoke test for search and fresh detail resolution after implementation.
- Manually verify direct audio on Chrome desktop, Chrome mobile, and Safari iOS by starting playback from a tap, switching away, locking the screen, returning, seeking, and moving to the next track.

