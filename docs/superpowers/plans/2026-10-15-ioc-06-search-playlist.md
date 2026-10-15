# P06 — Search and Playlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans`; execute checkboxes in order. Đây là gói mở rộng riêng.

**Goal:** Search/Playlist contexts nhận service/repository thay vì tự gắn I/O với UI.
**Architecture:** Client-side composition tạo service; context vẫn giữ UI state/debounce hiện tại. Playlist repository quản lý HTTP/Realtime, UI giữ confirm/alert.
**Tech Stack:** React, TypeScript, Vitest, existing search API/Supabase Realtime.

## Global Constraints

Phụ thuộc P00; nên triển khai sau P05 để dễ review, nhưng không phụ thuộc controller API. Áp dụng [design](../specs/2026-10-15-inversion-of-control-design.md). Không sửa player, auth model, RLS, query policy, subscription filter hoặc UI copy. Dùng skill Supabase khi xử lý Realtime adapter; giữ API hiện tại.

## Task 1 — Search service seam

**Files:** Create `lib/search/searchService.ts`, `lib/search/searchRequests.ts`, `components/search/searchComposition.ts`, `lib/search/__tests__/searchRequests.test.ts`; modify `components/search/SearchContext.tsx`.
**Interfaces:**

```ts
import type { fetchUnifiedSearch } from '@/lib/searchApi'
export interface SearchService { search: typeof fetchUnifiedSearch }
export function createSearchService(search: typeof fetchUnifiedSearch): SearchService {
  return { search }
}
```

- [ ] Đọc `lib/searchApi.ts` để giữ exact arguments/defaults/cache/dedup; không copy cache vào context hoặc tạo thêm tầng caching.
- [ ] Tạo optional `service?: SearchService` trên SearchProvider chỉ dùng bên trong client tree; default từ client composition. Không truyền function/service instance từ Server Component props.
- [ ] Viết behavioral integration test query A chậm → B nhanh, suggestion độc lập committed global results, clear trước result về, unmount và trending load một lần. Giữ debounce global 250ms/suggestion 350ms và active request IDs như baseline.
- [ ] Thay calls `fetchUnifiedSearch` bằng `service.search` qua stable dependency; service thay đổi là lifecycle boundary, old result không được commit. Không viết test chỉ kiểm tra factory trả lại cùng function.
- [ ] Vitest repo dùng Node, chưa có DOM testing library. Dùng ownership helper thuần sau và Playwright fixture cho context behavior; không import package test chưa cài. Giữ debounce timers trong React, thay active search/suggestion IDs bằng helper. Effect lifecycle cleanup invalidate lane tương ứng trước khi result cũ có thể commit.

```ts
export type SearchLane = 'global' | 'suggestion' | 'trending'
export function createSearchRequests() {
  const versions: Record<SearchLane, number> = { global: 0, suggestion: 0, trending: 0 }
  return {
    begin(lane: SearchLane): number { return ++versions[lane] },
    isCurrent(lane: SearchLane, version: number): boolean { return versions[lane] === version },
    invalidate(lane: SearchLane): void { versions[lane]++ },
  }
}
```

Test helper trong Node: begin global A, begin global B, assert A stale/B current; begin suggestion không làm B stale; invalidate global làm B stale. Browser test xác nhận results/loading/clear thực sự dùng guard này, không chỉ test counter.
- [ ] Chạy `npm test -- lib/search lib/__tests__/searchFlow.test.ts components/search/__tests__`; thêm fixture-based browser assertion cho suggestions/global trong suite search hiện có sau khi kiểm tra auth/network của suite.

## Task 2 — Playlist repository và subscription adapter

**Files:** Create `lib/playlist/playlistRepository.ts`, `components/playlist/playlistComposition.ts`, `lib/playlist/__tests__/playlistRepository.test.ts`; modify `components/playlist/PlaylistContext.tsx`.
**Interfaces:**

```ts
import type { Playlist } from '@/types'
export interface PlaylistRepository {
  list(): Promise<Playlist[]>
  create(name?: string): Promise<Playlist | null>
  remove(id: string): Promise<void>
  subscribe(onChange: () => void): () => void
}
export class PlaylistRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}
export interface PlaylistRepositoryDeps {
  fetch: typeof globalThis.fetch
  subscribeRealtime(onChange: () => void): () => void
  subscribeLocal(onChange: () => void): () => void
  notifyLocal(): void
}
```

Factory: `createPlaylistRepository(deps: PlaylistRepositoryDeps): PlaylistRepository`. Realtime/local event adapters ở composition; subscribe trả cleanup cho cả hai. Context quyết định khi nào có activeUserId để subscribe; không đổi active-user behavior trong extraction.

- [ ] Test list/create/remove bằng fake fetch, gồm response JSON, 401, HTTP non-ok và network reject. Repository chỉ trả data/typed error; context map lỗi về copy hiện tại. Phân biệt create `null` và thrown error theo behavior hiện tại đã ghi baseline.
- [ ] Chuyển HTTP tới `/api/playlists`, `/api/playlists/{id}` vào repository; giữ method/body/credentials behavior. `notifyLocal` gọi đúng thời điểm sau successful create/remove, không notify khi failure.
- [ ] Composition wrap Supabase `.channel('global-playlists')` và `'playlist-updated'` window event. Cleanup gỡ đúng callback/channel của instance; không removeAllChannels. Bảo toàn filter/event/schema/table và active-user gating hiện tại.
- [ ] Context nhận optional repository từ client composition, giữ `createBusyRef`, `refreshSeqRef`, active user derivation và UI prompt. `confirm` chạy trước `repository.remove`; cancel không gửi request. Context xử lý alert/toast như cũ.
- [ ] Test refresh A/B order, duplicate create click, unsubscribe khi active user đổi/unmount, failed delete không xóa optimistic list. Không đổi sang optimistic delete nếu baseline chưa làm.
- [ ] Verify:

```powershell
npm test -- lib/playlist lib/search components/search/__tests__
npx tsc --noEmit --incremental false
npx eslint lib/playlist lib/search components/playlist/PlaylistContext.tsx components/playlist/playlistComposition.ts components/search
```

**Acceptance:** Contexts không chứa SDK/HTTP implementation; query timing, realtime refresh và UI behavior giữ nguyên. Ghi nghiệm thu riêng P06; nếu chưa làm P06, P07 ghi rõ scope thay vì đánh dấu cả ứng dụng đã refactor IoC.
