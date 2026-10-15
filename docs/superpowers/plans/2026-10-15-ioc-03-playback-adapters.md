# P03 — Playback Ports and Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans`; execute checkboxes in order.

**Goal:** Tạo seam cho engine, persistence và user effects mà core không cần browser/SDK.
**Architecture:** Ports nhỏ theo capability, production adapters wrap logic hiện có. P03 chưa chuyển PlayerProvider sang implementation mới.
**Tech Stack:** TypeScript, HTML5 audio/YouTube SDK hiện có, Vitest.

## Global Constraints

Phụ thuộc P00, áp dụng [design](../specs/2026-10-15-inversion-of-control-design.md). Chỉ sửa engines, scheduler và adapters mới; không sửa PlayerContext hoặc `lib/playbackPersistence.ts`. Không gộp storage keys, không đổi thời điểm history, debounce, favorite behavior.

## Task 1 — Contracts và persistence dependency

**Files:** Create `lib/playback/ports.ts`, `components/player/adapters/browserPersistence.ts`, `components/player/adapters/__tests__/browserPersistence.test.ts`; modify `components/player/playbackPersistenceScheduler.ts`, test `components/player/__tests__/playbackPersistenceDebounce.test.ts`.
**Interfaces:** Contracts sau được P04/P05 dùng; `PersistStatePayload` giữ tại scheduler, import type-only.

```ts
import type { Track } from '@/types'
import type { PersistStatePayload } from '@/components/player/playbackPersistenceScheduler'

export type Cancel = () => void
export interface PlaybackClock {
  now(): number
  after(ms: number, callback: () => void): Cancel
  every(ms: number, callback: () => void): Cancel
}
export interface PlaybackOwner {
  requestId: number
  generation: number
  trackId: string
}
export interface PreparedPlayback {
  track: Track
  engine: 'html5' | 'youtube'
  target: string
  initialTime: number
}
export interface PlaybackPersistencePort {
  restore(): PersistStatePayload | null
  save(payload: PersistStatePayload, immediate?: boolean): void
  updateTime(time: number): void
  flush(): void
  getRepeat(): 'off' | 'all' | 'one'
  setRepeat(value: 'off' | 'all' | 'one'): void
  dispose(): void
}
export interface PlaybackUserEffects {
  recordHistory(track: Track): void
  recordListen(track: Track, completed: boolean, skipAtSeconds?: number): void
  setFavorite(track: Track, nextValue: boolean): Promise<void>
  recommend(seed: Track, queue: Track[], signal: AbortSignal): Promise<Track[]>
  dispose(): void
}
export type PlaybackEvent =
  | { type: 'playing' | 'paused' | 'ended'; owner: PlaybackOwner }
  | { type: 'time'; owner: PlaybackOwner; time: number; duration: number }
  | { type: 'buffering'; owner: PlaybackOwner; value: boolean }
  | { type: 'error'; owner: PlaybackOwner; error: unknown }
export interface PlaybackTransport {
  start(target: PreparedPlayback, owner: PlaybackOwner, volume: number,
    mode: 'play' | 'paused'): Promise<void>
  pause(): void
  resume(): Promise<void>
  stop(): void
  seek(time: number): void
  setVolume(volume: number): void
  read(): { time: number; duration: number; playing: boolean }
  subscribe(listener: (event: PlaybackEvent) => void): Cancel
  dispose(): void
}
```

- [ ] Viết test scheduler với hai fake storage riêng và fake clock: schedule nhiều lần trong 15 giây chỉ ghi payload mới nhất; updateTime giữ track; flush ghi ngay và hủy deferred write; dispose không ghi lại. Test tồn tại về max 150/minimal fields giữ nguyên.
- [ ] Thêm optional constructor dependency cho scheduler, giữ `new PlaybackPersistenceScheduler()` tương thích. Dependency cụ thể:

```ts
export interface PersistenceSchedulerDeps {
  now(): number
  write(key: string, value: string): void
  after(ms: number, callback: () => void): () => void
  onIdle(callback: () => void): () => void
}
```

Default deps gọi globals lazily khi method chạy, không đọc localStorage lúc import. `savedAt` dùng injected `now()`. Thay timer IDs bằng cancel callbacks hoặc giữ IDs chỉ trong default adapter. `onIdle` dùng requestIdleCallback/fallback đúng như code cũ.

- [ ] `createBrowserPersistence(): PlaybackPersistencePort` tạo scheduler riêng, chuyển restore parsing và repeat storage từ PlayerContext. Giữ corrupt JSON handling, paused restore và validation như baseline; không hydrate queue không hợp lệ bằng cast mù.
- [ ] Định nghĩa lifecycle: `flush()` ghi pending; `dispose()` hủy công việc, không tự flush để teardown không ghi đè state mới. P05 gọi flush trước dispose khi session kết thúc.
- [ ] Test storage throw/quota/corrupt JSON không làm crash playback, restore schema giữ nguyên. Verify scheduler và adapter tests trước khi tiếp tục.

## Task 2 — User effects adapter

**Files:** Create `components/player/adapters/browserUserEffects.ts`, `components/player/adapters/__tests__/browserUserEffects.test.ts`.
**Interfaces:** `createBrowserUserEffects(deps: BrowserUserEffectsDeps): PlaybackUserEffects`. `BrowserUserEffectsDeps` gồm `fetch: typeof fetch`, `clock: PlaybackClock`, `resolveExternalTrack: (track: Track) => Promise<string | null>`, `recommendFallback: (seed: Track, queue: Track[], count: number) => Promise<Track[]>`. Auth/session lookup nằm trong closure của `resolveExternalTrack`, không snapshot user vào core.

- [ ] Viết tests bằng mock fetch + fake clock: history trì hoãn 100ms và dedup 3 giây cùng track; listener payload giữ trường hiện tại; favorite lỗi HTTP/rejection reject để caller rollback; recommend fallback chỉ theo logic hiện tại.
- [ ] Di chuyển logic từ `recordHistory`, `recordListenEvent` và HTTP phần `toggleFavoriteCurrentTrack`; optimistic UI và ownership kiểm tra kết quả vẫn do controller quản lý. Không đưa toast/confirm/alert vào effect adapter.
- [ ] Chuyển phần I/O `triggerSmartQueueFill` vào recommend: `/api/queue/next` params, `queueTrackToTrack`, fallback `getSmartRecommendedTracks`. Quyết định append/seed/abort/stale result thuộc controller, adapter chỉ trả candidates.
- [ ] Dispose hủy history timer chưa gửi; không gửi analytics trong test. Request đang chạy có thể kết thúc nhưng không được cập nhật React state từ adapter.
- [ ] Chạy `npm test -- components/player/adapters/__tests__/browserUserEffects.test.ts lib/__tests__/queueRecommend.test.ts lib/__tests__/queueSync.test.ts`.

## Task 3 — Browser transport facade

**Files:** Create `components/player/adapters/browserTransport.ts`, `components/player/adapters/__tests__/browserTransport.test.ts`; modify `components/player/engines/types.ts`, `Html5AudioEngine.ts`, `YouTubeIframeEngine.ts` chỉ khi cần capability load-paused; giữ API hiện tại.
**Interfaces:** `createBrowserTransport(deps: BrowserTransportDeps): PlaybackTransport`; deps có `audio: HTMLAudioElement`, `html5: Html5AudioEngine`, `youtube: YouTubeIframeEngine`. Adapter expose thêm `handleYouTubeEvent(event: PlaybackEvent): void` qua intersection type để P05 binding gửi event đã xác thực. Không đưa native refs vào controller.

- [ ] Test mutual exclusion, seek/volume/read, load-paused không gọi play, unsubscribe, disposal và event ownership. Dùng fake audio/player như engine tests hiện có.
- [ ] `start(..., 'play')` trên target đã sẵn phải gọi native play trước lần await đầu tiên; dùng promise return để theo dõi completion. Test trực tiếp:

```ts
const pending = transport.start(prepared, owner, 0.8, 'play')
expect(audio.play).toHaveBeenCalledTimes(1)
await pending
```

Trong test này `transport` được tạo bằng factory, `audio.play` là `vi.fn().mockResolvedValue(undefined)`; `prepared` là HTML5 target và `owner` là `{ requestId: 1, generation: 1, trackId: 'a' }`.

- [ ] Giữ `PlaybackEngine` cũ. Thêm load-paused capability ở concrete engines nếu cần thay vì giả lập bằng `loadAndPlay` rồi pause; cách sau có thể phát tiếng ngoài ý muốn.
- [ ] Khi chuyển nguồn, gỡ listeners/binding cũ trước khi thay source; event/promise giữ captured owner. Kiểm tra actual source/video ID bằng helper hiện có trước khi emit. Không đọc owner hiện tại rồi gắn cho event đã queued từ nguồn cũ. Test A→B với late ended/error/playing của A và delayed play promise của A.
- [ ] Disposal idempotent, dừng engines và bỏ listener. Transport không tạo YouTube script/player hoặc AudioContext trong constructor; P05 quản lý native resource lifecycle.
- [ ] Verify:

```powershell
npm test -- components/player/adapters components/player/__tests__/playerEngines.test.ts components/player/__tests__/playerEnginesSwitching.test.ts components/player/__tests__/audioSourceSwitch.test.ts components/player/__tests__/playbackPersistenceDebounce.test.ts
npx tsc --noEmit --incremental false
npx eslint lib/playback/ports.ts components/player/adapters components/player/engines components/player/playbackPersistenceScheduler.ts
```

**Acceptance:** Core ports không React/SDK runtime; adapters test bằng fake native objects; scheduler cũ vẫn dùng được; production PlayerProvider chưa bị thay. Bàn giao ports và lifecycle semantics cho P04/P05.
