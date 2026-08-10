# NhacCuaTui Vercel Stream Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play NhacCuaTui tracks through a same-origin, range-preserving Vercel-compatible route instead of exposing direct signed stream URLs to the browser.

**Architecture:** Add a Node-compatible Next.js Route Handler at `/api/nhaccuatui/stream?id=<nct-id>`. It resolves a fresh upstream NCT song URL server-side, allowlists `stream.nct.vn`, forwards browser `Range` headers, and streams the upstream response. Update the public NCT song metadata contract and player URL selection so the browser receives only a same-origin proxy URL; retain Drive and YouTube fallback behavior.

**Tech Stack:** Next.js 16.2.12 App Router Route Handlers, Web `Request`/`Response` APIs, TypeScript, Vitest 4.1.10, Vercel Node.js runtime.

## Global Constraints

- The fix must work locally and on Vercel without requiring a long-running server or an FFmpeg binary inside a Vercel Function.
- Do not transcode or re-encode audio with FFmpeg.
- Do not change the existing NCT search response shape.
- Do not change track persistence or playlist migration behavior.
- Do not remove the YouTube fallback.
- Do not accept arbitrary user-provided upstream URLs.
- Allow only the configured NCT API base URL for metadata resolution.
- Allow only `stream.nct.vn` as the upstream audio host.
- Do not log signed URLs or query tokens.
- Do not modify `supabase_nct_playlist_migration.sql`.

---

## File Map

- Create `app/api/nhaccuatui/stream/route.ts`: same-origin NCT metadata resolution and byte-range audio proxy.
- Modify `app/api/nhaccuatui/song/[id]/route.ts`: return public metadata plus a same-origin `streamUrl`, never the signed upstream `audioUrl`.
- Modify `lib/nhaccuatui.ts`: represent public proxy URLs separately from server-only signed upstream URLs and normalize both contracts without weakening the `stream.nct.vn` allowlist.
- Modify `lib/nhaccuatuiClient.ts`: consume public song metadata and expose a pure helper for constructing the encoded same-origin proxy URL.
- Modify `components/player/PlayerContext.tsx`: use the NCT proxy URL for playback while retaining NCT metadata and existing fallback ordering.
- Modify `app/api/nhaccuatui/__tests__/route.test.ts`: cover public song metadata without signed URL leakage and upstream allowlisting.
- Create `app/api/nhaccuatui/__tests__/stream.test.ts`: cover stream route validation, upstream resolution, range forwarding, response headers, and failures.
- Modify `lib/__tests__/nhaccuatui.test.ts`: cover public proxy-song normalization if the normalizer is extracted there.
- Modify `lib/__tests__/nhaccuatuiClient.test.ts`: cover encoded proxy URL construction and public song response parsing.
- Modify `lib/__tests__/audioPlayback.test.ts`: cover the NCT proxy URL helper if it is placed in `lib/audioPlayback.ts` instead of `lib/nhaccuatuiClient.ts`.

## Task 1: Lock the public NCT metadata contract and write the failing stream-route tests

**Files:**
- Modify: `app/api/nhaccuatui/__tests__/route.test.ts`
- Create: `app/api/nhaccuatui/__tests__/stream.test.ts`
- Modify: `lib/__tests__/nhaccuatuiClient.test.ts`
- Modify: `lib/nhaccuatui.ts`
- Modify: `lib/nhaccuatuiClient.ts`

**Interfaces:**
- The public song response is `{ song: { id, title, artist, coverUrl, duration, lyric, streamUrl } }`.
- `streamUrl` is `/api/nhaccuatui/stream?id=<encoded-id>`.
- The signed upstream `audioUrl` remains an internal server-side field only.
- The stream route exports `GET(request: Request): Promise<Response>`.

- [ ] **Step 1: Add a failing test for signed URL removal from the song route.**

Update the existing song-route expectation so it replaces `audioUrl` with `streamUrl`, then add this assertion:

```ts
it('returns a same-origin stream URL without exposing the signed NCT URL', async () => {
  process.env.NCT_API_BASE_URL = 'https://nct-api.test'
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({
      id: 'nct-1',
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      audioUrl: 'https://stream.nct.vn/song.mp3?expires=secret',
    }), { status: 200 }),
  )

  const response = await songGET(
    new Request('https://music.test/api/nhaccuatui/song/nct-1'),
    { params: Promise.resolve({ id: 'nct-1' }) },
  )
  const body = await response.json()

  expect(body.song.audioUrl).toBeUndefined()
  expect(body.song.streamUrl).toBe('/api/nhaccuatui/stream?id=nct-1')
  expect(JSON.stringify(body)).not.toContain('expires=secret')
})
```

- [ ] **Step 2: Add a failing test for encoded proxy URL construction.**

Add a pure helper test to `lib/__tests__/nhaccuatuiClient.test.ts`:

```ts
it('builds an encoded same-origin stream URL for an NCT track', () => {
  expect(getNhacCuaTuiStreamUrl({ source: 'nhaccuatui', nhaccuatui_id: 'id/with space' }))
    .toBe('/api/nhaccuatui/stream?id=id%2Fwith%20space')
  expect(getNhacCuaTuiStreamUrl({ source: 'youtube', nhaccuatui_id: 'nct-1' })).toBeNull()
})
```

- [ ] **Step 3: Add failing stream-route tests before creating the route file.**

Create `app/api/nhaccuatui/__tests__/stream.test.ts` with tests that import `GET` from `../stream/route` and assert the required behavior:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '../stream/route'

describe('NhacCuaTui audio stream route', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.NCT_API_BASE_URL
  })

  it('returns 400 for a missing song id', async () => {
    const response = await GET(new Request('https://music.test/api/nhaccuatui/stream'))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Missing song id' })
  })

  it('resolves and streams a valid NCT audio response', async () => {
    process.env.NCT_API_BASE_URL = 'https://nct-api.test'
    const upstreamAudio = new Response(new Uint8Array([1, 2, 3]), {
      status: 206,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': '3',
        'Content-Range': 'bytes 0-2/10',
        'Accept-Ranges': 'bytes',
      },
    })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'nct-1',
        title: 'Xương Rồng',
        artist: 'Dangrangto',
        audioUrl: 'https://stream.nct.vn/song.mp3?expires=secret',
      }), { status: 200 }))
      .mockResolvedValueOnce(upstreamAudio)

    const response = await GET(new Request(
      'https://music.test/api/nhaccuatui/stream?id=nct-1',
      { headers: { Range: 'bytes=0-2' } },
    ))

    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Type')).toBe('audio/mpeg')
    expect(response.headers.get('Content-Range')).toBe('bytes 0-2/10')
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    const streamInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect(new Headers(streamInit?.headers).get('Range')).toBe('bytes=0-2')
  })

  it('rejects a resolved URL outside stream.nct.vn', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      id: 'nct-1',
      title: 'Xương Rồng',
      artist: 'Dangrangto',
      audioUrl: 'https://evil.example/audio.mp3?token=secret',
    }), { status: 200 }))

    const response = await GET(new Request('https://music.test/api/nhaccuatui/stream?id=nct-1'))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Song stream unavailable' })
  })
})
```

- [ ] **Step 4: Run only the new/changed tests and verify the RED failures.**

Run:

```powershell
npm test -- app/api/nhaccuatui/__tests__/route.test.ts app/api/nhaccuatui/__tests__/stream.test.ts lib/__tests__/nhaccuatuiClient.test.ts
```

Expected: FAIL because the public `streamUrl` contract, `getNhacCuaTuiStreamUrl`, and `app/api/nhaccuatui/stream/route.ts` do not exist yet. Do not change production code before observing these failures.

## Task 2: Implement the server-side metadata contract and Vercel-compatible stream route

**Files:**
- Create: `app/api/nhaccuatui/stream/route.ts`
- Modify: `app/api/nhaccuatui/song/[id]/route.ts`
- Modify: `lib/nhaccuatui.ts`
- Modify: `lib/nhaccuatuiClient.ts`
- Modify: `app/api/nhaccuatui/__tests__/route.test.ts`
- Modify: `app/api/nhaccuatui/__tests__/stream.test.ts`
- Modify: `lib/__tests__/nhaccuatuiClient.test.ts`

**Interfaces:**
- `GET` accepts a `Request`, reads `new URL(request.url).searchParams.get('id')`, and returns a Web `Response`.
- The metadata fetch is `GET ${NCT_API_BASE_URL}/api/song/${encodeURIComponent(id)}`.
- The stream fetch is made only against a validated `https://stream.nct.vn` URL.

- [ ] **Step 1: Implement the smallest public song response change.**

In `app/api/nhaccuatui/song/[id]/route.ts`, keep the existing upstream normalization and return the signed URL only to server-local code. Before serializing the response, construct:

```ts
const { audioUrl: _signedAudioUrl, ...publicSong } = song

return NextResponse.json({
  song: {
    ...publicSong,
    streamUrl: `/api/nhaccuatui/stream?id=${encodeURIComponent(song.id)}`,
  },
}, { headers: { 'Cache-Control': 'no-store' } })
```

Keep `normalizeNhacCuaTuiSongResponse` strict and server-facing: it must continue to require a valid `https://stream.nct.vn/...` `audioUrl`. Add a separate public-song normalizer that requires `streamUrl` and never calls `isValidNhacCuaTuiAudioUrl` on the same-origin proxy URL. The `NhacCuaTuiSong` type may expose optional `audioUrl` and `streamUrl` fields, but browser-client code must only consume `streamUrl`.

Update the existing `app/api/nhaccuatui/__tests__/route.test.ts` expected JSON to remove `audioUrl` and include `streamUrl`. Update the existing `lib/__tests__/nhaccuatuiClient.test.ts` mocks from `audioUrl: 'https://stream.nct.vn/...'` to `streamUrl: '/api/nhaccuatui/stream?id=nct-1'`, and assert `streamUrl` rather than a signed URL.

- [ ] **Step 2: Implement the route's metadata resolution and host validation.**

In `app/api/nhaccuatui/stream/route.ts`, use the existing default base URL `https://music-api.vanhuy2004h.io.vn` and `process.env.NCT_API_BASE_URL` override. Resolve the song metadata, normalize it with `normalizeNhacCuaTuiSongResponse`, and reject missing/invalid/non-allowlisted audio URLs without including the URL in the error body.

The route must set a bounded upstream timeout using `AbortSignal.timeout(8000)` for metadata and stream requests, matching the existing NCT routes.

- [ ] **Step 3: Implement range-preserving upstream streaming.**

Forward only the incoming `Range` header to the NCT stream fetch:

```ts
const upstreamHeaders = new Headers({ Accept: 'audio/mpeg' })
const range = request.headers.get('range')
if (range) upstreamHeaders.set('Range', range)

const upstream = await fetch(song.audioUrl, {
  method: 'GET',
  headers: upstreamHeaders,
  cache: 'no-store',
  signal: AbortSignal.timeout(8000),
})
```

Return `new Response(upstream.body, { status: upstream.status, headers })`, copying only `Content-Type`, `Content-Length`, `Content-Range`, and `Accept-Ranges`, and always adding `Cache-Control: private, no-store`. Reject non-2xx/non-audio upstream responses with `{ error: 'Song stream unavailable' }` and status `502`.

- [ ] **Step 4: Run the focused tests and verify GREEN.**

Run:

```powershell
npm test -- app/api/nhaccuatui/__tests__/route.test.ts app/api/nhaccuatui/__tests__/stream.test.ts lib/__tests__/nhaccuatuiClient.test.ts
```

Expected: PASS for missing IDs, public metadata redaction, fresh URL resolution, range forwarding, header preservation, and host rejection.

- [ ] **Step 5: Commit the route and metadata contract.**

```powershell
git add app/api/nhaccuatui/stream/route.ts app/api/nhaccuatui/song/[id]/route.ts app/api/nhaccuatui/__tests__/route.test.ts app/api/nhaccuatui/__tests__/stream.test.ts lib/nhaccuatui.ts lib/nhaccuatuiClient.ts lib/__tests__/nhaccuatuiClient.test.ts
git commit -m "feat: add Vercel-compatible NCT stream proxy"
```

## Task 3: Integrate the player with the same-origin NCT URL

**Files:**
- Modify: `lib/nhaccuatuiClient.ts`
- Modify: `components/player/PlayerContext.tsx`
- Modify: `lib/__tests__/nhaccuatuiClient.test.ts`
- Modify: `lib/__tests__/audioPlayback.test.ts` if the helper is placed there

**Interfaces:**
- `getNhacCuaTuiStreamUrl(track: Pick<Track, 'source' | 'nhaccuatui_id'>): string | null` returns the encoded same-origin URL only for NCT tracks with an ID.

- [ ] **Step 1: Add the failing player URL test if not already added in Task 1.**

Assert that an NCT track with a direct signed URL still resolves to the proxy URL:

```ts
expect(getNhacCuaTuiStreamUrl({
  source: 'nhaccuatui',
  nhaccuatui_id: 'nct-1',
})).toBe('/api/nhaccuatui/stream?id=nct-1')
```

Run the focused test and confirm it fails before implementation.

- [ ] **Step 2: Implement the pure proxy URL helper.**

Add the helper to `lib/nhaccuatuiClient.ts`:

```ts
export function getNhacCuaTuiStreamUrl(
  track: Pick<Track, 'source' | 'nhaccuatui_id'>,
): string | null {
  if (track.source !== 'nhaccuatui' || !track.nhaccuatui_id) return null
  return `/api/nhaccuatui/stream?id=${encodeURIComponent(track.nhaccuatui_id)}`
}
```

- [ ] **Step 3: Update `PlayerContext` NCT resolution before the direct URL branch.**

In `getAudioUrl`, check NCT proxy resolution before `track.audio_url`:

```ts
const nctStreamUrl = getNhacCuaTuiStreamUrl(track)
if (nctStreamUrl) return nctStreamUrl

if (track.source === 'audius' || track.audio_url) {
  return track.audio_url || track.file_path
}
```

When creating `activeTrack` from `nctSong`, retain `source: 'nhaccuatui'`, `nhaccuatui_id`, title, artist, duration, and cover metadata, but do not store the signed `song.audioUrl` in `audio_url` or `file_path`. The proxy helper must be the only final NCT browser source.

- [ ] **Step 4: Verify NCT cache and fallback behavior.**

Keep the existing early return in `getAudioUrlCached` for NCT tracks so every NCT playback request resolves a fresh proxy URL. Do not alter the Drive lookup or YouTube fallback branches. Run:

```powershell
npm test -- lib/__tests__/nhaccuatuiClient.test.ts lib/__tests__/audioPlayback.test.ts
```

Expected: PASS, including existing YouTube routing and signed-URL persistence protections.

- [ ] **Step 5: Commit the player integration.**

```powershell
git add components/player/PlayerContext.tsx lib/nhaccuatuiClient.ts lib/__tests__/nhaccuatuiClient.test.ts lib/__tests__/audioPlayback.test.ts
git commit -m "fix: route NCT playback through same-origin stream"
```

## Task 4: Full verification and Vercel readiness checks

**Files:**
- No new source files.
- Review: `app/api/nhaccuatui/stream/route.ts`, `app/api/nhaccuatui/song/[id]/route.ts`, `components/player/PlayerContext.tsx`, and all changed tests.

- [ ] **Step 1: Run the complete test suite.**

```powershell
npm test
```

Expected: exit code `0` with all tests passing.

- [ ] **Step 2: Run lint and the production build.**

```powershell
npm run lint
npm run build
```

Expected: both commands exit `0`; the route is compiled as a Vercel-compatible Node.js Route Handler without FFmpeg or persistent-process dependencies.

- [ ] **Step 3: Verify the local proxy with a range request.**

With `npm run dev` running, request:

```powershell
curl.exe -i -H "Range: bytes=0-1023" "http://localhost:3000/api/nhaccuatui/stream?id=Hx5GCmupLIze"
```

Expected headers include `206`, `Content-Type: audio/mpeg`, `Content-Range`, `Accept-Ranges: bytes`, and `Cache-Control: private, no-store`. The response must not include a signed `stream.nct.vn` URL.

- [ ] **Step 4: Verify browser playback and fallback manually.**

In Chrome DevTools Network:

1. Play a known NCT-backed track.
2. Confirm the media request is `/api/nhaccuatui/stream?id=...` and there is no browser request directly to `stream.nct.vn`.
3. Confirm the request returns `200`/`206` with `audio/mpeg`.
4. Seek to a later timestamp and confirm another range request succeeds.
5. Confirm the track remains `source: 'nhaccuatui'` while playing.
6. Temporarily make the NCT route return an upstream failure in a local-only test and confirm the existing YouTube fallback still starts.

- [ ] **Step 5: Review the final diff and commit verification state.**

```powershell
git diff --check
git status --short
git log -3 --oneline
```

Expected: no whitespace errors, only intended files changed, and the two implementation commits are present after the already committed design spec.
