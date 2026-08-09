# NhacCuaTui Primary Flow Design

## Goal

Make NhacCuaTui the primary catalog, lyrics and playback source while keeping Spotify, iTunes, Drive, LRCLIB and YouTube as silent fallbacks. The interface must present one unified MusicWeb experience and must not expose fallback source names or source controls.

## User-visible behavior

- Search results are presented as one unified list. No source tabs, source badges or source-specific labels are shown.
- NhacCuaTui search is attempted first.
- If NhacCuaTui search is unavailable or returns no usable match, fallback metadata may be used internally to keep search and playback working, but the UI still renders a normal track row.
- Selecting a result always attempts a fresh NhacCuaTui match and stream first.
- If NCT cannot resolve or play the stream, the player silently tries Drive/direct audio and then YouTube IFrame. The user only sees an error after all sources fail.
- Lyrics try NCT song lyrics first. If absent or unusable, the existing LRCLIB flow runs, then YouTube Music lyrics remains the last fallback.
- Existing local uploads and explicitly selected library tracks continue to play directly; the new priority applies to external/catalog tracks.

## Data flow

```text
Search query
  -> NCT metadata search
  -> normalized unified Track list
  -> silent catalog fallback if NCT is unavailable/empty

Track selection
  -> NCT exact match + fresh signed stream
  -> native HTML5 audio / Media Session
  -> silent direct/Drive fallback
  -> silent YouTube IFrame fallback

Lyrics request
  -> NCT song lyric
  -> LRCLIB
  -> YouTube Music lyrics
```

## Architecture

1. Keep the existing internal NCT proxy and allowlist signed audio URLs to `https://stream.nct.vn`.
2. Add a unified NCT search adapter that maps NCT metadata to the existing `Track` shape without exposing provider-specific UI state.
3. Make `SearchContext` merge NCT-first results with fallback results while preserving one `GlobalSearchTracks` view for consumers. Remove source-specific presentation from the home search result controls and TopBar ordering.
4. Extend `PlayerContext` so NCT tracks can resolve by `nhaccuatui_id` and external Spotify/iTunes tracks always attempt NCT before the existing silent fallback chain.
5. Let `LyricsView` resolve NCT lyrics using the active `nhaccuatui_id`, then delegate to the current LRCLIB/YouTube fallback implementation.
6. Keep signed URLs ephemeral: do not cache them across sessions, persist them, or write them to diagnostic logs.

## Matching and failure policy

- Match title and artist after diacritic removal and noise cleanup.
- Reject obvious remix, cover, karaoke, instrumental, live and speed variants unless the requested title explicitly contains that variant.
- Reject candidates with a large duration mismatch when duration is available.
- A failed NCT request must resolve quickly with a bounded timeout and must not block the fallback chain indefinitely.
- Fallback source names must not be included in user-facing errors, badges or search filters.
- Provider-specific diagnostics may remain in developer logs, but signed URL query parameters must be redacted.

## Scope

Included:

- NCT-first search, playback and lyrics.
- Silent fallback orchestration.
- Unified result presentation without source controls.
- Tests for ordering, fallback behavior, lyric precedence and URL safety.
- Vercel environment-variable documentation.

Excluded:

- YouTube audio extraction or bypassing regional restrictions.
- Silent-audio keep-alive hacks.
- Replacing local upload, playlist, favorite or history storage.
- Adding a new provider-specific public API to the browser.

## Success criteria

- A normal search shows NCT results first and no provider tabs/badges.
- NCT stream playback uses native audio and remains eligible for Safari Media Session/background controls.
- If NCT is unavailable, playback still reaches the existing fallback without a provider switch visible to the user.
- NCT lyrics are displayed whenever the NCT song response contains usable lyrics.
- Existing Spotify/YouTube/Drive/iTunes flows remain functional when NCT has no match.
- Focused tests pass and no signed NCT URL is persisted or logged.
