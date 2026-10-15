# IoC test coverage map

Baseline: `cc5b3d3` (P00 recorded in `212d3af`). Updated after P01–P06 implementation on branch `refactor/ioc-p04-p07`.

Classification after P01–P06 migration:
- All former AST/VM suites that relied on `components/player/__tests__/helpers/productionCallbacks.cjs` (`playbackOwnership.test.ts`, `backgroundCompletion.test.ts`) have been migrated to behavioral runtime tests against the real `createPlaybackController`, `createPlaybackSourceService`, `createBrowserTransport`, `bindBrowserLifecycle`, `bindYouTubeIframe`, and `createWebAudioGainManager` implementations, and `productionCallbacks.cjs` has been removed.
- Former static regex / local simulation suites (`playbackInvariants.test.ts`, `nctPlaybackRaceGuards.test.ts`, `playerSafetyGuards.test.ts`, `mediaSession.test.ts`, `searchQueueIsolation.test.ts`, `controlsContextStability.test.ts`, `playerPrewarmThrottling.test.ts`) now execute the real production `createPlaybackController`, `createPlaybackSourceService`, `createPlayerViewStore`, and `bindMediaSession` modules with deterministic ports.
- Dedicated unit suites were added for P01 (`lib/stream-resolution/server/__tests__/**`, `app/api/resolve-stream/__tests__/httpContract.test.ts`), P02 (`lib/stream-resolution/client/__tests__/clientResolutionService.test.ts`), P03 (`components/player/adapters/__tests__/**`), P04 (`lib/playback/__tests__/**`), P05 (`components/player/runtime/__tests__/**`), and P06 (`lib/search/__tests__/searchRequests.test.ts`, `lib/playlist/__tests__/playlistRepository.test.ts`).

## P04/P05 request ownership

### `components/player/__tests__/playbackOwnership.test.ts`

Method: Behavioral runtime execution of `createPlaybackController`, `createPlaybackSourceService`, `createBrowserTransport`, `bindYouTubeIframe`, and `createWebAudioGainManager` with deterministic clock/transport/source ports (replaced `productionCallbacks.cjs` AST/VM extraction). Destination: P04/P05 request ownership.

- keeps paused state and source if the pending play rejects
- does not restart a paused iframe on a late buffering event
- does not reload an iframe after Pause during error invalidation
- can complete another repeat loop after pausing an in-flight replay
- keeps OS pause when a previous OS play promise finishes
- keeps a recovered stream paused if Pause arrives during fallback
- never pauses a new owner when quick-play finishes late
- never pauses B when A play resolves after B
- drops fallback after invalidation yields ownership to B
- does not carry a resolving A seek into B
- honors pause while resolving the main stream
- replays repeat-one for successive actual endings
- does not advance intentionally paused audio near EOF on foreground
- does not resume pending audio after pause on foreground/canplay/activation
- applies volume once after connecting Web Audio
- preserves playback position on fallback only when candidate duration matches within 8s
- skips redundant 4s NCT local-proxy retry when audio.src is already on local proxy
- preserves consecutiveSkipRef across error auto-skip while resetting on manual navigation
- caches SoundCloud catalog resolution and warms audioUrlCacheRef in triggerAdaptivePrewarm
- pre-resolves iTunes 30s preview tracks in triggerAdaptivePrewarm instead of treating apple.com preview URL as direct playable
- synchronously quick-plays pre-resolved tracks in background/iOS when audioUrlCacheRef misses, resets nextTrackEndPrewarmedRef, and chains triggerAdaptivePrewarm
- resumes WebKit interrupted AudioContext state in ensureWebAudioGain
- advances track when Safari fires pause at EOF before or instead of ended in background
- does not trigger a premature 1200ms auto-skip in handleError when playTrack catch has already started fallbackToYouTube
- falls through to YouTube IFrame Player on iOS when /api/yt-stream fails in fallbackToYouTube and clears stale provider IDs
- falls through to YouTube IFrame Player in playTrack on iOS when direct YouTube HTML5 stream proxy fails

### `components/player/__tests__/playbackInvariants.test.ts`

Method: Behavioral runtime execution of `createPlaybackController` and `createPlayerViewStore` (replaced static source assertions). Destination: P04/P05 request ownership.

- only commitQueue calls setQueue (ref and state can never diverge)
- removeFromQueue does not filter the already-filtered queue a second time
- both playTrack and quick-play report the skipped track
- playTrack never assigns onto the caller-provided rawTrack
- does not use a boolean in-flight flag that drops newer seeds

### `components/player/__tests__/nctPlaybackRaceGuards.test.ts`

Method: Behavioral runtime execution of `createPlaybackController` (first three cases) and `nhaccuatuiClient` (final case). Destination: P04/P05 request ownership.

- prevents duplicate concurrent fallbackToYouTube calls for the exact same requestId (Mutex Guard)
- aborts the 4000ms NCT retry waiting period early (<100ms) when the retry stream fails immediately
- cancels the pending audioStallWatchdog timer immediately on stream error
- prevents an in-flight prewarm promise from re-populating the cache after clearCachedNctStreamUrl

### `components/player/__tests__/playerSafetyGuards.test.ts`

Method: Behavioral runtime execution of `createPlaybackController`, `createPlaybackSourceService`, and `PlaybackPersistenceScheduler` (replaced local guard simulations). Destination: P04/P05 request ownership.

- correctly windows large queues (>150 items) around currentIndex to prevent index overflow
- correctly verifies YouTube video matching with fallback to ytLoadedIdRef
- circuit breaker prevents infinite skip loop when consecutive errors reach MAX_CONSECUTIVE_SKIPS (4)
- ensures restored player state on mount initializes audio ownership token matching the restored track ID
- ensures togglePlay resume keeps ownership token aligned when resuming pre-loaded audio
- prevents play/pause spam race conditions by serializing action IDs and desired play state
- Universal audio stall watchdog triggers YouTube fallback for Drive/local tracks when stalled > 6500ms
- Circuit breaker counter resets cleanly to 0 when playback becomes stable

## P04/P05 completion and OS

### `components/player/__tests__/backgroundCompletion.test.ts`

Method: Behavioral runtime execution of `createPlaybackController` and `bindBrowserLifecycle` with deterministic worker/timer/DOM stubs (replaced `productionCallbacks.cjs` AST/VM extraction). Destination: P04/P05 completion and OS.

- advances at EOF through worker messages even when window timers and ended are delayed
- does not advance after %s
- stops worker ticking when the tab becomes visible and terminates on cleanup
- retains timer recovery when worker support is %s
- retains timer recovery after the worker fails to load
- checks the new track after a late tick rather than completing the previous owner
- does not let a stale YouTube iframe complete the active HTML5 track
- advances the active YouTube iframe at EOF
- repeats the current track once when duplicate EOF ticks arrive together

### `components/player/__tests__/backgroundCompletionWorker.test.ts`

Method: Full production worker executed in `runInNewContext` with fake timers. Destination: P04/P05 completion and OS.

- ticks only while hidden, avoids duplicate timers, and restarts after becoming hidden again

### `components/player/__tests__/mediaSession.test.ts`

Method: Behavioral runtime execution of `bindMediaSession` + `createPlaybackController` (replaced local handler simulation). Destination: P04/P05 completion and OS.

- registers nexttrack and previoustrack while keeping seekforward and seekbackward null for Safari compatibility
- synchronizes desiredPlayStateRef intent when background lock-screen actions are dispatched

## P04 queue

### `components/player/__tests__/searchQueueIsolation.test.ts`

Method: Behavioral runtime execution of `controller.playSearchTrack` on `createPlaybackController` (replaced local queue simulation). Destination: P04 queue.

- initializes a single-track queue when searching on an empty queue
- inserts searched track after the currently playing song without wiping existing playlist
- does not duplicate track if it already exists in the queue
- handles multiple consecutive search selections without queue wipe

### `lib/__tests__/queueSync.test.ts`

Method: Runtime exported mergeResolvedIntoQueue. Destination: P04 queue.

- merges resolved fields into the matching entry only
- does not lose tracks appended after the snapshot was taken (smart-fill race)
- follows the track by id when its index shifted
- returns the same reference when the track is no longer in the queue

### `lib/__tests__/queueRecommend.test.ts`

Method: Runtime exported recommendation helpers with fixtures. Destination: P04 queue.

- normalizes Vietnamese diacritics and bracketed metadata
- normalizes remix and audio suffixes
- prefers ISRC key when present
- falls back to metadata key when ISRC is missing
- returns only source-matched prefixed variants for spotify track
- returns nct- prefix only for nhaccuatui source
- returns sc- prefix only for soundcloud source
- returns raw id and source_id for internal_history source
- correctly maps NhacCuaTui Track to QueueTrack and back
- correctly maps SoundCloud Track to QueueTrack and back
- correctly maps Deezer QueueTrack back preserving source=deezer
- does NOT reject words that merely contain a negative keyword substring
- rejects exact negative keyword matches
- allows genre keywords when passed as allowedKeywords
- still rejects other negative keywords even with allowedKeywords
- deduplicates identical tracks and merges score_reasons
- limits candidates per artist to maxPerArtist
- interleaves exploration items into ranked pool

## P05 context and progress

### `components/player/__tests__/controlsContextStability.test.ts`

Method: Behavioral runtime identity assertions on `createPlayerViewStore` + `createPlaybackController` across track, queue, and progress transitions (replaced static regex). Destination: P05 context and progress.

- finds the controls members
- `playTrack does not depend on volatile state` (behavioral identity check)
- `playSearchTrack does not depend on volatile state` (behavioral identity check)
- `togglePlay does not depend on volatile state` (behavioral identity check)
- `seek does not depend on volatile state` (behavioral identity check)
- `setVolume does not depend on volatile state` (behavioral identity check)
- `nextTrack does not depend on volatile state` (behavioral identity check)
- `prevTrack does not depend on volatile state` (behavioral identity check)
- `toggleShuffle does not depend on volatile state` (behavioral identity check)
- `toggleRepeat does not depend on volatile state` (behavioral identity check)
- `toggleFavoriteCurrentTrack does not depend on volatile state` (behavioral identity check)
- `addToQueue does not depend on volatile state` (behavioral identity check)
- `removeFromQueue does not depend on volatile state` (behavioral identity check)
- `clearQueue does not depend on volatile state` (behavioral identity check)

### `components/player/__tests__/playerProgressDecoupling.test.ts`

Method: First two cases run production store; third simulates render behavior without React. Destination: P05 context and progress.

- notifies subscribers only when progress values change
- resets progress cleanly on track change
- allows parent provider to remain completely unaffected by high-frequency time updates

### `components/player/__tests__/playerContextSplit.test.ts`

Method: Export availability only, no mounted provider. Destination: P05 context and progress.

- exports all granular and unified player hooks

## P03/P05 persistence

### `components/player/__tests__/playbackPersistenceDebounce.test.ts`

Method: Production scheduler/minimal-track helpers; final progress-position case simulates getter logic. Destination: P03/P05 persistence.

- Case 1: Retains up to 150 items with minimal track structure
- Case 2: Debounces continuous playback writes (15s cadence / idle callback)
- Case 3: Immediate flush on iOS pagehide & visibilitychange (hidden) without losing progress
- Case 4: Reads position directly from currentTime ref/getter, decoupled from React state

### `lib/__tests__/playbackPersistence.test.ts`

Method: Runtime production persistence with fake storage. Destination: P03/P05 persistence.

- writes a bounded new queue and preserves the selected track beyond index 50
- counts UTF-8 bytes rather than string characters
- evicts old cache entries from the incoming payload
- bounds resolution cache payloads as well as stream URLs
- preserves selected tracks at queue boundary %s
- preserves previous valid storage when the selected track alone cannot fit
- retries quota failures with the new queue rather than restoring stale playback

### `lib/__tests__/audioUrlCache.test.ts`

Method: Runtime production TTL helpers. Destination: P03/P05 persistence.

- uses shorter TTLs for signed-URL sources
- uses the default TTL for stable sources
- returns a fresh entry
- rejects and evicts an expired SoundCloud URL even though the default TTL has not elapsed
- rejects an expired NCT URL
- returns null for a missing entry or missing id
- refreshes LRU order on a fresh hit

## P04 prewarm

### `components/player/__tests__/playerPrewarmThrottling.test.ts`

Method: Behavioral runtime execution of `isFastConnection`, `createPlaybackSourceService`, and `createPlaybackController` (5s stable playback gate + single next track prewarm). Destination: P04 prewarm.

- Network Gate: rejects prewarming if saveData is enabled
- Network Gate: rejects prewarming on slow connections (2g, 3g, slow-2g)
- Throttling: Only schedules prewarm for single next track (currentIndex + 1)

### `lib/__tests__/prewarmPlan.test.ts`

Method: Runtime production planner/request supersession. Destination: P04 prewarm.

- returns up to 3 tracks after the current index
- never goes past the end of the queue and excludes the current track
- returns nothing on a slow connection (saveData / 2g / 3g)
- handles invalid input safely
- dedupes repeated ids and skips the current track id if repeated
- respects a custom count
- aborts the previous signal when a new request begins
- abort() cancels the active request and is idempotent
- actually cancels an in-flight fetch-like promise (rapid skip scenario)
- recognises AbortError by name or message
- rejects unrelated errors

## P01/P02 cache

### `lib/__tests__/resolveStreamCacheOwnership.test.ts`

Method: Production facade with mocked network/storage. Destination: P01/P02 cache.

- bypasses an older HTTP response on a normal network resolution
- reaches the server for eager invalidation and the subsequent forced refresh
- does not persist stale response %j over a refreshed resolution
- clears both 4-part and 3-part YouTube ID aliases upon invalidateStreamResolution

### `app/api/resolve-stream/__tests__/cacheOwnership.test.ts`

Method: Production route GET with mocked DB/providers. Destination: P01/P02 cache.

- prevents HTTP caching of successful resolutions with invalidate=%s
- reuses a validated L1 hit without resolving upstream again
- keeps newer pending resolution deduplicated after an invalidated request completes
- does not promote an L2 read that crossed invalidation
- applies late NCT promotion after the initial fallback and awaits thenable writes
- ignores late promotion from an invalidated generation
- serializes an already-started old write before invalidation and fresh persistence
- invalidates L1 even when Supabase is unavailable

### `app/api/resolve-stream/__tests__/distributedCache.test.ts`

Method: Two production route modules with shared fake DB. Destination: P01/P02 cache.

- invalidates the other instance cached L1 before reusing it
- rejects an old in-flight result from another instance after invalidation
- rejects late preferred publication owned by a revoked shared version
- observes a preferred upgrade on another instance within the same version
- bypasses shared and legacy caches when RPC is missing
- does not serve coordinated L1 without a fresh shared version during DB outage
- does not reuse revoked in-flight work while the shared version is unavailable
- compares a delayed retry against the latest observed generation
- resolves fresh audio despite a stalled cache %s

### `lib/__tests__/serverStreamResolutionCache.test.ts`

Method: Production helpers and actual SQL functions in embedded PGlite. Destination: P01/P02 cache.

- reads and publishes using the real SQL protocol with database expiry
- preserves bigint generation text for both RPC responses
- awaits an RPC PromiseLike with no catch method
- returns unavailable when either RPC reports missing migration or transport failure
- treats a malformed read response as unavailable (%j)
- accepts a well-formed shared miss with its database expiry
- treats a malformed write response as unavailable (%j)
- does not publish malformed entries or generation tokens
- bounds a stalled %s RPC and aborts its transport
- creates a persistent generation on the first read
- rejects an old instance publication after another instance invalidates
- rejects stale late preferred NCT even after a fresh fallback is published
- keeps a valid hit when another resolver publishes a miss
- does not downgrade %s to %s in the same generation
- allows a late preferred result to replace a fallback or miss
- ignores caller expiry and gives hits 30 days and misses one hour
- hides expired payloads while retaining generation and allows replacement
- increments on every invalidation including a key with no cached payload
- does not round bigint generations through a JavaScript number
- isolates all three identity fields
- is rerunnable without resetting generations or touching legacy cache
- denies %s execution of either RPC and direct table access
- enables RLS and allows the service role only through the privileged RPCs
- refreshes another instance L1 after a real SQL invalidation
- rejects old in-flight and late preferred writes through actual SQL

## New IoC unit suites added in P01–P06

### P01 Server Resolution (`lib/stream-resolution/server/__tests__/**`, `app/api/resolve-stream/__tests__/httpContract.test.ts`)
- `lib/stream-resolution/server/__tests__/catalogResolver.test.ts` (4 tests): NCT preferred + YouTube fallback, late NCT promotion, SoundCloud primary + fallback, YouTube streamUrl construction.
- `lib/stream-resolution/server/__tests__/serverResolutionService.test.ts` (12 tests): L1/shared/L2 coordination, SoundCloud L2 revalidation, generation ownership, invalidation, late promotion.
- `app/api/resolve-stream/__tests__/httpContract.test.ts` (7 tests): HTTP query parsing, validation, Cache-Control headers, status codes.

### P02 Client Resolution (`lib/stream-resolution/client/__tests__/clientResolutionService.test.ts`)
- `lib/stream-resolution/client/__tests__/clientResolutionService.test.ts` (7 tests): L1/localStorage cache, SoundCloud `/api/soundcloud/stream` revalidation, generation supersession, 3-part & 4-part YouTube alias invalidation, batch prewarm.

### P03 Playback Adapters (`components/player/adapters/__tests__/**`)
- `components/player/adapters/__tests__/browserTransport.test.ts` (9 tests): HTML5 and YouTube engine routing, stale owner suppression, cleanup symmetry.
- `components/player/adapters/__tests__/browserPersistence.test.ts` (3 tests): restore/save/flush/repeat delegation.
- `components/player/adapters/__tests__/browserUserEffects.test.ts` (7 tests): history/listen recording, favorite optimistic rollback, AbortSignal recommendation supersession.
- `components/player/adapters/__tests__/persistenceScheduler.test.ts` (2 tests): debounce timer and immediate flush cancellation.

### P04 Playback Core (`lib/playback/__tests__/**`)
- `lib/playback/__tests__/playbackSourceService.test.ts` (5 tests): direct/cached immediate resolution, playable resolution, YouTube fallback, adaptive prewarm, restored track hydration.
- `lib/playback/__tests__/queueController.test.ts` (4 tests): playSearchTrack insertion, queue windowing (>150 items), removeFromQueue, mergeResolvedIntoQueue.
- `lib/playback/__tests__/completionCoordinator.test.ts` (3 tests): repeat-one deduplication, repeat-all wrap, normal completion.
- `lib/playback/__tests__/recoveryPolicy.test.ts` (3 tests): circuit breaker (`MAX_CONSECUTIVE_SKIPS = 4`), NCT retry decision, fallback position preservation within 8s duration delta.
- `lib/playback/__tests__/playbackController.test.ts` (4 tests): quick-play, request supersession, pause during resolution, duplicate completion suppression.

### P05 React & Browser Runtime (`components/player/runtime/__tests__/**`)
- `components/player/runtime/__tests__/runtimeLifecycle.test.ts` (1 test): symmetric registration and cleanup of document/window/worker/timer listeners.
- `components/player/runtime/__tests__/mediaSessionBinding.test.ts` (1 test): MediaSession action handler registration, Safari null seekbackward/seekforward, cleanup.
- `components/player/runtime/__tests__/playerViewStore.test.ts` (1 test): controls reference stability and slice isolation across progress/track/queue updates.

### P06 Search & Playlist (`lib/search/__tests__/**`, `lib/playlist/__tests__/**`)
- `lib/search/__tests__/searchRequests.test.ts` (3 tests): empty query cancellation, superseded request abortion, clean state on latest success.
- `lib/playlist/__tests__/playlistRepository.test.ts` (4 tests): unauthenticated guard, playlist hydration, duplicate track check, cover update on first track.
