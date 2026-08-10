# NhacCuaTui Vercel Stream Proxy Design

## Problem

NhacCuaTui search and song-resolution requests succeed, but direct playback of the returned `stream.nct.vn` URL fails in the browser with `NotSupportedError`. The player then falls back to YouTube. The stream endpoint itself returns `audio/mpeg`, supports byte ranges, and permits the application origin, so the failure boundary is the browser's direct cross-origin media request rather than catalog resolution.

The fix must work locally and on Vercel without requiring a long-running server or an FFmpeg binary inside a Vercel Function.

## Goals

- Play NhacCuaTui tracks through a same-origin application URL.
- Preserve HTTP range requests so seeking and progressive buffering continue to work.
- Keep signed NhacCuaTui stream URLs server-side instead of exposing them to the browser.
- Preserve the current YouTube fallback when the NCT proxy cannot resolve or stream a track.
- Keep the implementation compatible with Vercel serverless route handlers.
- Add automated coverage for validation, upstream resolution, range forwarding, and error mapping.

## Non-goals

- Do not transcode or re-encode audio with FFmpeg.
- Do not change the existing NCT search response shape.
- Do not change track persistence or playlist migration behavior.
- Do not remove the YouTube fallback.
- Do not accept arbitrary user-provided upstream URLs.

## Chosen architecture

Add a same-origin route handler at `/api/nhaccuatui/stream?id=<nct-id>`.

The route accepts only a NhacCuaTui song ID. It resolves the ID against the configured NCT API, validates that the resulting stream host is `stream.nct.vn`, forwards the browser's `Range` request header to the upstream stream, and returns the upstream body with the relevant audio and range headers. The route must not proxy arbitrary URLs.

Update the player so that a resolved NCT track uses `/api/nhaccuatui/stream?id=<nct-id>` as its HTML5 audio source. The player continues to keep the resolved NCT metadata (`title`, `artist`, `duration`, `nhaccuatui_id`, and `source: 'nhaccuatui'`) while hiding the signed upstream URL from the browser.

The browser-to-server path becomes:

```text
NCT track metadata
    -> /api/nhaccuatui/stream?id=<id>
    -> server resolves a fresh signed stream URL
    -> server forwards Range and streams audio/mpeg
    -> same-origin HTML5 audio element
```

## Route contract

### Request

- Method: `GET`.
- Required query parameter: `id`, trimmed and non-empty.
- Forward the incoming `Range` header when present.
- Do not accept a `url` query parameter.

### Success response

Return the upstream response body and status, normally `200` or `206`, with these headers when supplied by upstream:

- `Content-Type` (expected `audio/mpeg`).
- `Content-Length`.
- `Content-Range`.
- `Accept-Ranges`.

Use `Cache-Control: private, no-store` because signed URLs are short-lived and per-request resolution is required.

### Error response

- `400` when `id` is missing or blank.
- `404` when NCT cannot resolve the song ID.
- `502` when NCT metadata resolves but the stream URL is invalid, the upstream stream request fails, or the upstream response is not an audio response.

Errors must be JSON and must not include the signed upstream URL.

## Player integration

In `components/player/PlayerContext.tsx`, the NCT branch in `getAudioUrl` must return the same-origin proxy URL when `track.source === 'nhaccuatui'` and `track.nhaccuatui_id` is available. The direct `track.audio_url` value must not be used as the browser's final source for NCT tracks.

The existing resolution order remains unchanged:

1. Resolve NhacCuaTui for eligible catalog tracks.
2. Attempt playback through the same-origin NCT proxy.
3. Try an existing Drive match if the NCT attempt fails.
4. Fall back to YouTube if no direct playable source succeeds.

The NCT route should resolve a fresh upstream URL on every request. The player may retain its existing non-NCT URL cache, but NCT URLs must continue to bypass that cache because they are signed and short-lived.

## Security and deployment constraints

- Allow only the configured NCT API base URL for metadata resolution.
- Allow only `stream.nct.vn` as the upstream audio host.
- Encode the requested song ID as a path segment.
- Do not log signed URLs or query tokens.
- Use the existing Next.js route-handler runtime compatible with Vercel.
- Do not add FFmpeg, FFmpeg WASM, or a persistent process requirement.

## Testing and acceptance criteria

Add focused tests before implementation for:

1. A missing `id` returns `400` JSON.
2. A valid ID resolves an NCT stream and returns a same-origin proxy response with the upstream audio status and headers.
3. An incoming `Range` header is forwarded upstream and a `206` response preserves `Content-Range`.
4. A non-`stream.nct.vn` resolved URL is rejected with `502` and the signed URL is not exposed.
5. An upstream resolution failure maps to `404` or `502` according to the failure stage.
6. NCT player URL resolution returns `/api/nhaccuatui/stream?id=<encoded-id>` rather than the direct signed URL.

Manual verification must confirm:

- Local playback generates a request to `/api/nhaccuatui/stream?id=...`, not directly to `stream.nct.vn`.
- The proxy responds with `200` or `206` and `Content-Type: audio/mpeg`.
- Seeking works while the track is playing.
- A valid NCT track remains `source: 'nhaccuatui'` while playing and does not immediately fall back to YouTube.
- YouTube fallback still works when the NCT proxy is unavailable.
- The production build succeeds with the Vercel-compatible route handler.

## Files expected to change

- Create `app/api/nhaccuatui/stream/route.ts` for the same-origin streaming route.
- Modify `components/player/PlayerContext.tsx` to select the proxy URL for NCT tracks.
- Add focused tests beside the existing NCT/API test conventions.
- Do not modify `supabase_nct_playlist_migration.sql`.
