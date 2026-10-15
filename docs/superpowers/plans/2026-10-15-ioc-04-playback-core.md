# P04 — Playback Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans`; execute checkboxes in order. Hoàn thành từng task bằng changeset riêng.

**Goal:** Logic phát nhạc/queue/fallback chạy được không cần React hoặc DOM, có test trực tiếp.
**Architecture:** Controller giữ một state authority và ownership; source service lo chuẩn bị nguồn; transport/effects/persistence từ P03. P04 test core trước, P05 mới chuyển production wiring và bỏ code cũ.
**Tech Stack:** TypeScript, Vitest fake timers/deferred promises; không thêm package.

## Global Constraints

Phụ thuộc P02/P03 và P00 test map. Áp dụng [design](../specs/2026-10-15-inversion-of-control-design.md). Không sửa PlayerContext hoặc browser lifecycle ở P04; giữ code cũ tạm thời là chủ đích và P05 phải xóa bản trùng. Không copy toàn bộ refs/setters vào một dependency bag.

## Task 1 — Playback source service

**Files:** Create `lib/playback/playbackSourceService.ts`, `sourcePorts.ts`, `__tests__/playbackSourceService.test.ts`; create `components/player/adapters/browserSourceDependencies.ts`.
**Interfaces:** Dùng `PreparedPlayback`, `PlaybackOwner`, `PlaybackClock` từ P03 và `ClientResolutionService` từ P02.

```ts
import type { Track } from '@/types'
import type { PreparedPlayback, PlaybackOwner } from './ports'

export interface SourceRequest {
  owner: PlaybackOwner
  signal: AbortSignal
  initialTime: number
  isCurrent(): boolean
}
export interface PlaybackSourceService {
  peek(track: Track, initialTime?: number): PreparedPlayback | null
  resolve(track: Track, request: SourceRequest): Promise<PreparedPlayback | null>
  recover(track: Track, error: unknown, request: SourceRequest): Promise<PreparedPlayback | null>
  prewarm(queue: Track[], index: number, request: SourceRequest): Promise<void>
  invalidate(track: Track): Promise<void>
  dispose(): void
}
```

- [ ] Đọc `getAudioUrl`, `getAudioUrlCached`, `triggerAdaptivePrewarm`, `fallbackToYouTube`, catalog/emergency branches trong `playTrack`, error handlers và `tryQuickPlayFromCache`. Ghi mapping block → method đích vào P00 map trước khi di chuyển.
- [ ] Định nghĩa `PlaybackSourceDeps` trong `sourcePorts.ts` bằng named properties và chữ ký lấy từ source bằng `typeof` type-only imports: client resolver; `clock`; các hàm đang được gọi từ `nhaccuatuiClient`, `googleDriveUpload`, `youtube`, `searchApi`, `playbackPersistence`; capability `isIOSDevice`, `shouldUseHtml5Audio`, `isFastConnection`; HTTP fetch nếu nhánh SoundCloud cần. Chỉ liệt kê symbol thực sự dùng, không truyền namespace SDK hoặc provider refs. Export `createPlaybackSourceService(deps: PlaybackSourceDeps): PlaybackSourceService`.

Contract khởi điểm cụ thể (narrow function groups, composition truyền object chỉ chứa những hàm được khai báo):

```ts
import type { Track } from '@/types'
import type { PlaybackClock } from './ports'
import type { ClientResolutionService } from '@/lib/stream-resolution/client/contracts'

export interface PlaybackSourceDeps {
  catalog: Pick<ClientResolutionService, 'resolve' | 'invalidate'>
  clock: PlaybackClock
  fetch: typeof globalThis.fetch
  nct: Pick<typeof import('@/lib/nhaccuatuiClient'),
    'getNhacCuaTuiStreamUrl' | 'resolveNhacCuaTuiSong' | 'resolveNhacCuaTuiTrack' |
    'prewarmNctStreamUrl' | 'getCachedNctStreamUrl' | 'clearCachedNctStreamUrl'>
  drive: Pick<typeof import('@/lib/googleDriveUpload'),
    'verifyDriveFile' | 'triggerDrivePrewarm' | 'getClientCdnCache'>
  search: typeof import('@/lib/searchApi').fetchUnifiedSearch
  youtube: Pick<typeof import('@/lib/youtube'), 'fetchViewCountForVideo'>
  persistence: Pick<typeof import('@/lib/playbackPersistence'),
    'saveStreamUrl' | 'getStreamUrl' | 'saveTrackResolution' | 'getCachedYouTubeId'>
  isIOSDevice: typeof import('@/lib/audioPlayback').isIOSDevice
  shouldUseHtml5Audio: typeof import('@/lib/audioPlayback').shouldUseHtml5Audio
  isFastConnection: typeof import('@/components/player/prewarmAdaptive').isFastConnection
  resolveUploadedAudio(track: Track): Promise<string | null>
}
```

Các pure URL builders/matchers/classifiers import trực tiếp. Nếu port một nhánh phát hiện thêm I/O symbol, thêm property có chữ ký thực vào contract và ghi handoff trước P05; không dùng index signature hoặc `any` để bypass.
- [ ] `browserSourceDependencies.ts` là composition của các named functions đó. Pure matching/classification helpers vẫn import trực tiếp; chúng không phải side effects cần inject.
- [ ] Thêm `resolveUploadedAudio(track: Track): Promise<string | null>` vào `PlaybackSourceDeps` cho nhánh Supabase Storage signed/public URL ở `getAudioUrl` hiện tại. Chuyển SDK calls vào browser adapter, giữ TTL và fallback; core không được nhận Supabase client. Trước P05, ghi đủ property names/type signatures của `PlaybackSourceDeps` đã tạo vào handoff để không phải đoán lại.
- [ ] Viết test nguồn direct, catalog, preview rejection, emergency matching, fallback giữ identity/album và stale resolve. Ví dụ core stale-result assertion dùng fixtures P00:

```ts
const late = deferred<PreparedPlayback | null>()
let current = true
const request = {
  owner: { requestId: 1, generation: 1, trackId: 'a' },
  signal: new AbortController().signal, initialTime: 0,
  isCurrent: () => current,
}
// Fake network/provider dependency trả late.promise ở nhánh đang được test.
const pending = source.resolve(makeTrack('a'), request)
current = false
late.resolve({ track: makeTrack('a'), engine: 'html5', target: '/a.wav', initialTime: 0 })
expect(await pending).toBeNull()
```

Nếu fake ở tầng provider trả metadata thay vì `PreparedPlayback`, dùng deferred với kiểu return thực của provider; assertion cuối và lịch race giữ nguyên. Không fake chính `source.resolve` vì test phải chạy production logic.

- [ ] Tách đường `peek` đồng bộ từ quick-play: chỉ đọc cache/direct target hợp lệ, không gọi network hoặc await. Trả `null` nếu chưa đủ dữ liệu; không phát audio từ source service.
- [ ] Giữ cache entry `{ url, ts }`, source TTL, capacity, invalidation aliases và expired signed URLs. `resolve/recover/prewarm` kiểm tra ownership sau mỗi await trước khi ghi cache/queue-visible metadata.
- [ ] `recover` chỉ chuẩn bị target tiếp theo; retry counters theo request và fallback-in-progress thuộc controller/recovery policy, không tự gọi nextTrack hoặc native play.
- [ ] Prewarm giữ throttling, adaptive connection/visibility policy và concurrency hiện tại. Test stale completion không sửa queue hiện tại; source dispose không dispose client resolver default dùng chung.
- [ ] Verify `npm test -- lib/playback/__tests__/playbackSourceService.test.ts lib/__tests__/prewarmPlan.test.ts lib/__tests__/audioUrlCache.test.ts lib/__tests__/playbackFallback.test.ts lib/__tests__/playbackMatchingReliability.test.ts`.

## Task 2 — Ownership và controller store

**Files:** Create `lib/playback/playbackOwnership.ts`, `playbackController.ts`, `controllerTypes.ts`, `playbackState.ts`, `__tests__/playbackController.test.ts`.
**Interfaces:** Dùng ports P03 và source service Task 1. Định nghĩa complete public contract mới:

```ts
import type { Track } from '@/types'
import type {
  PlaybackClock, PlaybackTransport, PlaybackPersistencePort, PlaybackUserEffects, PlaybackOwner,
} from './ports'
import type { PlaybackSourceService } from './playbackSourceService'

export interface PlaybackSnapshot {
  currentTrack: Track | null
  queue: Track[]
  currentIndex: number
  isPlaying: boolean
  isBuffering: boolean
  volume: number
  isShuffle: boolean
  repeatMode: 'off' | 'all' | 'one'
  playbackError: string | null
}
export interface PlaybackProgressSnapshot { currentTime: number; duration: number }
export interface PlaybackController {
  activate(): void
  getOwner(): PlaybackOwner | null
  getSnapshot(): PlaybackSnapshot
  subscribe(listener: () => void): () => void
  getProgress(): PlaybackProgressSnapshot
  subscribeProgress(listener: () => void): () => void
  playTrack(track: Track, queue?: Track[], forceIndex?: number, startFromTime?: number): Promise<void>
  playSearchTrack(track: Track): Promise<void>
  pause(): void
  resume(): Promise<void>
  togglePlay(): Promise<void>
  seek(time: number): void
  setVolume(value: number): void
  nextTrack(): void
  prevTrack(): void
  toggleShuffle(): void
  toggleRepeat(): void
  toggleFavoriteCurrentTrack(): Promise<void>
  addToQueue(track: Track): void
  removeFromQueue(index: number): void
  clearQueue(): void
  restore(): void
  setAutoPlayNext(enabled: boolean): void
  setVisibility(hidden: boolean): void
  complete(reason: string, owner: PlaybackOwner): void
  flushPersistence(): void
  dispose(): void
}
export interface PlaybackControllerDeps {
  source: PlaybackSourceService
  transport: PlaybackTransport
  persistence: PlaybackPersistencePort
  effects: PlaybackUserEffects
  clock: PlaybackClock
  random(): number
}
```

Factory signature: `createPlaybackController(deps: PlaybackControllerDeps): PlaybackController`. Factory không bắt đầu timer/network/native playback/listener. `activate()` idempotent thiết lập transport subscription và công việc định kỳ; composition gọi đúng một lần mỗi controller mới. Test gọi activate trước commands. `getOwner()` trả bản sao token để binding capture khi schedule, không cho mutate nội bộ. Controller đã dispose không activate lại; P05 remount tạo controller mới.

- [ ] Viết test A→B, pause-while-resolving, late play-promise và dispose bằng fake ports. Fake transport ghi event và số lần start/pause; fake source có `peek` trả null và deferred resolve; mỗi fake implements đầy đủ interface, không dùng `as any`.
- [ ] Di chuyển `beginNewPlaybackRequest`, `commitNavigation`, `commitQueue` và guard logic; một token gồm requestId/generation/trackId. Pause đổi desired state đồng bộ trước await; stale continuation chỉ trả về, không stop/pause owner mới.
- [ ] Store publish snapshot mới chỉ khi field đổi; `getSnapshot()` giữ cùng object giữa các lần thay đổi. Progress có snapshot/subscription riêng. Các command functions giữ identity trong suốt instance lifetime.
- [ ] Triển khai fast path trực tiếp, không biến toàn bộ `playTrack` thành await resolve trước native start:

```ts
const prepared = deps.source.peek(track, startFromTime)
if (prepared) {
  // owner được tạo và current track/queue đã commit trước đoạn này.
  const started = deps.transport.start(prepared, owner, volume, 'play')
  await started
  // Chỉ publish playing nếu owner và desired state vẫn hợp lệ.
} else {
  // Gọi resolve với SourceRequest; sau await kiểm tra owner và pause intent.
}
```

- [ ] Test native start được gọi ngay trước khi `playTrack()` trả promise ở cache hit; unresolved request được Pause thì target chỉ load-paused; switching B trong lúc A play promise chờ không khiến A pause B.
- [ ] Dispose revoke owner, abort owned requests, cancel timer/subscriptions. Controller chỉ hủy tài nguyên do nó tạo; composition sở hữu và dispose transport/source/effects/persistence đúng thứ tự P05.

## Task 3 — Queue, completion, recovery và effects

**Files:** Create `lib/playback/queueController.ts`, `completionCoordinator.ts`, `recoveryPolicy.ts`; extend controller; create `lib/playback/__tests__/queueController.test.ts`, `completionCoordinator.test.ts`, `recoveryPolicy.test.ts`.
**Interfaces:** Các module con là private implementation của controller; chỉ `controllerTypes.ts` và factory là API cho P05. Không export mutable queue/refs.

- [ ] Port behavioral cases từ P00 map trước mỗi nhóm: next/prev history stacks, remove-current, clear, repeat-one/all/off, shuffle dùng injected random, search queue isolation, smart-fill seed supersession. Giữ `deduplicateQueueTracks`, `mergeResolvedIntoQueue`, `decideSmartFill` và `shouldRecordSkip` làm pure helpers.
- [ ] `complete(reason, owner)` nhận mọi completion source qua cùng guard. Capture owner khi schedule timer/worker message, không lấy owner mới tại thời điểm nhận phản hồi cũ. Controller tự từ chối token stale. Hai tín hiệu cho cùng lần phát chỉ chuyển bài một lần; repeat-one cần generation mới cho mỗi vòng.
- [ ] Di chuyển counters retry/fallback và auto-skip có giới hạn từ baseline. Test đúng max hiện hành; không tự mở rộng mã lỗi retry hoặc thêm auto-skip mới. Giữ error classification/matching.
- [ ] Tích hợp favorite optimistic update với rollback chỉ cho track/request còn phù hợp; history/listen best-effort, không làm thất bại playback. Giữ debounce tại adapter P03, tránh áp dụng lần hai trong controller.
- [ ] Test smart-fill lỗi/finally cũ không xóa marker mới; ended trong Pause không tự next; stale error không fallback track mới; prewarm không đổi track đang phát; repeat bị Pause rồi Resume vẫn hoàn tất vòng kế tiếp.
- [ ] Chạy toàn `lib/playback/__tests__` và các tests hiện hữu tương ứng trong P00 map. Test cũ vẫn chạy legacy provider cho đến P05; test mới phải chạy factory thật.

**Acceptance:** Core import được trong Node không DOM; dùng fake deps test playback/queue/recovery; không copy VM/AST approach sang suite mới. Không coi P04 là migration production hoàn tất; P05 phải nối core và bỏ ownership trùng.
