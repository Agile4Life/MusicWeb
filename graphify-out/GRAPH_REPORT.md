# Graph Report - D:\MusicWeb  (2026-08-13)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1014 nodes · 2261 edges · 65 communities (51 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f0c91d38`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- createClient
- nhaccuatui.ts
- youtube.ts
- NowPlayingOverlay.tsx
- queueRecommend.ts
- server.cjs
- spotify.ts
- types/index.ts
- PlayerContext.tsx
- app/layout.tsx
- dependencies
- devDependencies
- match-stream/route.ts
- compilerOptions
- googleDriveUpload.ts
- drive-stream-resolver.ts
- albums/page.tsx
- add-cursor.js
- worker/src/index.js
- manifest.json
- credentials.ts
- playlist/[id]/page.tsx
- music-drive-stream-cache/src/index.js
- helper.js
- render-graphs.js
- clean_albums.js
- stop-server.sh
- ToastContext.tsx
- lame.all.js
- Mp3Encoder
- drive-folder/route.ts
- passkey-request/route.ts
- test_smtp.js
- lyrics/route.ts
- proxy.ts
- check_urara_pngs.js
- CustomSelect.tsx
- audius.ts
- check_deezer.js
- start-server.sh
- register/route.ts
- check_album_detail.js
- query_supabase.js
- test_is_real.js
- review-package
- sdd-workspace
- task-brief
- find-polluter.sh
- eslint.config.mjs
- next.config.ts
- postcss.config.mjs

## God Nodes (most connected - your core abstractions)
1. `Track` - 43 edges
2. `createClient()` - 43 edges
3. `usePlayer()` - 32 edges
4. `getValidUserId()` - 31 edges
5. `PlayerProvider()` - 30 edges
6. `searchYouTubeTracks()` - 21 edges
7. `UploadForm()` - 18 edges
8. `useCurrentUser()` - 17 edges
9. `useLanguage()` - 17 edges
10. `isAdmin()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `PlaylistContextType` --references--> `Playlist`  [EXTRACTED]
  components/playlist/PlaylistContext.tsx → types/index.ts
- `ITunesAlbumDetail` --references--> `Track`  [EXTRACTED]
  lib/itunes.ts → types/index.ts
- `PlayerContextType` --references--> `Track`  [EXTRACTED]
  components/player/PlayerContext.tsx → types/index.ts
- `AlbumsPage()` --calls--> `createClient()`  [EXTRACTED]
  app/(app)/albums/page.tsx → lib/supabase/client.ts
- `getNhacCuaTuiTrending()` --indirect_call--> `nhacCuaTuiSearchItemToTrack()`  [INFERRED]
  app/api/search/route.ts → lib/nhaccuatui.ts

## Import Cycles
- None detected.

## Communities (65 total, 14 thin omitted)

### Community 0 - "createClient"
Cohesion: 0.07
Nodes (51): SettingsPage(), AuthForm(), AuthFormProps, translateAuthError(), Window, AuthGuard(), AuthRedirectRouter, scheduleAuthRedirect() (+43 more)

### Community 1 - "nhaccuatui.ts"
Cohesion: 0.06
Nodes (61): GET(), getNctUrl(), GET(), getNctSongUrl(), applyCorsHeaders(), dynamic, GET(), getNctSongUrl() (+53 more)

### Community 2 - "youtube.ts"
Cohesion: 0.07
Nodes (55): dynamic, evictL1IfFull(), extractDriveFileId(), fetchNctSong(), GET(), getSupabaseAdmin(), isPreviewUrl(), l1Cache (+47 more)

### Community 3 - "NowPlayingOverlay.tsx"
Cohesion: 0.07
Nodes (43): OverflowMarqueeText(), OverflowMarqueeTextProps, getHighResCoverUrl(), TrackCoverImage, TrackCoverImageComponent(), TrackCoverImageProps, AudioWaveformScrubber(), AudioWaveformScrubberProps (+35 more)

### Community 4 - "queueRecommend.ts"
Cohesion: 0.07
Nodes (45): cachedResolveResponse(), cleanTitleString(), GET(), getSupabaseClient(), normalizeText(), resolveMemoryCache, GET(), getSupabaseClient() (+37 more)

### Community 5 - "server.cjs"
Cohesion: 0.06
Nodes (56): bootstrapPage(), brandMarkup(), broadcast(), browserLauncherForPlatform(), chmodOwnerOnly(), clients, companionUrl(), computeAcceptKey() (+48 more)

### Community 6 - "spotify.ts"
Cohesion: 0.08
Nodes (41): albumMemoryCache, cachedAlbumResponse(), GET(), getSupabaseClient(), safeSaveAlbumToDb(), touchMemCache(), dynamic, GET() (+33 more)

### Community 7 - "types/index.ts"
Cohesion: 0.15
Nodes (31): AlbumDetail, AlbumDetailPage(), DrivePage(), FavoritesPage(), inferTrackSource(), formatRelativeTime(), HistoryEntry, HistoryPage() (+23 more)

### Community 8 - "PlayerContext.tsx"
Cohesion: 0.10
Nodes (34): inferTrackSource(), isBackgroundPlayableTrack(), isFullYouTubeQueue(), PlaybackProgressContext, PlaybackProgressContextType, PlayerContext, PlayerContextType, PlayerProvider() (+26 more)

### Community 9 - "app/layout.tsx"
Cohesion: 0.09
Nodes (27): inter, jetbrainsMono, metadata, spaceGrotesk, viewport, SessionProvider(), LanguageProvider(), CursorSpotlight() (+19 more)

### Community 10 - "dependencies"
Cohesion: 0.06
Nodes (35): @breezystack/lamejs, clsx, @distube/ytdl-core, lamejs, lottie-web, lucide-react, music-metadata-browser, next (+27 more)

### Community 11 - "devDependencies"
Cohesion: 0.06
Nodes (33): eslint, eslint-config-next, devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/node (+25 more)

### Community 12 - "match-stream/route.ts"
Cohesion: 0.12
Nodes (21): applyCorsHeaders(), dynamic, GET(), getNctSongUrl(), matchCache, OPTIONS(), resolveYouTubeVideoIdForNctSong(), MockVideo (+13 more)

### Community 13 - "compilerOptions"
Cohesion: 0.07
Nodes (28): dom, dom.iterable, esnext, **/*.mts, .next/dev/types/**/*.ts, next-env.d.ts, .next/types/**/*.ts, node_modules (+20 more)

### Community 14 - "googleDriveUpload.ts"
Cohesion: 0.16
Nodes (24): formatFileSize(), GoogleDriveUpload(), cleanSongArtist(), cleanSongTitle(), formatDuration(), formatFileSize(), QueueItem, trackDuplicateKey() (+16 more)

### Community 15 - "drive-stream-resolver.ts"
Cohesion: 0.15
Nodes (19): dynamic, GET(), dynamic, POST(), dynamic, GET(), HEAD(), CachedCdnEntry (+11 more)

### Community 16 - "albums/page.tsx"
Cohesion: 0.15
Nodes (10): AlbumCard(), AlbumCardProps, AlbumsPage(), cachedListenedAlbums, cachedNewReleases, HeroCardSkeleton(), TrackListSkeleton(), TiltCard() (+2 more)

### Community 17 - "add-cursor.js"
Cohesion: 0.15
Nodes (14): allFiles, args, crc32(), destDir, dibToPng(), fileMap, fs, getFrame0FromAni() (+6 more)

### Community 18 - "worker/src/index.js"
Cohesion: 0.30
Nodes (15): baseHeaders(), CORS, fetch(), fetchFullOrigin(), handleHead(), handleStream(), headerOnly(), json() (+7 more)

### Community 19 - "manifest.json"
Cohesion: 0.14
Nodes (13): background_color, categories, description, display, icons, name, orientation, scope (+5 more)

### Community 20 - "credentials.ts"
Cohesion: 0.19
Nodes (6): handler, authorizePasswordCredentials(), PasswordCredentials, SupabasePasswordClient, SupabasePasswordClientFactory, authOptions

### Community 21 - "playlist/[id]/page.tsx"
Cohesion: 0.26
Nodes (10): PlaylistDetailPage(), compressAudioIfNeeded(), convertPcmCooperatively(), encodeInWorker(), encodeOnMainThread(), CacheItem, fetchUnifiedSearch(), inFlightRequests (+2 more)

### Community 22 - "music-drive-stream-cache/src/index.js"
Cohesion: 0.35
Nodes (12): baseHeaders(), CORS, fetch(), handleHead(), handleStream(), headerOnly(), json(), parseRange() (+4 more)

### Community 23 - "helper.js"
Cohesion: 0.42
Nodes (7): connect(), nextReconnectDelay(), reloadAfterRecovery(), sessionKey(), setStatus(), showTombstone(), websocketUrl()

### Community 24 - "render-graphs.js"
Cohesion: 0.33
Nodes (8): combineGraphs(), { execSync }, extractDotBlocks(), extractGraphBody(), fs, main(), path, renderToSvg()

### Community 25 - "clean_albums.js"
Cohesion: 0.22
Nodes (7): { createClient }, envContent, envPath, envVars, fs, path, supabase

### Community 26 - "stop-server.sh"
Cohesion: 0.43
Nodes (4): command_has_server_id(), is_brainstorm_server(), mark_stopped(), stop-server.sh script

### Community 27 - "ToastContext.tsx"
Cohesion: 0.29
Nodes (5): ToastContext, ToastContextType, ToastItem, ToastProvider(), ToastType

### Community 28 - "lame.all.js"
Cohesion: 0.29
Nodes (5): NOTE: i and j are used opposite as in the ISO docs, NOTE: the bitrate reduction from the inter-channel masking effect is low, FIXME: it does work to reduce low-freq problems in S53-Wind-Sax, TODO: Further refinement of the shape of this hack., NOTE: enabling the NEW_DRAIN code fixes some problems with FhG

### Community 29 - "Mp3Encoder"
Cohesion: 0.29
Nodes (3): @breezystack/lamejs, lamejs, Mp3Encoder

### Community 30 - "drive-folder/route.ts"
Cohesion: 0.53
Nodes (5): decodeUnicodeEscapes(), fetchDriveFileRealName(), folderCache, FolderCacheEntry, GET()

### Community 31 - "passkey-request/route.ts"
Cohesion: 0.40
Nodes (3): getValidPasskeys(), POST(), IMPORTANT: Do NOT use httpOnly — both client JS and server need to read this…

### Community 32 - "test_smtp.js"
Cohesion: 0.33
Nodes (4): envPath, fs, nodemailer, path

### Community 33 - "lyrics/route.ts"
Cohesion: 0.70
Nodes (4): cleanHtmlEntities(), fetchLyricsFromYouTube(), GET(), searchYouTubeVideoIds()

### Community 34 - "proxy.ts"
Cohesion: 0.60
Nodes (3): updateSession(), config, proxy()

### Community 35 - "check_urara_pngs.js"
Cohesion: 0.40
Nodes (4): fs, items, path, zlib

### Community 38 - "audius.ts"
Cohesion: 0.83
Nodes (3): getAudiusHost(), getTrendingAudiusTracks(), searchAudiusTracks()

## Knowledge Gaps
- **262 isolated node(s):** `AuthFormProps`, `Window`, `AuthRedirectRouter`, `CurrentUserContextType`, `NoteItem` (+257 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Track` connect `types/index.ts` to `createClient`, `nhaccuatui.ts`, `youtube.ts`, `queueRecommend.ts`, `audius.ts`, `spotify.ts`, `PlayerContext.tsx`, `albums/page.tsx`, `playlist/[id]/page.tsx`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `createClient()` connect `createClient` to `types/index.ts`, `PlayerContext.tsx`, `googleDriveUpload.ts`, `albums/page.tsx`, `playlist/[id]/page.tsx`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `usePlayer()` connect `types/index.ts` to `createClient`, `NowPlayingOverlay.tsx`, `PlayerContext.tsx`, `albums/page.tsx`, `playlist/[id]/page.tsx`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `AuthFormProps`, `Window`, `AuthRedirectRouter` to the rest of the system?**
  _262 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `createClient` be split into smaller, more focused modules?**
  _Cohesion score 0.06670584778136938 - nodes in this community are weakly interconnected._
- **Should `nhaccuatui.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05664556962025316 - nodes in this community are weakly interconnected._
- **Should `youtube.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06845238095238096 - nodes in this community are weakly interconnected._