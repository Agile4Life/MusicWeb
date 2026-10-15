# P05 — React and Browser Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans`; execute checkboxes in order. Agent này độc quyền sửa PlayerContext trong migration.

**Goal:** Production PlayerProvider sử dụng core P04; browser integration có lifecycle rõ và test cũ giữ coverage.
**Architecture:** Client composition nối adapters và controller; React chỉ subscribe snapshots, giữ UI state và DOM host. Một runtime bridge ổn định cung cấp commands/subscriptions qua các lần effect setup/cleanup.
**Tech Stack:** React 19 hooks/useSyncExternalStore, Next Client Components, Playwright reliability fixtures.

## Global Constraints

Phụ thuộc P04 đã xanh và P00 coverage map. Áp dụng [design](../specs/2026-10-15-inversion-of-control-design.md). Đọc Next server/client guide; không truyền service/function qua boundary serialize. Không đổi public hooks, DOM audio attributes, YouTube host dimensions, theme/cursor behavior hoặc UX.

## Task 1 — Runtime composition và browser bindings

**Files:** Create `components/player/runtime/createPlayerRuntime.ts`, `browserLifecycle.ts`, `mediaSessionBinding.ts`, `youtubeBinding.ts`, `__tests__/runtimeLifecycle.test.ts`, `__tests__/mediaSessionBinding.test.ts`.
**Interfaces:**

```ts
import type { PlaybackController, PlaybackSnapshot, PlaybackProgressSnapshot } from '@/lib/playback/controllerTypes'

export interface PlayerRuntime {
  mount(elements: { audio: HTMLAudioElement; youtubeHostId: string }): void
  unmount(): void
  getSnapshot(): PlaybackSnapshot
  getProgress(): PlaybackProgressSnapshot
  subscribe(listener: () => void): () => void
  subscribeProgress(listener: () => void): () => void
  commands: Pick<PlaybackController,
    'playTrack' | 'playSearchTrack' | 'togglePlay' | 'seek' | 'setVolume' |
    'nextTrack' | 'prevTrack' | 'toggleShuffle' | 'toggleRepeat' |
    'toggleFavoriteCurrentTrack' | 'addToQueue' | 'removeFromQueue' | 'clearQueue'>
}
```

Factory `createPlayerRuntime` nhận browser composition dependencies và getters cho session hiện tại. Object bridge được tạo thuần, không chạm DOM/network/timer; `mount` tạo native bindings và fresh controller. `unmount` cleanup instance cũ; bridge và command functions giữ identity. Methods khi chưa mount: read trả stable initial snapshot; async commands resolve không tác động, sync commands no-op. Không tự queue stale user commands để chạy sau remount.

`mount` gọi controller `activate()` sau khi adapters sẵn sàng, rồi `restore()` theo behavior baseline. Binding dùng `getOwner()` lúc schedule để capture token và gọi `complete(reason, capturedOwner)`; worker payload/reply cần mang generation nếu hiện tại chỉ mang trackId. Đây là wiring ownership, không thay completion policy.

- [ ] Test mount → unmount → mount dùng factories giả: một controller active, một bộ listeners, disposal đúng một lần mỗi instance; commands bridge giữ cùng identity; completion từ runtime cũ bị drop.
- [ ] Di chuyển YouTube script/player init và callbacks vào `youtubeBinding.ts`. Tách SDK script lifetime dùng chung khỏi player instance lifetime; cleanup không xóa callback/script còn owner khác dùng. Giữ pending ready/start, video ID checking và các branch error hiện hành.
- [ ] Di chuyển native audio event wiring, WebAudio gain, visibility/pagehide, near-end/watchdog, background worker và service-worker message vào browser lifecycle. Browser callback capture owner/session và gọi controller; không tạo state machine thứ hai trong binding.
- [ ] Media Session gọi controller pause/resume/seek/next/prev; metadata lấy snapshot và effective duration. Giữ seek handler restrictions, position cadence, offset và playbackState logic hiện tại. Cleanup gỡ handlers/interval đúng instance.
- [ ] `user_settings.auto_play`, Supabase storage URL resolution và external-track favorite ID phải nằm trong browser adapters/composition. Không bỏ sót các dependency này khi xóa Supabase khỏi provider. Session getters phải đọc trạng thái mới khi login/logout; không capture user tại mount mãi mãi.
- [ ] Teardown order: flush persistence → detach OS/DOM/worker listeners/timers → controller.dispose (revoke owner) → source/transport/effects/persistence dispose. Cleanup pending events vẫn phải thấy owner invalid; nếu có async gap, revoke owner trước gap. Không dispose client resolver default dùng chung.
- [ ] Binding factory không làm việc trong React render. Strict Mode cleanup phải cho lần setup thứ hai tạo controller/adapters mới, không tái dùng instance đã disposed.

## Task 2 — React bridge và chuyển wiring

**Files:** Modify `components/player/PlayerContext.tsx`, `PlaybackProgressStore.ts`; create `components/player/playerContextTypes.ts`, `usePlayerRuntime.ts`, `playerViewStore.ts`.
**Interfaces:** Di chuyển nguyên types public từ PlayerContext sang `playerContextTypes.ts`; re-export tại đường dẫn cũ. Giữ tất cả hook signatures. Runtime commands P04/P05 map vào existing context controls.

- [ ] Trước khi thay provider, hoàn tất test core/bindings cho từng group sẽ xóa; ghi P00 map tên test đích. Không xóa helper AST còn test khác dùng.
- [ ] `usePlayerRuntime` tạo pure bridge một lần, effect mount/unmount sau khi refs sẵn. Stable wrappers gọi current runtime, không đóng trên volatile state. Bridge không là state authority; snapshot từ controller là nguồn duy nhất.
- [ ] Tạo projections riêng cho track và queue. Cache projection object theo các trường thực sự thay đổi, tránh `getSnapshot` trả object mới mỗi lần. Progress subscription không notify controls/queue. Ví dụ thuật toán projection:

```ts
// Projection được cập nhật khi controller publish, không tạo object trong getSnapshot.
const previous = trackSnapshot
if (previous.currentTrack !== next.currentTrack ||
    previous.isPlaying !== next.isPlaying ||
    previous.isBuffering !== next.isBuffering ||
    previous.volume !== next.volume ||
    previous.isShuffle !== next.isShuffle ||
    previous.repeatMode !== next.repeatMode ||
    previous.playbackError !== next.playbackError) {
  trackSnapshot = {
    currentTrack: next.currentTrack, isPlaying: next.isPlaying,
    isBuffering: next.isBuffering, volume: next.volume,
    isShuffle: next.isShuffle, repeatMode: next.repeatMode,
    playbackError: next.playbackError,
  }
  notifyTrackSubscribers()
}
```

`playerViewStore.ts` định nghĩa và test các snapshot/subscriber lists trên; React bổ sung `frequencyData`, `audioRef`, `mvIntroOffset` vào public track context bằng useMemo.

- [ ] `usePlaybackProgress()` đọc runtime progress instance qua context. `PlaybackProgressStore.ts` giữ class/helper exports đang có caller thật, bỏ singleton coupling sau import audit. Tại baseline không có production caller trực tiếp ngoài PlayerContext, nhưng phải kiểm tra lại trước khi xóa. Stable server snapshot `{currentTime: 0, duration: 0}` là constant, không tạo object mỗi getServerSnapshot.
- [ ] Giữ UI-only state: queue drawer/open overlay, frequency animation, toast, SponsorBlock intro display và `data-buffering` attribute ở React/hooks riêng. Chúng không được điều khiển playback ownership. Giữ existing behavior khi hidden/tab background.
- [ ] Chuyển toàn bộ play/queue/fallback commands sang runtime; xóa state/refs/callback cũ đã thay. Không mirror queue/currentTrack trong React `useState` rồi sync ngược controller bằng effect.
- [ ] Giữ `<audio>` và YouTube host hiện có; không thay key khiến native element remount mỗi track. Giữ `preload`, `playsInline`, `crossOrigin`, `webkit-playsinline` và kích thước host khác 0.

## Task 3 — Thay AST tests bằng behavior và integration tests

**Files:** Modify các test trong `components/player/__tests__` được P00 map; create `components/player/runtime/__tests__/playerViewStore.test.ts`; modify `tests/e2e/playback_reliability.spec.ts` và helpers chỉ nếu cần mở rộng fixture coverage.
**Interfaces:** Test runtime qua factories/fake ports; browser fixture qua UI, không thêm debug endpoint public hoặc dev-only provider route vào production app.

- [ ] Đổi `controlsContextStability` từ regex sang assert command references trước/sau state change; test track-only update không notify queue projection, progress-only update không notify controls/track/queue projections.
- [ ] Core test kiểm tra `getSnapshot` referential equality giữa hai read không có update; subscribe/unsubscribe không duplicate callback; unmount/remount không bỏ subscription mới.
- [ ] Browser fixture kiểm tra controls-only consumer/render counts khi progress chạy. Nếu cần instrument, dùng test fixture/harness hiện có; không đo bằng regex source. Giữ assertion người dùng thấy track/queue/playing/progress đúng.
- [ ] Port từng test VM về module tương ứng; chỉ xóa `productionCallbacks.cjs` khi `rg 'productionCallbacks' components lib tests` không còn caller. Với static architectural tests còn giá trị, cập nhật import-boundary assertion thay vì phụ thuộc tên callback nội bộ.
- [ ] Chạy:

```powershell
npm test -- lib/playback components/player/__tests__ components/player/runtime components/player/adapters
npx playwright test --config playback_reliability.config.ts
npx tsc --noEmit --incremental false
npx eslint components/player lib/playback
```

- [ ] So baseline P00 cho mọi fail/skip; browser config không có WebKit thì ghi `not available`. Không sử dụng Chromium với autoplay bypass để kết luận user gesture iOS đã được chứng minh.

**Acceptance:** PlayerContext chỉ composition/subscription/UI state/DOM hosts; controller là owner duy nhất. Không mất test coverage khi bỏ AST; quick-play sync, pause races, engine switch, restore và completion giữ nguyên. Bàn giao P07 với mapping cũ → mới và browser evidence.
