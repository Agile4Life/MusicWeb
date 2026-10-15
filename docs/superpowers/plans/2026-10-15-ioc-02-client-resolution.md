# P02 — Client Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans`; execute checkboxes in order.

**Goal:** Client resolver có dependency và instance lifecycle rõ, giữ nguyên API cũ.
**Architecture:** Factory chứa cache/ownership maps; facade lấy một default instance để các caller vẫn chia sẻ dedup. HTTP/persistence/static Drive được inject.
**Tech Stack:** TypeScript, Vitest fake timers, existing fetch/persistence helpers.

## Global Constraints

Phụ thuộc P00; độc lập P01/P03. Áp dụng [design](../specs/2026-10-15-inversion-of-control-design.md). Không thay key format, TTL, aliases, URL hoặc serialization. Không sửa implementation `lib/playbackPersistence.ts` và không sửa PlayerContext.

Gate trước coding: freeze P00 sau công việc song song về YouTube `streamUrl`. Test cả facade helper `buildStableProxyStreamUrl` và cách resolver chọn fallback URL; chúng có thể cố ý khác nhau. Giữ `null` cho YouTube nếu baseline thực thi đã dùng `null`, không tự gọi builder để khôi phục URL cũ.

## Task 1 — Factory và dependency contracts

**Files:** Create `lib/stream-resolution/client/contracts.ts`, `clientResolutionService.ts`; create `lib/stream-resolution/client/__tests__/clientResolutionService.test.ts`.
**Interfaces:** Di chuyển nguyên `ResolvedStreamResult` từ facade vào contracts, facade re-export type. Dùng chữ ký persistence helper có sẵn qua type-only import:

```ts
import type { findMemoryDriveTrack } from '@/lib/driveTracksMap'
import type {
  getTrackResolution, saveTrackResolution, deleteTrackResolution,
} from '@/lib/playbackPersistence'

export interface ResolutionTrack {
  title: string
  artist?: string | null
  duration?: number | null
  album?: string | null
}
export interface ClientResolutionDeps {
  fetch: typeof globalThis.fetch
  now(): number
  findMemoryDriveTrack: typeof findMemoryDriveTrack
  persistence: {
    get: typeof getTrackResolution
    save: typeof saveTrackResolution
    delete: typeof deleteTrackResolution
  }
  buildStreamUrl(source: string, id: string): string
}
export interface ClientResolutionService {
  resolve(track: ResolutionTrack): Promise<ResolvedStreamResult | null>
  invalidate(track: ResolutionTrack): Promise<void>
  dispose(): void
}
```

- [ ] Viết test mới với fake fetch, persistence và `now`; kiểm tra hai instance không chung cache. Test này đủ chạy mà không stub window/localStorage:

```ts
import { expect, it, vi } from 'vitest'
import { createClientResolutionService } from '../clientResolutionService'
import type { ClientResolutionDeps } from '../contracts'

it('isolates service caches while coalescing within one instance', async () => {
  const request = vi.fn(async () => Response.json({ source: 'youtube', id: 'video-1' }))
  const deps: ClientResolutionDeps = {
    fetch: request, now: () => 100, findMemoryDriveTrack: () => null,
    persistence: { get: () => null, save: () => {}, delete: () => {} },
    buildStreamUrl: (_source, id) => `/api/yt-stream?id=${id}`,
  }
  const a = createClientResolutionService(deps)
  const b = createClientResolutionService(deps)
  const track = { title: 'Song', artist: 'Artist' }
  await Promise.all([a.resolve(track), a.resolve(track)])
  expect(request).toHaveBeenCalledTimes(1)
  await b.resolve(track)
  expect(request).toHaveBeenCalledTimes(2)
  a.dispose()
  b.dispose()
})
```

- [ ] Chạy test để thấy module missing; sau đó chuyển nguyên maps và resolver vào factory. Thay `fetch`/`Date.now`/persistence/static Drive calls bằng deps tương ứng. Giữ thứ tự static Drive → persisted → memory → in-flight → network và forceRefresh bypass.
- [ ] Bỏ import-time interval bằng cleanup khi invalidate/finally; interval cũ chỉ xóa in-flight generation đã cũ. Khi invalidate, loại entry của generation cũ ngay; `finally` cũ không được xóa entry mới. Không đổi expiry policy hoặc thêm background polling.
- [ ] `dispose()` idempotent: đánh dấu disposed, xóa maps, chặn pending completion ghi memory/disk; resolve sau dispose trả null, invalidate sau dispose no-op. Không để xóa generation map rồi request cũ vô tình có quyền vì generation quay về 0.
- [ ] Thêm test: dispose trong fetch; same-generation dedup; invalidate khi A đang pending rồi resolve B; A hoàn tất không ghi cache/disk hoặc xóa B; hit/miss TTL; failed eager invalidation vẫn buộc next resolve gửi `invalidate=1`.

## Task 2 — Adapters và facade tương thích

**Files:** Create `lib/stream-resolution/client/composition.ts`, `streamUrl.ts`; modify `lib/resolveStreamClient.ts`; test `lib/__tests__/resolveStreamCacheOwnership.test.ts`, `catalogStreamResolution.test.ts`.
**Interfaces:** `getClientResolutionService(): ClientResolutionService`; giữ `resolveStreamCached`, `invalidateStreamResolution`, `buildStableProxyStreamUrl`, `ResolvedStreamResult` ở đường dẫn cũ.

- [ ] Chuyển `buildStableProxyStreamUrl` nguyên logic sang `streamUrl.ts`; facade re-export. Composition import helper này trực tiếp, không import facade để tránh vòng phụ thuộc.
- [ ] Compose default instance lazily. Không timer/network/storage access lúc import/create. Truyền fetch dưới dạng closure `(input, init) => globalThis.fetch(input, init)` để môi trường test thay fetch được.
- [ ] Facade dùng forwarding cụ thể:

```ts
export function resolveStreamCached(track: ResolutionTrack) {
  return getClientResolutionService().resolve(track)
}
export function invalidateStreamResolution(track: ResolutionTrack) {
  return getClientResolutionService().invalidate(track)
}
```

- [ ] Default instance thuộc client module lifetime, không dispose khi một PlayerProvider unmount vì có caller khác. Test mới dùng factory và dispose instance của mình. Nếu code server đang import facade, ghi caller đó và không lưu user/session riêng trong singleton; không thêm `client-only` marker cho đến khi import audit chứng minh an toàn.
- [ ] Giữ một suite facade regression với globals như hiện tại để kiểm chứng default wiring; chuyển phần lớn ownership cases sang factory test. Không sửa persistence aliases hoặc hydrate schema trong P02.
- [ ] Verify:

```powershell
npm test -- lib/stream-resolution/client lib/__tests__/resolveStreamCacheOwnership.test.ts lib/__tests__/catalogStreamResolution.test.ts lib/__tests__/playbackPersistence.test.ts
npx tsc --noEmit --incremental false
npx eslint lib/stream-resolution/client lib/resolveStreamClient.ts
```

**Acceptance:** Không timer lúc import, không module-global mutable maps trong core, instance isolation và disposed pending request được test; public callers giữ nguyên. Bàn giao factory + contracts cho P04.
