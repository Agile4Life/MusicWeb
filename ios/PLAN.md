# BlueSymphony iOS — feature completion plan

Goal: bring every **user-facing** feature the MusicWeb backend already exposes into the native
SwiftUI app (`ios/`), organized like Apple Music. Backend is `https://www.bluesymphony.site`
(always call `www.` — the apex 308-redirects). **Do not change the backend.**

## Current state (already done, keep working)

- `ios/BlueSymphony.xcodeproj` uses a file-system-synchronized group: any `.swift` file you add
  anywhere under `ios/BlueSymphony/` (subfolders too) is compiled automatically. Never edit
  `project.pbxproj` by hand except for build settings.
- `API.swift` — `Track`, `Album`, generic `API.get`, trending, new releases, album, Spotify search,
  `streamURL(for:invalidate:)` (mirrors web `clientResolutionService`), `prewarm`.
- `Player.swift` — `@Observable` AVPlayer queue: retry, `invalidate=1` re-resolve, 4-skip cap,
  auto-skip after 1.2 s, lock-screen / remote commands, prewarm next track.
- UI: `RootView` TabView (Trang chủ, Mới, Search role tab) + `.tabViewBottomAccessory` mini player,
  `HomeView`, `NewReleasesView`, `AlbumView`, `SearchView`, `NowPlayingView`, `Components.swift`.
- iOS 26 deployment target, Swift 5 language mode, `@MainActor` on observable state.

### Known backend limitation — do not try to fix

YouTube audio cannot be streamed: YouTube requires a PO token from Cloudflare/datacenter IPs
(bot check + 403 after ~1 MB). Tracks that resolve only to YouTube fail → the player already shows
an error and skips. Do **not** add any PO-token / BotGuard / anti-bot workaround. Never fetch
YouTube or googlevideo directly from the app.

## Target structure (move existing files into these folders; names stay)

```
ios/BlueSymphony/
  App/            BlueSymphonyApp.swift (RootView, tabs)
  Core/           API.swift, Models.swift (split models out of API.swift), AuthService.swift,
                  Config.swift, SessionStore.swift
  Player/         Player.swift, NowPlayingView.swift, MiniPlayer (split), QueueView.swift,
                  LyricsView.swift, Lyrics.swift (LRC parser)
  Features/Home/  HomeView.swift, NewReleasesView (split from HomeView)
  Features/Search/SearchView.swift
  Features/Library/LibraryView.swift, FavoritesView.swift, HistoryView.swift,
                  TopTracksView.swift, PlaylistsView.swift, PlaylistDetailView.swift,
                  PlaylistEditor.swift
  Features/Album/ AlbumView.swift
  Features/Artist/ArtistView.swift
  Features/Account/LoginView.swift, RegisterView.swift, AccountView.swift
  UI/             Components.swift (Artwork, TrackRow, SectionHeader, formatTime), TrackMenu.swift
```

Tabs after the work (Apple Music order): **Trang chủ · Mới · Thư viện · (Search)**. Account lives
behind an avatar button in the Home/Library navigation bar (sheet), like Apple Music.

## Phase 0 — config + authentication (everything private depends on it)

Web login flow (see `components/auth/AuthForm.tsx`, `lib/authOptions.ts`, `lib/auth/credentials.ts`):
1. Supabase password sign-in:
   `POST {SUPABASE_URL}/auth/v1/token?grant_type=password`, headers `apikey: <anon key>`,
   `Content-Type: application/json`, body `{"email","password"}` → `access_token`.
   If the error says "email not confirmed": `POST /api/approve-email {email}` then retry once.
2. NextAuth session: `GET /api/auth/csrf` → `{csrfToken}` (sets a csrf cookie), then
   `POST /api/auth/callback/credentials` as `application/x-www-form-urlencoded` with
   `csrfToken`, `email`, `accessToken`, `json=true`. Success sets the
   `__Secure-next-auth.session-token` cookie. Verify with `GET /api/auth/session` (`{user:{email}}`).
3. All private routes then work through `URLSession.shared` cookies (`HTTPCookieStorage.shared`
   persists them). 401 `{"error":"Vui lòng đăng nhập"}` = signed out.
4. Sign out: `POST /api/auth/signout` (form: `csrfToken`, `json=true`) and clear bluesymphony cookies.
5. Register: `POST /api/register` (read the route for the body and response, e.g. `authEmail`), then
   steps 1–2. Read `/api/check-approval` to see whether accounts need admin approval, and show
   that state.

Config: Supabase URL + anon key are public client values, but **must not be committed**. Add
`ios/Config/Secrets.xcconfig` (gitignored; add `Config/Secrets.xcconfig` to `ios/.gitignore`), a
committed `ios/Config/Secrets.example.xcconfig`, and `ios/scripts/make-secrets.sh` that reads
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the repo's `.env.local` (or `.env`)
and writes the xcconfig. Wire the xcconfig as the target's base configuration and expose the values
via `INFOPLIST_KEY_*` or an Info.plist entry read by `Config.swift`. Do **not** print the key values
in logs, commits or your final report. The app must build and run when Secrets.xcconfig is missing
(login shows "chưa cấu hình").

`SessionStore` (`@Observable`, `@MainActor`): `email`, `isSignedIn`, `signIn`, `register`, `signOut`,
`refresh()` on launch via `/api/auth/session`. Inject with `.environment`.

Google sign-in is **out of scope** (would need server changes for a native redirect). Show only
email/password.

## Phase 1 — Library tab (Thư viện)

Apple Music-style list: Playlists, Bài hát yêu thích, Lịch sử nghe, Top của bạn. Signed out → a
sign-in prompt card.

| Feature | Endpoint | Notes |
|---|---|---|
| Favorites list | `GET /api/favorites/list?limit=` → `{tracks}` | play all / shuffle |
| Favorite ids | `GET /api/favorites/status` → `{trackIds}` | cache in SessionStore for heart state |
| Toggle favorite | `POST /api/favorites/toggle {trackId, nextValue}` | needs a **DB track id**; external (Spotify/SoundCloud) tracks must be persisted first — read `lib/trackPersistence.ts` (`resolveExternalTrackId`) and `app/api/history/record/route.ts` (accepts a full `track` and resolves external ones) and pick the server path that returns/creates the DB id; do not write to Supabase tables directly from the app |
| History | `GET /api/history/list?limit=` → `{items}` | grouped by day; swipe to delete |
| Delete history | `POST /api/history/delete {historyId}` or `{clearAll:true}` | confirm before clear-all |
| Top tracks | `GET /api/history/top?timeframe=&limit=` → `{items,totalPlays}` | read the route for allowed timeframes; segmented picker |
| Playlists | `GET /api/playlists` → `{playlists}` | grid of covers |
| Create | `POST /api/playlists {name, description?, isPublic?, coverUrl?}` → `{playlist}` | |
| Detail | `GET /api/playlists/{id}` → `{playlist, tracks}` | |
| Edit / delete | `PATCH` / `DELETE /api/playlists/{id}` | read the route for the PATCH body |
| Add track | `POST /api/playlists/{id}/tracks {track}` | returns `message` ("đã có trong playlist") |
| Remove track | `DELETE /api/playlists/{id}/tracks?trackId=` | swipe to delete |
| Home data | `GET /api/user/init-data?history_limit=` | read the shape; use it for "Nghe gần đây" shelf on Home when signed in |

Read each route file before coding its decoder; make every model field optional except `id`, and
decode numbers that may arrive as strings defensively (one bad field must not blank a screen).

## Phase 2 — player features

- **Heart** button in NowPlaying + in the track context menu (Phase 1 toggle).
- **Track context menu** (`TrackMenu.swift`, `.contextMenu` on every `TrackRow`): Phát tiếp theo,
  Thêm vào hàng chờ, Thêm vào playlist… (sheet listing playlists), Yêu thích, Đi tới nghệ sĩ.
  Player gains `playNext(_:)`, `enqueue(_:)`, `remove(at:)`, `move(from:to:)`.
- **Queue view** (`QueueView.swift`): Apple Music "Tiếp theo" list opened from NowPlaying, reorder
  and delete rows, shuffle and repeat (off/all/one) toggles in Player.
- **Autoplay**: when the queue ends, call `GET /api/queue/next?current_track_id=&artist=&title=&limit=12&history_ids=`
  (see `recommend` in `components/player/adapters/browserUserEffects.ts`) and append results.
- **History + listen events** (signed in only, fire-and-forget): `POST /api/history/record {track}`
  ~100 ms after a track starts (dedupe the same track within 3 s), and `POST /api/listen-events
  {track_id, artist, completed, skip_at_seconds}` when a track ends or is skipped.
- **Lyrics** (`LyricsView.swift`): first `GET /api/lyrics/custom?title=&artist=&duration=&album=`
  (`{found, rawLyrics}`), else LRCLIB `GET https://lrclib.net/api/get?track_name=&artist_name=&album_name=&duration=`
  (`syncedLyrics` / `plainLyrics`; see `lib/lrclib.ts`). Parse LRC `[mm:ss.xx]` into lines, highlight
  and auto-scroll the current line from `Player.currentTime`, tap a line to seek. Lyrics button in
  NowPlaying toggles artwork ↔ lyrics like Apple Music.
- AirPlay route picker (`AVRoutePickerView` wrapped) and system volume in NowPlaying.

## Phase 3 — discovery

- **Artist page**: `GET /api/artist?name=` → `{artist, topTracks}` (read the route for artist
  fields). Hero image, "Bài hát hàng đầu", play/shuffle. Reachable from track menus, NowPlaying
  artist name and album header.
- **Search with scopes** (segmented): Bài hát (`/api/spotify/search?q=`), Album
  (`/api/albums/search?q=`), SoundCloud (`/api/soundcloud/search?q=`). Recent searches stored with
  `@AppStorage`. Tapping an album result → `AlbumView` (resolve id via `/api/albums/resolve` if the
  route needs it; read it).
- **Home shelves**: keep Thịnh hành + Mới phát hành; add SoundCloud explore
  (`GET /api/soundcloud/explore?tag=&limit=` → `{tracks, tag}`, a few fixed tags) and, when signed in,
  "Nghe gần đây" + "Yêu thích" shelves.

## Phase 4 — account + polish

- `AccountView`: email, sign out, app version, "Xoá bộ nhớ đệm" (URLCache + resolved-stream cache).
- Pull-to-refresh everywhere, empty states with `ContentUnavailableView`, error alerts in Vietnamese.
- Dark/light correct; Dynamic Type sane; VoiceOver labels on icon-only buttons.

## Out of scope (admin / backend-only — do not build)

announcement POST, approve-email UI, tracks create/update/delete/bulk, upload, drive admin and
drive-folder browsing, song-battles, admin lyrics editor, receipt image export, passkey requests,
SSO handoff, Google sign-in, any YouTube stream workaround.

## Rules for the implementer

- Work on the existing branch `feat/ios-native-app`. The repo has unrelated uncommitted and
  **staged** user changes: never `git add -A`/`git commit -a`; stage and commit only your own paths
  with `git commit -- <paths>`. Never push, never deploy, never touch files outside `ios/`.
- Per CLAUDE.md, run `graphify query "<question>"` before exploring backend code; if the `graphify`
  CLI is missing (it currently is), note that and read files directly.
- After each phase: `cd ios && xcodebuild -scheme BlueSymphony -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 18 Pro' -derivedDataPath build build`
  must print `BUILD SUCCEEDED` with no new warnings in our files, then commit that phase
  (`feat(ios): …`, message ends with the `Co-Authored-By` line given to you).
- Verify in the simulator what can be verified without an account (public screens, signed-out
  states, 401 handling, lyrics, artist, search scopes). You do not have the user's credentials:
  never ask for, guess or type a real password; leave signed-in flows verified by build + code review
  and say so.
- Keep code small and idiomatic SwiftUI (`@Observable`, `async/await`, `NavigationStack`,
  `.task`, `.refreshable`). No third-party packages.
