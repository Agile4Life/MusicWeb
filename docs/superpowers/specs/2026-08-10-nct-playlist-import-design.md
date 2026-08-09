# NCT-First Playlist Import Design

## Goal

When a playlist is imported from Spotify or YouTube Music, each selected item should be stored as an NhacCuaTui track whenever a reliable match exists. The original Spotify/YouTube track remains the silent fallback when NCT cannot be matched.

## Current flow

- Spotify import matches Spotify items to YouTube, then stores the matched YouTube metadata in `tracks`.
- YouTube Music import stores the fetched YouTube track directly in `tracks`.
- Neither import flow attempts an NhacCuaTui catalog match before persistence.

## Design

Add a shared playlist-import resolver that accepts a `Track`-shaped fallback candidate and calls the existing NhacCuaTui resolver. A successful match produces a catalog track with `source: 'nhaccuatui'`, `nhaccuatui_id`, NCT metadata, and no signed stream URL. A failed or unavailable NCT lookup returns the original candidate unchanged.

Both import modals will call this resolver immediately before database lookup/insertion. The database record will preserve the NCT identity fields needed by `PlayerContext` to resolve a fresh stream after reload. Playlist ordering and progress counters will remain unchanged.

## Data and compatibility

- Never persist an NCT signed `audio_url` or `file_path`.
- Keep `youtube_id`/fallback metadata only on fallback records; do not attach YouTube identity to an NCT record.
- Add a migration for `tracks.source`, `tracks.nhaccuatui_id`, and existing external identity columns only if the deployed schema does not already contain them. The import payload remains compatible with the current application schema.
- NCT failures are silent and must not prevent playlist creation.

## Testing

- Unit-test the shared resolver for successful NCT replacement and silent fallback.
- Verify the resolver never returns a signed URL in the persisted track shape.
- Run the existing focused NCT/playback test suite and TypeScript checks.
